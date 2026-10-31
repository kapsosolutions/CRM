// Create: publish posts, carousels, reels, videos and stories to the connected
// Facebook Page and Instagram account (now or scheduled), see how each one
// went, and set up Comment auto-DM (a DM to everyone who comments on a post
// or reel). Backend: /api/social (services/socialPublish.js, commentAutoDm.js).
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { CrmApi } from '../api';
import type {
  CommentActivity, CommentRule, CommentRuleInput, SocialAccount, SocialKind, SocialLimits, SocialMedia, SocialPost,
  SocialRecentPost, SocialTarget,
} from '../types';
import { useConfirm, useFlash } from './Dialogs';
import { BladeSpinner } from './BladeSpinner';
import './CreatePage.css';

type Tab = 'compose' | 'posts' | 'comments';
const TARGETS: SocialTarget[] = ['facebook', 'instagram'];
const TARGET_NAME: Record<SocialTarget, string> = { facebook: 'Facebook', instagram: 'Instagram' };
const TARGET_ICON: Record<SocialTarget, string> = { facebook: '/channel-facebook.svg', instagram: '/channel-instagram.svg' };
/** Channel Status tab that connects each account. */
const CONNECT_TAB: Record<SocialTarget, string> = { facebook: 'channel-status:messenger', instagram: 'channel-status:instagram' };

const KINDS: { key: SocialKind; label: string; icon: string; hint: string }[] = [
  { key: 'post', label: 'Post', icon: 'image', hint: 'One photo with a caption. On Facebook it can also be text only.' },
  { key: 'carousel', label: 'Carousel', icon: 'view_carousel', hint: '2 to 10 photos people swipe through. On Instagram, videos can be in it too.' },
  { key: 'reel', label: 'Reel', icon: 'movie', hint: 'A vertical 9:16 video. Facebook takes 3 to 90 seconds, Instagram up to 15 minutes.' },
  { key: 'video', label: 'Video', icon: 'smart_display', hint: 'A regular video on your Facebook Page. On Instagram, videos are posted as reels.' },
  { key: 'story', label: 'Story', icon: 'amp_stories', hint: 'One photo or video, full screen for 24 hours. Stories have no caption.' },
];
const KIND_LABEL: Record<SocialKind, string> = { post: 'Post', carousel: 'Carousel', reel: 'Reel', video: 'Video', story: 'Story' };
const DEFAULT_LIMITS: SocialLimits = {
  instagramCaption: 2200, instagramHashtags: 30, facebookCaption: 63206, carouselMin: 2, carouselMax: 10,
  minLeadMs: 2 * 60 * 1000, maxAheadMs: 75 * 24 * 60 * 60 * 1000, waiting: 50,
};
const PHOTO_TYPES = 'image/jpeg,image/png,image/webp';
const VIDEO_TYPES = 'video/mp4,video/quicktime';
const VIDEO_MAX = 95 * 1024 * 1024;
const PHOTO_MAX = 15 * 1024 * 1024;

interface DraftItem {
  key: string;
  type: 'image' | 'video';
  preview: string;
  name: string;
  progress: number;
  media: SocialMedia | null;
  error: string;
  /** Video only, read in the browser. */
  duration: number | null;
  width: number | null;
  height: number | null;
}

const errText = (e: unknown, fallback = 'Something went wrong. Please try again.') => (e instanceof Error && e.message ? e.message : fallback);
const fmtTime = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};
const hashtagCount = (s: string) => (s.match(/#[\p{L}\p{N}_]+/gu) || []).length;
const byteLength = (s: string) => new TextEncoder().encode(s).length;
/** A datetime-local value (local time) one hour from now, on a 5-minute mark. */
function defaultScheduleValue() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function videoInfo(url: string): Promise<{ duration: number | null; width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    let settled = false;
    const finish = (r: { duration: number | null; width: number | null; height: number | null }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => finish({
      duration: Number.isFinite(v.duration) ? v.duration : null,
      width: v.videoWidth || null,
      height: v.videoHeight || null,
    });
    v.onerror = () => finish({ duration: null, width: null, height: null });
    setTimeout(() => finish({ duration: null, width: null, height: null }), 8000);
    v.src = url;
  });
}

interface Props {
  api: CrmApi;
  demo?: boolean;
  onNavigate?: (target: string) => void;
  /** A notification asked for one post. */
  focusRequest?: { id: string; n: number } | null;
}

export function CreatePage({ api, demo, onNavigate, focusRequest }: Props) {
  const [accounts, setAccounts] = useState<Record<SocialTarget, SocialAccount | null> | null>(null);
  const [limits, setLimits] = useState<SocialLimits>(DEFAULT_LIMITS);
  const [loadError, setLoadError] = useState('');
  const [posts, setPosts] = useState<SocialPost[] | null>(null);
  const [tab, setTab] = useState<Tab>('compose');
  const [highlight, setHighlight] = useState('');

  const loadAccounts = useCallback(() => {
    setLoadError('');
    api
      .getSocial()
      .then((r) => {
        setAccounts(r.accounts);
        if (r.limits) setLimits(r.limits);
      })
      .catch((e) => {
        setAccounts({ facebook: null, instagram: null });
        setLoadError(errText(e, 'Could not load your accounts.'));
      });
  }, [api]);
  const loadPosts = useCallback(() => {
    api
      .getSocialPosts()
      .then((r) => setPosts(r.data || []))
      .catch(() => setPosts((p) => p ?? []));
  }, [api]);
  useEffect(() => {
    loadAccounts();
    loadPosts();
  }, [loadAccounts, loadPosts]);

  // While a post is going out (or is about to), keep its status current.
  const busy = useMemo(
    () => (posts || []).some((p) => p.status === 'publishing' || (p.status === 'scheduled' && new Date(p.scheduledAt || 0).getTime() <= Date.now() + 30000)),
    [posts],
  );
  useEffect(() => {
    if (!busy) return undefined;
    const id = setInterval(loadPosts, 5000);
    return () => clearInterval(id);
  }, [busy, loadPosts]);
  // Scheduled posts further ahead: a slow refresh.
  useEffect(() => {
    const id = setInterval(loadPosts, 60000);
    return () => clearInterval(id);
  }, [loadPosts]);

  useEffect(() => {
    if (!focusRequest?.id) return;
    setTab('posts');
    setHighlight(focusRequest.id);
    loadPosts();
  }, [focusRequest, loadPosts]);

  const connected = (t: SocialTarget) => accounts?.[t]?.status === 'connected';
  const anyConnected = TARGETS.some(connected);

  const head = (
    <header className="page-head cr-head">
      <h2>Create</h2>
      <nav className="cr-tabs" role="tablist" aria-label="Create">
        {([['compose', 'New post', 'add_photo_alternate'], ['posts', 'Posts', 'grid_view'], ['comments', 'Comment auto-DM', 'forum']] as const).map(([k, label, icon]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`cr-tab${tab === k ? ' on' : ''}`}
            onClick={() => setTab(k)}
            data-testid={`cr-tab-${k}`}
          >
            <span className="material-icons" aria-hidden="true">{icon}</span>
            {label}
            {k === 'posts' && (posts || []).some((p) => p.status === 'publishing') && <span className="cr-tab-dot" aria-label="Publishing" />}
          </button>
        ))}
      </nav>
    </header>
  );

  if (!accounts) {
    return (
      <div className="page cr-page" data-testid="cr-page">
        {head}
        <div className="page-body"><BladeSpinner center={true} containerHeight={240} /></div>
      </div>
    );
  }

  return (
    <div className="page cr-page" data-testid="cr-page">
      {head}
      <div className="page-body cr-body">
        <AccountsStrip accounts={accounts} onNavigate={onNavigate} part={tab === 'comments' ? 'comments' : 'publish'} />
        {loadError && <div className="cr-banner bad" role="alert">{loadError} <button type="button" className="k-btn ghost sm" onClick={loadAccounts}>Try again</button></div>}
        {!anyConnected && tab !== 'posts' ? (
          <div className="cr-locked" data-testid="cr-locked">
            <div className="cr-locked-icons">
              <img src={TARGET_ICON.facebook} alt="" />
              <img src={TARGET_ICON.instagram} alt="" />
            </div>
            <h3>{tab === 'comments' ? 'Connect Facebook or Instagram to DM people who comment' : 'Connect Facebook or Instagram to start posting'}</h3>
            <p>
              {demo
                ? 'In the demo nothing is connected. In your own account, connect your Facebook Page (Messenger) or Instagram on Channel Status.'
                : 'Create publishes to the Facebook Page and Instagram account you connected on Channel Status (Messenger and Instagram).'}
            </p>
            {onNavigate && !demo && (
              <div className="cr-locked-actions">
                <button type="button" className="k-btn" onClick={() => onNavigate(CONNECT_TAB.facebook)} data-testid="cr-connect-facebook">
                  <img src={TARGET_ICON.facebook} alt="" /> Connect Facebook Page
                </button>
                <button type="button" className="k-btn ghost" onClick={() => onNavigate(CONNECT_TAB.instagram)} data-testid="cr-connect-instagram">
                  <img src={TARGET_ICON.instagram} alt="" /> Connect Instagram
                </button>
              </div>
            )}
          </div>
        ) : tab === 'compose' ? (
          <Composer
            api={api}
            accounts={accounts}
            limits={limits}
            onCreated={(p) => {
              setPosts((list) => [p, ...(list || [])]);
              setHighlight(p.id);
              setTab('posts');
            }}
          />
        ) : tab === 'posts' ? (
          <PostsList api={api} posts={posts} highlight={highlight} onChanged={loadPosts} onNew={() => setTab('compose')} />
        ) : (
          <CommentAutoDm api={api} accounts={accounts} />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- accounts --

function AccountsStrip({ accounts, onNavigate, part }: {
  accounts: Record<SocialTarget, SocialAccount | null>;
  onNavigate?: (t: string) => void;
  part: 'publish' | 'comments';
}) {
  return (
    <div className="cr-accounts">
      {TARGETS.map((t) => {
        const a = accounts[t];
        const cap = a ? a[part] : null;
        const ok = a?.status === 'connected';
        return (
          <div key={t} className={`cr-account ${t}${ok ? ' on' : ''}`} data-testid={`cr-account-${t}`}>
            <div className="cr-account-avatar">
              {a?.pictureUrl ? <img src={a.pictureUrl} alt="" /> : <span className="material-icons" aria-hidden="true">{t === 'facebook' ? 'flag' : 'person'}</span>}
              <img className="cr-account-badge" src={TARGET_ICON[t]} alt="" />
            </div>
            <div className="cr-account-text">
              <strong>{a ? a.name : TARGET_NAME[t]}</strong>
              <span className={`cr-account-state${ok ? ' ok' : a ? ' bad' : ''}`}>
                {ok ? (t === 'facebook' ? 'Facebook Page · connected' : `Instagram · connected${a?.loginMethod === 'facebook' ? ' through the Page' : ''}`) : a ? 'Disconnected at Meta' : 'Not connected'}
              </span>
              {ok && cap?.ok === false && (
                <span className="cr-account-perm" data-testid={`cr-perm-${t}`}>
                  {part === 'publish' ? 'No permission to publish yet' : 'No permission for comments yet'} ({cap.missing.join(', ')}). Reconnect and allow it.
                </span>
              )}
            </div>
            {onNavigate && (!ok || cap?.ok === false) && (
              <button type="button" className="k-btn ghost sm" onClick={() => onNavigate(CONNECT_TAB[t])} data-testid={`cr-account-connect-${t}`}>
                {a ? 'Reconnect' : 'Connect'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------- composer --

function Composer({ api, accounts, limits, onCreated }: {
  api: CrmApi;
  accounts: Record<SocialTarget, SocialAccount | null>;
  limits: SocialLimits;
  onCreated: (p: SocialPost) => void;
}) {
  const flash = useFlash();
  const connected = (t: SocialTarget) => accounts[t]?.status === 'connected';
  const [targets, setTargets] = useState<SocialTarget[]>(() => TARGETS.filter(connected));
  const [kind, setKind] = useState<SocialKind>('post');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [caption, setCaption] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [schedule, setSchedule] = useState(defaultScheduleValue);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [previewTarget, setPreviewTarget] = useState<SocialTarget>(() => (connected('instagram') ? 'instagram' : 'facebook'));
  const fileRef = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const seq = useRef(0);

  useEffect(() => {
    if (targets.length && !targets.includes(previewTarget)) setPreviewTarget(targets[0]);
  }, [targets, previewTarget]);
  // The object URLs of the previews go when the page does.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => () => itemsRef.current.forEach((it) => URL.revokeObjectURL(it.preview)), []);

  const ig = targets.includes('instagram');
  const fb = targets.includes('facebook');
  const maxItems = kind === 'carousel' ? limits.carouselMax : 1;
  const acceptsVideo = kind === 'reel' || kind === 'video' || kind === 'story' || (kind === 'carousel' && !fb);
  const acceptsPhoto = kind === 'post' || kind === 'carousel' || kind === 'story';
  const accept = [acceptsPhoto ? PHOTO_TYPES : '', acceptsVideo ? VIDEO_TYPES : ''].filter(Boolean).join(',');

  const patch = (key: string, p: Partial<DraftItem>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it)));

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const room = Math.max(0, maxItems - items.length);
    const picked = Array.from(files).slice(0, room || (maxItems === 1 ? 1 : 0));
    if (!picked.length) {
      flash(`A ${KIND_LABEL[kind].toLowerCase()} takes at most ${maxItems} ${maxItems === 1 ? 'file' : 'files'}.`, 'error');
      return;
    }
    // A single-file kind: the new file replaces the old one.
    if (maxItems === 1 && items.length) {
      items.forEach((it) => URL.revokeObjectURL(it.preview));
      setItems([]);
    }
    for (const file of picked) {
      const isVideo = file.type.startsWith('video/');
      const tooBig = file.size > (isVideo ? VIDEO_MAX : PHOTO_MAX);
      seq.current += 1;
      const key = `f${seq.current}`;
      const item: DraftItem = {
        key, type: isVideo ? 'video' : 'image', preview: URL.createObjectURL(file), name: file.name, progress: 0, media: null,
        error: tooBig ? (isVideo ? 'Videos can be up to 95 MB.' : 'Photos can be up to 15 MB.') : '', duration: null, width: null, height: null,
      };
      setItems((list) => [...list, item]);
      if (tooBig) continue;
      if (isVideo) {
        videoInfo(item.preview).then((info) => patch(key, info));
      }
      // One upload at a time (the server takes one per business).
      queue.current = queue.current.then(async () => {
        try {
          const r = await api.uploadSocialMedia(file, (p) => patch(key, { progress: p }));
          setItems((list) => list.map((it) => (it.key === key
            ? { ...it, progress: 100, media: { ...r.media, width: r.media.width ?? it.width, height: r.media.height ?? it.height } }
            : it)));
        } catch (e) {
          patch(key, { error: errText(e, 'The upload failed.') });
        }
      });
    }
  }

  function removeItem(key: string) {
    setItems((list) => {
      const it = list.find((x) => x.key === key);
      if (it) URL.revokeObjectURL(it.preview);
      return list.filter((x) => x.key !== key);
    });
  }
  function move(key: string, by: number) {
    setItems((list) => {
      const i = list.findIndex((x) => x.key === key);
      const j = i + by;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  const uploading = items.some((it) => !it.media && !it.error);
  const problems = useMemo(() => {
    const out: string[] = [];
    if (!targets.length) out.push('Choose where to publish: Facebook, Instagram or both.');
    if (kind === 'video' && ig) out.push('On Instagram, videos are posted as reels. Choose Reel, or untick Instagram.');
    const good = items.filter((it) => !it.error);
    const photos = good.filter((it) => it.type === 'image');
    const videos = good.filter((it) => it.type === 'video');
    if (items.some((it) => it.error)) out.push('Remove the files that failed, or add them again.');
    switch (kind) {
      case 'post':
        if (videos.length) out.push('A post takes one photo. For a video, choose Reel or Video.');
        if (photos.length > 1) out.push('A post takes one photo. For more, choose Carousel.');
        if (ig && !photos.length) out.push('Instagram posts need a photo.');
        if (!photos.length && !caption.trim()) out.push('Write something or add a photo.');
        break;
      case 'carousel':
        if (good.length < limits.carouselMin) out.push(`Add ${limits.carouselMin} to ${limits.carouselMax} photos${fb ? '' : ' or videos'}.`);
        if (fb && videos.length) out.push('Facebook albums take photos only. Remove the videos, or untick Facebook.');
        break;
      case 'reel':
      case 'video':
        if (good.length !== 1 || !videos.length) out.push(`Add one video (MP4 or MOV).`);
        break;
      case 'story':
        if (good.length !== 1) out.push('Add one photo or one video.');
        break;
      default:
        break;
    }
    if (ig && kind !== 'story') {
      if (caption.length > limits.instagramCaption) out.push(`Instagram captions can be at most ${limits.instagramCaption.toLocaleString('en-US')} characters.`);
      if (hashtagCount(caption) > limits.instagramHashtags) out.push(`Instagram allows at most ${limits.instagramHashtags} hashtags.`);
      for (const it of photos) {
        const w = it.media?.width || it.width;
        const h = it.media?.height || it.height;
        if (w && h && (w / h < 0.795 || w / h > 1.915)) {
          out.push('Instagram feed photos must be between 4:5 (portrait) and 1.91:1 (landscape). Crop the photo and add it again.');
          break;
        }
      }
    }
    for (const it of videos) {
      if (it.duration == null) continue;
      if (kind === 'reel' && fb && (it.duration < 3 || it.duration > 90)) out.push('Facebook reels must be 3 to 90 seconds long.');
      if (kind === 'reel' && ig && (it.duration < 3 || it.duration > 15 * 60)) out.push('Instagram reels must be 3 seconds to 15 minutes long.');
      if (kind === 'story' && it.duration > 60) out.push('Story videos can be at most 60 seconds.');
    }
    if (when === 'later') {
      const t = new Date(schedule).getTime();
      if (!schedule || Number.isNaN(t)) out.push('Pick the date and time to publish.');
      else if (t < Date.now() + limits.minLeadMs) out.push('Pick a time at least a few minutes from now, or publish now.');
      else if (t > Date.now() + limits.maxAheadMs) out.push('Posts can be scheduled up to 75 days ahead.');
    }
    return [...new Set(out)];
  }, [targets, kind, ig, fb, items, caption, limits, when, schedule]);

  async function submit() {
    if (problems.length || uploading || saving) return;
    setSaving(true);
    setServerError('');
    try {
      const r = await api.createSocialPost({
        kind,
        targets,
        caption: kind === 'story' ? '' : caption,
        media: items.filter((it) => it.media).map((it) => it.media as SocialMedia),
        ...(when === 'later' ? { scheduledAt: new Date(schedule).toISOString() } : {}),
      });
      flash(when === 'later' ? `Scheduled for ${fmtTime(r.post.scheduledAt)}.` : 'Publishing now. You’ll see the result in Posts.', 'success');
      items.forEach((it) => URL.revokeObjectURL(it.preview));
      setItems([]);
      setCaption('');
      setWhen('now');
      onCreated(r.post);
    } catch (e) {
      setServerError(errText(e));
    } finally {
      setSaving(false);
    }
  }

  const kindInfo = KINDS.find((k) => k.key === kind)!;
  const captionLimit = ig ? limits.instagramCaption : limits.facebookCaption;

  return (
    <div className="cr-compose">
      <section className="cr-form">
        <div className="cr-field">
          <span className="cr-label">Publish to</span>
          <div className="cr-targets">
            {TARGETS.map((t) => {
              const a = accounts[t];
              const ok = connected(t);
              const on = targets.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  className={`cr-target ${t}${on ? ' on' : ''}`}
                  disabled={!ok}
                  aria-pressed={on}
                  onClick={() => setTargets((list) => (on ? list.filter((x) => x !== t) : TARGETS.filter((x) => x === t || list.includes(x))))}
                  title={ok ? undefined : `${TARGET_NAME[t]} isn’t connected`}
                  data-testid={`cr-target-${t}`}
                >
                  <img src={TARGET_ICON[t]} alt="" />
                  <span>{ok ? a?.name : `${TARGET_NAME[t]} (not connected)`}</span>
                  <span className="material-icons cr-target-check" aria-hidden="true">{on ? 'check_circle' : 'radio_button_unchecked'}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="cr-field">
          <span className="cr-label">What are you creating?</span>
          <div className="cr-kinds" role="radiogroup">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                role="radio"
                aria-checked={kind === k.key}
                className={`cr-kind${kind === k.key ? ' on' : ''}`}
                onClick={() => setKind(k.key)}
                data-testid={`cr-kind-${k.key}`}
              >
                <span className="material-icons" aria-hidden="true">{k.icon}</span>
                {k.label}
                {k.key === 'video' && <small>Facebook</small>}
              </button>
            ))}
          </div>
          <p className="cr-hint">{kindInfo.hint}</p>
        </div>

        <div className="cr-field">
          <span className="cr-label">{kind === 'carousel' ? `Photos${fb ? '' : ' and videos'} (${items.length}/${maxItems})` : acceptsPhoto && acceptsVideo ? 'Photo or video' : acceptsVideo ? 'Video' : 'Photo'}</span>
          <div className="cr-media" data-lenis-prevent>
            {items.map((it, i) => (
              <div key={it.key} className={`cr-media-item${it.error ? ' bad' : ''}`} data-testid="cr-media-item">
                {it.type === 'video' ? <video src={it.preview} muted playsInline preload="metadata" /> : <img src={it.preview} alt="" />}
                {it.type === 'video' && <span className="cr-media-tag">{it.duration ? `${Math.round(it.duration)}s` : 'Video'}</span>}
                {!it.media && !it.error && (
                  <div className="cr-media-progress" data-testid="cr-media-progress">
                    <span>{it.progress}%</span>
                    <i style={{ width: `${it.progress}%` }} />
                  </div>
                )}
                {it.error && <div className="cr-media-error" title={it.error}>{it.error}</div>}
                <div className="cr-media-actions">
                  {kind === 'carousel' && items.length > 1 && (
                    <>
                      <button type="button" onClick={() => move(it.key, -1)} disabled={i === 0} aria-label="Move left"><span className="material-icons">chevron_left</span></button>
                      <button type="button" onClick={() => move(it.key, 1)} disabled={i === items.length - 1} aria-label="Move right"><span className="material-icons">chevron_right</span></button>
                    </>
                  )}
                  <button type="button" onClick={() => removeItem(it.key)} aria-label="Remove" data-testid="cr-media-remove"><span className="material-icons">close</span></button>
                </div>
              </div>
            ))}
            {items.length < maxItems || maxItems === 1 ? (
              <button type="button" className="cr-media-add" onClick={() => fileRef.current?.click()} data-testid="cr-media-add">
                <span className="material-icons" aria-hidden="true">{acceptsVideo && !acceptsPhoto ? 'video_call' : 'add_photo_alternate'}</span>
                {items.length && maxItems === 1 ? 'Replace' : 'Add'}
                <small>{acceptsVideo && !acceptsPhoto ? 'MP4 or MOV, up to 95 MB' : acceptsVideo ? 'JPG, PNG, MP4…' : 'JPG, PNG or WebP'}</small>
              </button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            multiple={maxItems > 1}
            hidden
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
            data-testid="cr-file-input"
          />
        </div>

        {kind !== 'story' && (
          <div className="cr-field">
            <label className="cr-label" htmlFor="cr-caption">Caption</label>
            <textarea
              id="cr-caption"
              className="k-input cr-caption"
              rows={5}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write a caption… Add #hashtags and @mentions"
              data-testid="cr-caption"
            />
            <div className={`cr-count${caption.length > captionLimit ? ' over' : ''}`}>
              {ig && <span>{hashtagCount(caption)}/{limits.instagramHashtags} hashtags · </span>}
              {caption.length.toLocaleString('en-US')}/{captionLimit.toLocaleString('en-US')}
            </div>
          </div>
        )}

        <div className="cr-field">
          <span className="cr-label">When</span>
          <div className="cr-when">
            <label className={`cr-radio${when === 'now' ? ' on' : ''}`}>
              <input type="radio" name="cr-when" checked={when === 'now'} onChange={() => setWhen('now')} data-testid="cr-when-now" /> Publish now
            </label>
            <label className={`cr-radio${when === 'later' ? ' on' : ''}`}>
              <input type="radio" name="cr-when" checked={when === 'later'} onChange={() => setWhen('later')} data-testid="cr-when-later" /> Schedule
            </label>
            {when === 'later' && (
              <input type="datetime-local" className="k-input cr-schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)} data-testid="cr-schedule-input" />
            )}
          </div>
          {when === 'later' && <p className="cr-hint">The CRM publishes it at this time (your computer’s time zone), on every account you picked.</p>}
        </div>

        {(problems.length > 0 || serverError) && (
          <ul className="cr-problems" data-testid="cr-problems">
            {serverError && <li className="server">{serverError}</li>}
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        <div className="cr-submit-row">
          <button
            type="button"
            className="k-btn cr-submit"
            disabled={!!problems.length || uploading || saving}
            onClick={submit}
            data-testid="cr-submit"
          >
            <span className="material-icons" aria-hidden="true">{when === 'later' ? 'schedule_send' : 'send'}</span>
            {saving ? 'Saving…' : uploading ? 'Uploading…' : when === 'later' ? 'Schedule' : 'Publish now'}
          </button>
        </div>
      </section>

      <aside className="cr-preview-col">
        {targets.length > 1 && (
          <div className="cr-preview-tabs">
            {targets.map((t) => (
              <button key={t} type="button" className={previewTarget === t ? 'on' : ''} onClick={() => setPreviewTarget(t)} data-testid={`cr-preview-tab-${t}`}>
                <img src={TARGET_ICON[t]} alt="" /> {TARGET_NAME[t]}
              </button>
            ))}
          </div>
        )}
        <PostPreview
          target={targets.length ? previewTarget : 'instagram'}
          kind={kind}
          items={items}
          caption={kind === 'story' ? '' : caption}
          account={accounts[targets.length ? previewTarget : 'instagram']}
        />
      </aside>
    </div>
  );
}

// -------------------------------------------------------------- preview --

function PostPreview({ target, kind, items, caption, account }: {
  target: SocialTarget;
  kind: SocialKind;
  items: DraftItem[];
  caption: string;
  account: SocialAccount | null;
}) {
  const [slide, setSlide] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const good = items.filter((it) => !it.error);
  const name = account ? (target === 'instagram' ? account.username || account.name.replace(/^@/, '') : account.name) : target === 'instagram' ? 'your_account' : 'Your Page';
  const avatar = account?.pictureUrl || '';
  const media = (it: DraftItem | undefined, cls = '') => (!it
    ? <div className={`cr-pv-empty ${cls}`}><span className="material-icons" aria-hidden="true">{kind === 'reel' || kind === 'video' ? 'movie' : 'image'}</span></div>
    : it.type === 'video'
      ? <video className={cls} src={it.preview} muted loop autoPlay playsInline />
      : <img className={cls} src={it.preview} alt="" />);
  const head = (
    <div className="cr-pv-head">
      <span className="cr-pv-avatar">{avatar ? <img src={avatar} alt="" /> : <span className="material-icons">person</span>}</span>
      <span className="cr-pv-name">
        <strong>{name}</strong>
        {target === 'facebook' && <small>Just now · 🌐</small>}
      </span>
      <span className="material-icons cr-pv-more" aria-hidden="true">more_horiz</span>
    </div>
  );

  // Reels and stories: full-screen 9:16.
  if (kind === 'reel' || kind === 'story') {
    return (
      <div className={`cr-phone ${target}`} data-testid="cr-preview">
        <div className={`cr-pv-tall ${kind}`}>
          {media(good[0], 'cr-pv-fill')}
          {kind === 'story' && <div className="cr-pv-story-bar"><i /></div>}
          <div className="cr-pv-tall-head">
            <span className="cr-pv-avatar">{avatar ? <img src={avatar} alt="" /> : <span className="material-icons">person</span>}</span>
            <strong>{name}</strong>
            {kind === 'reel' && <span className="cr-pv-follow">Follow</span>}
          </div>
          {kind === 'reel' && (
            <>
              <div className="cr-pv-reel-side" aria-hidden="true">
                <span className="material-icons">favorite_border</span>
                <span className="material-icons">chat_bubble_outline</span>
                <span className="material-icons">send</span>
              </div>
              {caption && <p className="cr-pv-tall-caption">{caption}</p>}
            </>
          )}
          {kind === 'story' && <div className="cr-pv-story-reply">Send message</div>}
        </div>
      </div>
    );
  }

  const ratio = (() => {
    const f = good[0];
    const w = f?.media?.width || f?.width;
    const h = f?.media?.height || f?.height;
    if (!w || !h) return 1;
    const r = w / h;
    return target === 'instagram' ? Math.min(1.91, Math.max(0.8, r)) : Math.min(1.91, Math.max(0.56, r));
  })();
  const onScroll = () => {
    const el = scroller.current;
    if (el) setSlide(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  };

  if (target === 'facebook') {
    return (
      <div className="cr-phone facebook" data-testid="cr-preview">
        <div className="cr-pv-card">
          {head}
          {caption && <p className="cr-pv-fb-text">{caption}</p>}
          {kind === 'carousel' && good.length > 1 ? (
            <div className={`cr-pv-grid n${Math.min(good.length, 4)}`}>
              {good.slice(0, 4).map((it, i) => (
                <div key={it.key} className="cr-pv-grid-cell">
                  {media(it)}
                  {i === 3 && good.length > 4 && <span className="cr-pv-more-count">+{good.length - 4}</span>}
                </div>
              ))}
            </div>
          ) : good[0] || kind !== 'post' ? (
            <div className="cr-pv-media" style={{ aspectRatio: String(ratio) }}>{media(good[0])}</div>
          ) : null}
          <div className="cr-pv-fb-actions" aria-hidden="true">
            <span><span className="material-icons">thumb_up_off_alt</span>Like</span>
            <span><span className="material-icons">chat_bubble_outline</span>Comment</span>
            <span><span className="material-icons">share</span>Share</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cr-phone instagram" data-testid="cr-preview">
      <div className="cr-pv-card">
        {head}
        {kind === 'carousel' && good.length > 1 ? (
          <div className="cr-pv-carousel-wrap">
            <div className="cr-pv-carousel" ref={scroller} onScroll={onScroll} style={{ aspectRatio: String(ratio) }} data-lenis-prevent data-testid="cr-preview-carousel">
              {good.map((it) => <div key={it.key} className="cr-pv-slide">{media(it)}</div>)}
            </div>
            <span className="cr-pv-counter">{slide + 1}/{good.length}</span>
          </div>
        ) : (
          <div className="cr-pv-media" style={{ aspectRatio: String(ratio) }}>{media(good[0])}</div>
        )}
        <div className="cr-pv-ig-actions" aria-hidden="true">
          <span className="material-icons">favorite_border</span>
          <span className="material-icons">chat_bubble_outline</span>
          <span className="material-icons">send</span>
          {kind === 'carousel' && good.length > 1 && (
            <span className="cr-pv-dots">{good.map((it, i) => <i key={it.key} className={i === slide ? 'on' : ''} />)}</span>
          )}
          <span className="material-icons cr-pv-save">bookmark_border</span>
        </div>
        <p className="cr-pv-ig-caption">{caption ? <><strong>{name}</strong> {caption}</> : <span className="muted">Your caption shows here.</span>}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- posts --

const STATE_TEXT: Record<string, string> = {
  pending: 'Waiting', children: 'Processing', processing: 'Processing at Meta', published: 'Published', failed: 'Failed',
};

function PostsList({ api, posts, highlight, onChanged, onNew }: {
  api: CrmApi;
  posts: SocialPost[] | null;
  highlight: string;
  onChanged: () => void;
  onNew: () => void;
}) {
  const flash = useFlash();
  const confirm = useConfirm();
  const [busy, setBusy] = useState('');
  const refs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (highlight) refs.current.get(highlight)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight, posts]);

  if (!posts) return <BladeSpinner center={true} containerHeight={200} />;
  if (!posts.length) {
    return (
      <div className="cr-empty" data-testid="cr-posts-empty">
        <span className="material-icons" aria-hidden="true">photo_library</span>
        <p>Nothing published from the CRM yet.</p>
        <button type="button" className="k-btn" onClick={onNew}>Create a post</button>
      </div>
    );
  }

  async function retry(p: SocialPost) {
    setBusy(p.id);
    try {
      await api.retrySocialPost(p.id);
      flash('Trying again.', 'success');
      onChanged();
    } catch (e) {
      flash(errText(e), 'error');
    } finally {
      setBusy('');
    }
  }
  async function remove(p: SocialPost) {
    const scheduled = p.status === 'scheduled';
    const ok = await confirm(scheduled
      ? { title: 'Cancel this post?', message: 'It won’t be published.', confirmLabel: 'Cancel post', cancelLabel: 'Keep it', tone: 'danger' }
      : { title: 'Remove from this list?', message: 'It stays on Facebook / Instagram. Only the CRM’s record of it goes.', confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    setBusy(p.id);
    try {
      await api.deleteSocialPost(p.id);
      flash(scheduled ? 'Post cancelled.' : 'Removed from the list.', 'success');
      onChanged();
    } catch (e) {
      flash(errText(e), 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="cr-posts">
      {posts.map((p) => {
        const first = p.media[0];
        const failedAny = p.targets.some((t) => p.results[t]?.state === 'failed');
        return (
          <div
            key={p.id}
            ref={(el) => { if (el) refs.current.set(p.id, el); else refs.current.delete(p.id); }}
            className={`cr-post ${p.status}${highlight === p.id ? ' hl' : ''}`}
            data-testid={`cr-post-${p.id}`}
          >
            <div className="cr-post-thumb">
              {first ? (first.type === 'video' ? <video src={first.url} muted preload="metadata" /> : <img src={first.url} alt="" />) : <span className="material-icons" aria-hidden="true">notes</span>}
              {p.media.length > 1 && <span className="cr-post-count">{p.media.length}</span>}
            </div>
            <div className="cr-post-main">
              <div className="cr-post-top">
                <span className="cr-post-kind">{KIND_LABEL[p.kind]}</span>
                <span className={`cr-post-status ${p.status}`} data-testid="cr-post-status">
                  {p.status === 'scheduled' ? `Scheduled · ${fmtTime(p.scheduledAt)}` : p.status === 'publishing' ? 'Publishing…' : p.status === 'published' ? `Published · ${fmtTime(p.publishedAt)}` : p.status === 'partial' ? 'Published with a problem' : 'Not published'}
                </span>
              </div>
              <p className="cr-post-caption">{p.caption || <span className="muted">{p.kind === 'story' ? 'Story' : 'No caption'}</span>}</p>
              <div className="cr-post-targets">
                {p.targets.map((t) => {
                  const r = p.results[t];
                  return (
                    <div key={t} className={`cr-post-target ${r?.state || 'pending'}`} data-testid={`cr-post-target-${t}`}>
                      <img src={TARGET_ICON[t]} alt={TARGET_NAME[t]} />
                      <span>{p.status === 'scheduled' ? 'Scheduled' : STATE_TEXT[r?.state || 'pending']}</span>
                      {r?.state === 'published' && r.permalink && (
                        <a href={r.permalink} target="_blank" rel="noreferrer" data-testid="cr-post-view">View <span className="material-icons" aria-hidden="true">open_in_new</span></a>
                      )}
                      {r?.state === 'failed' && r.error && <em className="cr-post-error">{r.error.message}</em>}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="cr-post-actions">
              {failedAny && (p.status === 'failed' || p.status === 'partial') && (
                <button type="button" className="k-btn ghost sm" disabled={busy === p.id} onClick={() => retry(p)} data-testid="cr-post-retry">
                  <span className="material-icons" aria-hidden="true">refresh</span> Try again
                </button>
              )}
              {p.status !== 'publishing' && (
                <button type="button" className="icon-btn danger" disabled={busy === p.id} onClick={() => remove(p)} aria-label={p.status === 'scheduled' ? 'Cancel post' : 'Remove from list'} title={p.status === 'scheduled' ? 'Cancel post' : 'Remove from list'} data-testid="cr-post-delete">
                  <span className="material-icons">{p.status === 'scheduled' ? 'event_busy' : 'delete_outline'}</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------ comment auto-DM --

interface RuleDraft {
  id: string;
  channel: SocialTarget;
  name: string;
  scope: 'any' | 'one';
  postId: string;
  postLabel: string;
  postThumb: string;
  matchMode: 'any' | 'keywords';
  keywords: string[];
  dmText: string;
  publicOn: boolean;
  publicReplies: string[];
  oncePerUser: boolean;
  active: boolean;
}

const newDraft = (channel: SocialTarget): RuleDraft => ({
  id: '', channel, name: '', scope: 'any', postId: '', postLabel: '', postThumb: '', matchMode: 'keywords', keywords: [],
  dmText: 'Hi {name}! Thanks for your comment. ', publicOn: false, publicReplies: [''], oncePerUser: true, active: true,
});
const draftOf = (r: CommentRule): RuleDraft => ({
  id: r.id, channel: r.channel, name: r.name, scope: r.postId ? 'one' : 'any', postId: r.postId, postLabel: r.postLabel, postThumb: r.postThumb,
  matchMode: r.matchMode, keywords: r.keywords, dmText: r.dmText, publicOn: r.publicReplies.length > 0,
  publicReplies: r.publicReplies.length ? r.publicReplies : [''], oncePerUser: r.oncePerUser, active: r.active,
});

function CommentAutoDm({ api, accounts }: { api: CrmApi; accounts: Record<SocialTarget, SocialAccount | null> }) {
  const flash = useFlash();
  const confirm = useConfirm();
  const [rules, setRules] = useState<CommentRule[] | null>(null);
  const [activity, setActivity] = useState<CommentActivity[]>([]);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [notice, setNotice] = useState('');
  const connected = (t: SocialTarget) => accounts[t]?.status === 'connected';

  const load = useCallback(() => {
    api
      .getCommentRules()
      .then((r) => {
        setRules(r.data || []);
        setActivity(r.activity || []);
      })
      .catch((e) => {
        setRules((x) => x ?? []);
        flash(errText(e, 'Could not load the rules.'), 'error');
      });
  }, [api, flash]);
  useEffect(() => { load(); }, [load]);

  async function toggle(r: CommentRule) {
    try {
      const res = await api.updateCommentRule(r.id, { active: !r.active });
      setRules((list) => (list || []).map((x) => (x.id === r.id ? res.rule : x)));
      setNotice(res.webhook.ok ? '' : res.webhook.message);
    } catch (e) {
      flash(errText(e), 'error');
    }
  }
  async function remove(r: CommentRule) {
    if (!(await confirm({ title: 'Delete this rule?', message: 'People who comment won’t get this DM any more.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try {
      await api.deleteCommentRule(r.id);
      setRules((list) => (list || []).filter((x) => x.id !== r.id));
      flash('Rule deleted.', 'success');
    } catch (e) {
      flash(errText(e), 'error');
    }
  }

  if (!rules) return <BladeSpinner center={true} containerHeight={200} />;
  const firstChannel: SocialTarget = connected('instagram') ? 'instagram' : 'facebook';

  return (
    <div className="cr-dm">
      <div className="cr-dm-intro">
        <span className="material-icons" aria-hidden="true">forum</span>
        <div>
          <strong>Send a DM to everyone who comments</strong>
          <p>
            When someone comments on your post or reel (for example “price” or “link”), they get your message in their Messenger / Instagram inbox,
            and you can reply publicly under the comment too. Meta allows one DM per comment, within 7 days; after that you can message them once they reply.
            Their chat appears in Chats.
          </p>
        </div>
        {!draft && (
          <button type="button" className="k-btn" onClick={() => setDraft(newDraft(firstChannel))} data-testid="cr-rule-new">
            <span className="material-icons" aria-hidden="true">add</span> New rule
          </button>
        )}
      </div>
      {notice && <div className="cr-banner warn" role="status" data-testid="cr-rule-notice">{notice}</div>}

      {draft && (
        <RuleEditor
          api={api}
          accounts={accounts}
          draft={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSaved={(rule, webhook) => {
            setRules((list) => {
              const l = list || [];
              return l.some((x) => x.id === rule.id) ? l.map((x) => (x.id === rule.id ? rule : x)) : [...l, rule];
            });
            setNotice(webhook.ok ? '' : webhook.message);
            setDraft(null);
            flash(draft.id ? 'Rule saved.' : 'Rule created. New comments that match get your DM.', 'success');
          }}
        />
      )}

      {!draft && !rules.length && (
        <div className="cr-empty" data-testid="cr-rules-empty">
          <span className="material-icons" aria-hidden="true">mark_chat_unread</span>
          <p>No rules yet. Create one to DM people who comment.</p>
        </div>
      )}

      <div className="cr-rules">
        {rules.map((r) => (
          <div key={r.id} className={`cr-rule${r.active ? '' : ' off'}`} data-testid={`cr-rule-${r.id}`}>
            <img className="cr-rule-ch" src={TARGET_ICON[r.channel]} alt={TARGET_NAME[r.channel]} />
            <div className="cr-rule-main">
              <strong>{r.name}</strong>
              <div className="cr-rule-meta">
                <span>{r.postId ? `On: ${r.postLabel || 'one post'}` : 'All posts and reels'}</span>
                <span>·</span>
                <span>{r.matchMode === 'any' ? 'Any comment' : r.keywords.map((k) => <em key={k} className="cr-chip sm">{k}</em>)}</span>
              </div>
              <p className="cr-rule-dm">{r.dmText}</p>
              <span className="cr-rule-stats">{r.sentCount} sent{r.lastSentAt ? ` · last ${fmtTime(r.lastSentAt)}` : ''}{r.publicReplies.length ? ' · public reply on' : ''}</span>
            </div>
            <div className="cr-rule-actions">
              <label className="cr-switch" title={r.active ? 'On' : 'Off'}>
                <input type="checkbox" checked={r.active} onChange={() => toggle(r)} data-testid="cr-rule-toggle" />
                <span />
              </label>
              <button type="button" className="icon-btn" onClick={() => setDraft(draftOf(r))} aria-label="Edit" data-testid="cr-rule-edit"><span className="material-icons">edit</span></button>
              <button type="button" className="icon-btn danger" onClick={() => remove(r)} aria-label="Delete" data-testid="cr-rule-delete"><span className="material-icons">delete_outline</span></button>
            </div>
          </div>
        ))}
      </div>

      <section className="cr-activity" data-testid="cr-activity">
        <h3>Recent comments answered</h3>
        {!activity.length ? (
          <p className="muted">Nothing yet. Comments your rules answer show here.</p>
        ) : (
          <ul>
            {activity.map((a) => (
              <li key={a.id} className={a.status}>
                <img src={TARGET_ICON[a.channel]} alt="" />
                <div>
                  <span><strong>{a.channel === 'instagram' && a.fromName ? `@${a.fromName}` : a.fromName || 'Someone'}</strong> commented “{a.text}”</span>
                  <small>
                    {fmtTime(a.createdAt)} · {a.status === 'sent' ? 'DM sent' : a.status === 'skipped' ? 'Already messaged for this post' : `DM not sent: ${a.error}`}
                    {a.publicReplyError ? ` · public reply failed: ${a.publicReplyError}` : ''}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RuleEditor({ api, accounts, draft, onChange, onCancel, onSaved }: {
  api: CrmApi;
  accounts: Record<SocialTarget, SocialAccount | null>;
  draft: RuleDraft;
  onChange: (d: RuleDraft) => void;
  onCancel: () => void;
  onSaved: (rule: CommentRule, webhook: { ok: boolean; message: string }) => void;
}) {
  const [kw, setKw] = useState('');
  const [recent, setRecent] = useState<SocialRecentPost[] | null>(null);
  const [recentError, setRecentError] = useState('');
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dmRef = useRef<HTMLTextAreaElement>(null);
  const set = (p: Partial<RuleDraft>) => onChange({ ...draft, ...p });
  const connected = (t: SocialTarget) => accounts[t]?.status === 'connected';

  function openPicker() {
    setPicking(true);
    setRecent(null);
    setRecentError('');
    api
      .getSocialRecent(draft.channel)
      .then((r) => setRecent(r.data || []))
      .catch((e) => {
        setRecent([]);
        setRecentError(errText(e, 'Could not load your posts.'));
      });
  }
  function addKeyword(raw: string) {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...draft.keywords];
    for (const p of parts) if (!next.some((k) => k.toLowerCase() === p.toLowerCase()) && p.length <= 40) next.push(p);
    set({ keywords: next.slice(0, 20) });
    setKw('');
  }
  function insertName() {
    const el = dmRef.current;
    const at = el ? el.selectionStart : draft.dmText.length;
    set({ dmText: `${draft.dmText.slice(0, at)}{name}${draft.dmText.slice(at)}` });
  }

  const dmSize = draft.channel === 'instagram' ? byteLength(draft.dmText) : draft.dmText.length;
  const dmMax = draft.channel === 'instagram' ? 1000 : 2000;
  const problems: string[] = [];
  if (!connected(draft.channel)) problems.push(`${TARGET_NAME[draft.channel]} isn’t connected.`);
  if (draft.scope === 'one' && !draft.postId) problems.push('Pick the post or reel.');
  if (draft.matchMode === 'keywords' && !draft.keywords.length && !kw.trim()) problems.push('Add at least one keyword, or choose “Any comment”.');
  if (!draft.dmText.trim()) problems.push('Write the message to send.');
  if (dmSize > dmMax) problems.push(draft.channel === 'instagram' ? 'Instagram messages can be at most 1,000 bytes.' : 'Messenger messages can be at most 2,000 characters.');

  async function save() {
    if (problems.length || saving) return;
    setSaving(true);
    setError('');
    const keywords = kw.trim() ? [...draft.keywords, ...kw.split(',').map((s) => s.trim()).filter(Boolean)] : draft.keywords;
    const body: CommentRuleInput = {
      channel: draft.channel,
      name: draft.name,
      active: draft.active,
      postId: draft.scope === 'one' ? draft.postId : '',
      postLabel: draft.scope === 'one' ? draft.postLabel : '',
      postThumb: draft.scope === 'one' ? draft.postThumb : '',
      matchMode: draft.matchMode,
      keywords: draft.matchMode === 'keywords' ? keywords : [],
      dmText: draft.dmText,
      publicReplies: draft.publicOn ? draft.publicReplies.map((s) => s.trim()).filter(Boolean) : [],
      oncePerUser: draft.oncePerUser,
    };
    try {
      const r = draft.id ? await api.updateCommentRule(draft.id, body) : await api.createCommentRule(body);
      onSaved(r.rule, r.webhook);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="cr-editor" data-testid="cr-rule-editor">
      <h3>{draft.id ? 'Edit rule' : 'New rule'}</h3>

      <div className="cr-field">
        <span className="cr-label">Account</span>
        <div className="cr-seg">
          {TARGETS.map((t) => (
            <button
              key={t}
              type="button"
              className={draft.channel === t ? 'on' : ''}
              disabled={!!draft.id || !connected(t)}
              onClick={() => set({ channel: t, postId: '', postLabel: '', postThumb: '', scope: 'any' })}
              data-testid={`cr-rule-channel-${t}`}
            >
              <img src={TARGET_ICON[t]} alt="" /> {TARGET_NAME[t]}{connected(t) ? '' : ' (not connected)'}
            </button>
          ))}
        </div>
      </div>

      <div className="cr-field">
        <span className="cr-label">Which posts</span>
        <div className="cr-seg">
          <button type="button" className={draft.scope === 'any' ? 'on' : ''} onClick={() => set({ scope: 'any' })} data-testid="cr-rule-scope-any">All posts and reels</button>
          <button type="button" className={draft.scope === 'one' ? 'on' : ''} onClick={() => { set({ scope: 'one' }); if (!draft.postId) openPicker(); }} data-testid="cr-rule-scope-one">One post or reel</button>
        </div>
        {draft.scope === 'one' && (
          <div className="cr-picked">
            {draft.postId ? (
              <div className="cr-picked-post" data-testid="cr-rule-picked">
                {draft.postThumb ? <img src={draft.postThumb} alt="" /> : <span className="material-icons" aria-hidden="true">article</span>}
                <span>{draft.postLabel || draft.postId}</span>
                <button type="button" className="k-btn ghost sm" onClick={openPicker}>Change</button>
              </div>
            ) : !picking && <button type="button" className="k-btn ghost sm" onClick={openPicker} data-testid="cr-rule-pick">Pick a post</button>}
            {picking && (
              <div className="cr-recent" data-testid="cr-recent">
                {!recent && <BladeSpinner center={true} containerHeight={90} />}
                {recentError && <p className="cr-recent-error">{recentError}</p>}
                {recent && !recent.length && !recentError && <p className="muted">No posts on this account yet.</p>}
                {recent && recent.length > 0 && (
                  <div className="cr-recent-grid" data-lenis-prevent>
                    {recent.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`cr-recent-item${draft.postId === p.id ? ' on' : ''}`}
                        onClick={() => {
                          set({ postId: p.id, postLabel: (p.text || (p.type === 'reel' ? 'Reel' : 'Post')).slice(0, 120), postThumb: p.thumb });
                          setPicking(false);
                        }}
                        data-testid="cr-recent-item"
                      >
                        {p.thumb ? <img src={p.thumb} alt="" /> : <span className="material-icons" aria-hidden="true">{p.type === 'reel' ? 'movie' : 'article'}</span>}
                        {p.type === 'reel' && <span className="cr-recent-tag">Reel</span>}
                        <span className="cr-recent-text">{p.text || fmtTime(p.at)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="cr-field">
        <span className="cr-label">Which comments</span>
        <div className="cr-seg">
          <button type="button" className={draft.matchMode === 'keywords' ? 'on' : ''} onClick={() => set({ matchMode: 'keywords' })} data-testid="cr-rule-mode-keywords">With these words</button>
          <button type="button" className={draft.matchMode === 'any' ? 'on' : ''} onClick={() => set({ matchMode: 'any' })} data-testid="cr-rule-mode-any">Any comment</button>
        </div>
        {draft.matchMode === 'keywords' && (
          <div className="cr-chips-input">
            {draft.keywords.map((k) => (
              <span key={k} className="cr-chip">
                {k}
                <button type="button" onClick={() => set({ keywords: draft.keywords.filter((x) => x !== k) })} aria-label={`Remove ${k}`}><span className="material-icons">close</span></button>
              </span>
            ))}
            <input
              value={kw}
              onChange={(e) => {
                if (e.target.value.includes(',')) addKeyword(e.target.value);
                else setKw(e.target.value);
              }}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addKeyword(kw);
                } else if (e.key === 'Backspace' && !kw && draft.keywords.length) {
                  set({ keywords: draft.keywords.slice(0, -1) });
                }
              }}
              onBlur={() => addKeyword(kw)}
              placeholder={draft.keywords.length ? 'Add another…' : 'e.g. price, link, menu (Enter to add)'}
              data-testid="cr-rule-keyword-input"
            />
          </div>
        )}
        {draft.matchMode === 'keywords' && <p className="cr-hint">Whole words, any case: “price” matches “Price?” but not “priceless”.</p>}
      </div>

      <div className="cr-field">
        <label className="cr-label" htmlFor="cr-rule-dm">Message they get</label>
        <textarea
          id="cr-rule-dm"
          ref={dmRef}
          className="k-input"
          rows={4}
          value={draft.dmText}
          onChange={(e) => set({ dmText: e.target.value })}
          data-testid="cr-rule-dm"
        />
        <div className="cr-dm-tools">
          <button type="button" className="k-btn ghost sm" onClick={insertName} data-testid="cr-rule-insert-name">+ {'{name}'}</button>
          <span className="cr-hint">{'{name}'} becomes their first name{draft.channel === 'instagram' ? ' (Instagram: their username)' : ''}.</span>
          <span className={`cr-count${dmSize > dmMax ? ' over' : ''}`}>{dmSize}/{dmMax}{draft.channel === 'instagram' ? ' bytes' : ''}</span>
        </div>
      </div>

      <div className="cr-field">
        <label className="cr-check">
          <input type="checkbox" checked={draft.publicOn} onChange={(e) => set({ publicOn: e.target.checked })} data-testid="cr-rule-public-toggle" />
          Also reply publicly under the comment
        </label>
        {draft.publicOn && (
          <div className="cr-publics">
            {draft.publicReplies.map((r, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={i} className="cr-public">
                <input
                  className="k-input"
                  value={r}
                  maxLength={300}
                  placeholder="e.g. Sent you a DM, {name} 📩"
                  onChange={(e) => set({ publicReplies: draft.publicReplies.map((x, j) => (j === i ? e.target.value : x)) })}
                  data-testid={`cr-rule-public-${i}`}
                />
                {draft.publicReplies.length > 1 && (
                  <button type="button" className="icon-btn" onClick={() => set({ publicReplies: draft.publicReplies.filter((_, j) => j !== i) })} aria-label="Remove"><span className="material-icons">close</span></button>
                )}
              </div>
            ))}
            {draft.publicReplies.length < 5 && (
              <button type="button" className="k-btn ghost sm" onClick={() => set({ publicReplies: [...draft.publicReplies, ''] })}>+ Another (one is picked at random)</button>
            )}
          </div>
        )}
      </div>

      <div className="cr-field">
        <label className="cr-check">
          <input type="checkbox" checked={draft.oncePerUser} onChange={(e) => set({ oncePerUser: e.target.checked })} data-testid="cr-rule-once" />
          Send the DM once per person per post, even if they comment again
        </label>
      </div>

      <div className="cr-field">
        <label className="cr-label" htmlFor="cr-rule-name">Rule name (optional)</label>
        <input id="cr-rule-name" className="k-input" value={draft.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Price enquiries" data-testid="cr-rule-name" />
      </div>

      {(problems.length > 0 || error) && (
        <ul className="cr-problems" data-testid="cr-rule-problems">
          {error && <li className="server">{error}</li>}
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <div className="cr-editor-actions">
        <button type="button" className="k-btn ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="k-btn" disabled={!!problems.length || saving} onClick={save} data-testid="cr-rule-save">
          {saving ? 'Saving…' : draft.id ? 'Save rule' : 'Create rule'}
        </button>
      </div>
    </section>
  );
}

export default CreatePage;
