// Ad previews per placement, like Ads Manager's "Advanced preview": every
// Facebook, Instagram, Messenger, WhatsApp and Audience Network placement
// Meta can preview, side by side.
//
// Each card shows Meta's own rendering (generatepreviews through the server,
// a sandboxed facebook.com iframe) once the Page, the media and the text are
// in place; until then, or when Meta can't preview a placement for this ad, a
// local phone-style sketch of how that placement lays the ad out.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type { AdsCampaignSpec, AdsPreviewFormat } from '../types';
import { ManageDialog } from './AdsManageDialogs';
import { errCode, errText } from './MetaAdsDashboard';
import './AdsManager.css';

export type PreviewPlatform = 'facebook' | 'instagram' | 'messenger' | 'whatsapp' | 'audience_network';
export type PreviewLayout = 'feed' | 'desktop' | 'story' | 'reels' | 'inbox' | 'column' | 'grid' | 'video' | 'native' | 'interstitial';
export interface PlacementDef {
  key: AdsPreviewFormat;
  label: string;
  platform: PreviewPlatform;
  layout: PreviewLayout;
  /** Meta only shows video ads here. */
  videoOnly?: boolean;
  /** Meta doesn't show carousels here. */
  noCarousel?: boolean;
}

export const PLACEMENTS: PlacementDef[] = [
  { key: 'facebook_feed', label: 'Facebook Feed', platform: 'facebook', layout: 'feed' },
  { key: 'facebook_story', label: 'Facebook Stories', platform: 'facebook', layout: 'story', noCarousel: true },
  { key: 'facebook_reels', label: 'Facebook Reels', platform: 'facebook', layout: 'reels' },
  { key: 'facebook_marketplace', label: 'Facebook Marketplace', platform: 'facebook', layout: 'grid' },
  { key: 'facebook_profile_feed', label: 'Facebook profile feed', platform: 'facebook', layout: 'feed' },
  { key: 'facebook_video_feeds', label: 'Facebook video feeds', platform: 'facebook', layout: 'video', videoOnly: true },
  { key: 'facebook_instream', label: 'Facebook in-stream videos', platform: 'facebook', layout: 'video', videoOnly: true },
  { key: 'facebook_right_column', label: 'Facebook right column', platform: 'facebook', layout: 'column', noCarousel: true },
  { key: 'facebook_desktop_feed', label: 'Facebook Feed (desktop)', platform: 'facebook', layout: 'desktop' },
  { key: 'instagram_feed', label: 'Instagram Feed', platform: 'instagram', layout: 'feed' },
  { key: 'instagram_story', label: 'Instagram Stories', platform: 'instagram', layout: 'story' },
  { key: 'reels', label: 'Instagram Reels', platform: 'instagram', layout: 'reels' },
  { key: 'instagram_profile_feed', label: 'Instagram profile feed', platform: 'instagram', layout: 'feed' },
  { key: 'instagram_explore', label: 'Instagram Explore', platform: 'instagram', layout: 'feed' },
  { key: 'instagram_explore_home', label: 'Instagram Explore home', platform: 'instagram', layout: 'grid' },
  { key: 'instagram_search', label: 'Instagram search results', platform: 'instagram', layout: 'feed' },
  { key: 'messenger_inbox', label: 'Messenger Inbox', platform: 'messenger', layout: 'inbox' },
  { key: 'messenger_story', label: 'Messenger Stories', platform: 'messenger', layout: 'story', noCarousel: true },
  { key: 'whatsapp_status', label: 'WhatsApp Status', platform: 'whatsapp', layout: 'story', noCarousel: true },
  { key: 'an_native', label: 'Audience Network native', platform: 'audience_network', layout: 'native' },
  { key: 'an_interstitial', label: 'Audience Network interstitial', platform: 'audience_network', layout: 'interstitial', noCarousel: true },
  { key: 'an_rewarded_video', label: 'Audience Network rewarded video', platform: 'audience_network', layout: 'interstitial', videoOnly: true },
];
export const placementOf = (k: string) => PLACEMENTS.find((p) => p.key === k) || PLACEMENTS[0];

const PLATFORM_LABEL: Record<PreviewPlatform, string> = {
  facebook: 'Facebook', instagram: 'Instagram', messenger: 'Messenger', whatsapp: 'WhatsApp', audience_network: 'Audience Network',
};
const PLATFORM_ICON: Record<PreviewPlatform, string> = {
  facebook: 'facebook', instagram: 'photo_camera', messenger: 'forum', whatsapp: 'chat', audience_network: 'apps',
};

/** Why Meta won't show this ad in a placement ('' = it can). */
export function placementSkip(p: PlacementDef, spec: AdsCampaignSpec): string {
  const c = spec.creative;
  const isVideo = c.format === 'video' || (c.format === 'post' && (c.post?.mediaType === 'VIDEO' || c.post?.productType === 'REELS'));
  if (p.videoOnly && !isVideo) return 'Only video ads run here.';
  if (p.noCarousel && c.format === 'post' && c.post?.mediaType === 'CAROUSEL_ALBUM') return 'Carousels don’t run here.';
  if (p.noCarousel && spec.creative.format === 'carousel') return 'Carousels don’t run here.';
  return '';
}

/** Same check as the server: only an https facebook.com preview URL is rendered. */
const safeSrc = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && /^(www\.|business\.|m\.)?facebook\.com$/.test(u.hostname) && u.pathname.startsWith('/ads/api/preview_iframe.php') ? u.toString() : '';
  } catch {
    return '';
  }
};

// ------------------------------------------------------------ sketches --

const CTA: Record<string, string> = {
  WHATSAPP_MESSAGE: 'Send WhatsApp message', LEARN_MORE: 'Learn more', SHOP_NOW: 'Shop now', SIGN_UP: 'Sign up', BOOK_NOW: 'Book now',
  CONTACT_US: 'Contact us', ORDER_NOW: 'Order now', GET_OFFER: 'Get offer', SUBSCRIBE: 'Subscribe', APPLY_NOW: 'Apply now', GET_QUOTE: 'Get quote',
  DOWNLOAD: 'Download', WATCH_MORE: 'Watch more', BUY_NOW: 'Buy now', NO_BUTTON: '',
};

function useAd(spec: AdsCampaignSpec, pageName: string, igName: string) {
  const c = spec.creative;
  const post = c.format === 'post' ? c.post || null : null;
  const carousel = c.format === 'carousel';
  const media = post ? post.picture || '' : c.format === 'video' ? c.videoThumbUrl || '' : carousel ? c.cards.find((k) => k.imageUrl)?.imageUrl || '' : c.imageUrl || '';
  return {
    c,
    carousel,
    video: c.format === 'video' || post?.mediaType === 'VIDEO' || post?.productType === 'REELS',
    media,
    page: pageName || 'Your Page',
    ig: igName || (pageName ? pageName.toLowerCase().replace(/[^a-z0-9._]+/g, '') : 'yourpage'),
    initial: (pageName || 'P').slice(0, 1).toUpperCase(),
    text: post ? post.text || ' ' : c.primaryText || 'Your primary text shows here.',
    headline: post ? '' : c.headline || (carousel ? c.cards[0]?.headline : '') || 'Headline',
    cta: CTA[c.cta] ?? c.cta,
    sub: spec.objective === 'whatsapp' ? 'WhatsApp' : c.displayLink ? c.displayLink.toUpperCase() : '',
  };
}
type Ad = ReturnType<typeof useAd>;

function Media({ ad, ratio = 'square', children }: { ad: Ad; ratio?: 'square' | 'tall' | 'wide' | 'fill'; children?: ReactNode }) {
  return (
    <div className={`ads-ph-media ${ratio}`}>
      {ad.carousel && ratio === 'square' ? (
        <div className="ads-ph-cards">
          {(ad.c.cards.length ? ad.c.cards : [{ imageUrl: '' }, { imageUrl: '' }]).slice(0, 3).map((k, i) => (
            <span key={i}>{k.imageUrl ? <img src={k.imageUrl} alt="" referrerPolicy="no-referrer" /> : <i className="material-icons">image</i>}</span>
          ))}
        </div>
      ) : ad.media ? (
        <img src={ad.media} alt="" referrerPolicy="no-referrer" />
      ) : (
        <i className="material-icons">{ad.video ? 'movie' : 'image'}</i>
      )}
      {ad.video && <span className="ads-ph-play material-icons">play_circle</span>}
      {children}
    </div>
  );
}

/**
 * A carousel the way the feeds show it: Facebook as a strip of cards (each
 * with its own headline, description and button) that scrolls sideways,
 * Instagram one card at a time with a 1/n counter and dots. Swipe or scroll
 * it, or use the arrows on the sides.
 */
function CarouselStrip({ ad, variant, testid }: { ad: Ad; variant: 'facebook' | 'instagram'; testid?: string }) {
  const cards = ad.c.cards.length ? ad.c.cards : [{ imageUrl: '', headline: '', description: '', link: '' }, { imageUrl: '', headline: '', description: '', link: '' }];
  const n = cards.length;
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const cardEls = () => Array.from(ref.current?.children || []) as HTMLElement[];
  const go = (i: number) => {
    const el = ref.current;
    const target = cardEls()[Math.max(0, Math.min(n - 1, i))];
    if (!el || !target) return;
    // Scroll so the card starts at the strip's left edge (the strip's padding stays visible).
    const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    el.scrollTo({ left: target.offsetLeft - pad, behavior: 'smooth' });
    setAt(Math.max(0, Math.min(n - 1, i)));
  };
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft;
    const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    let best = 0;
    let bestD = Infinity;
    // The track is the cards' offsetParent, so offsetLeft is the card's place in the scrolled content.
    cardEls().forEach((c, i) => {
      const d = Math.abs(c.offsetLeft - pad - left);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 2) best = n - 1;
    setAt(best);
  };
  useEffect(() => {
    if (at > n - 1) setAt(Math.max(0, n - 1));
  }, [n, at]);
  const sub = (k: (typeof cards)[number]) => k.description || ad.sub || (k.link ? k.link.replace(/^https?:\/\//, '').split('/')[0].toUpperCase() : '');
  return (
    <div className={`ads-ph-car ${variant}`} data-testid={testid}>
      <div className="ads-ph-car-track" ref={ref} onScroll={onScroll} data-testid={testid ? `${testid}-track` : undefined}>
        {cards.map((k, i) => (
          <div className="ads-ph-car-card" key={i} data-testid={testid ? `${testid}-card-${i}` : undefined}>
            <div className="ads-ph-car-img">
              {k.imageUrl ? <img src={k.imageUrl} alt="" referrerPolicy="no-referrer" draggable={false} /> : <i className="material-icons">image</i>}
            </div>
            {variant === 'facebook' && (
              <div className="ads-ph-car-foot">
                <span>
                  <strong>{k.headline || 'Headline'}</strong>
                  {sub(k) ? <small>{sub(k)}</small> : null}
                </span>
                {ad.cta && <span className="ads-ph-btn">{ad.cta}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      {variant === 'instagram' && <span className="ads-ph-car-count">{at + 1}/{n}</span>}
      {at > 0 && (
        <button type="button" className="ads-ph-car-arrow prev" aria-label="Previous card" onClick={() => go(at - 1)} data-testid={testid ? `${testid}-prev` : undefined}>
          <i className="material-icons" aria-hidden="true">chevron_left</i>
        </button>
      )}
      {at < n - 1 && (
        <button type="button" className="ads-ph-car-arrow next" aria-label="Next card" onClick={() => go(at + 1)} data-testid={testid ? `${testid}-next` : undefined}>
          <i className="material-icons" aria-hidden="true">chevron_right</i>
        </button>
      )}
      {variant === 'instagram' && (
        <div className="ads-ph-car-dots" aria-hidden="true">
          {cards.map((_, i) => <i key={i} className={i === at ? 'on' : ''} />)}
        </div>
      )}
    </div>
  );
}

function Avatar({ ad, ring }: { ad: Ad; ring?: boolean }) {
  return <span className={`ads-ph-av${ring ? ' ring' : ''}`}>{ad.initial}</span>;
}

/** A phone-style sketch of the ad in one placement. */
export function PlacementSketch({
  p, spec, pageName, igName = '', testid,
}: { p: PlacementDef; spec: AdsCampaignSpec; pageName: string; igName?: string; testid?: string }) {
  const ad = useAd(spec, pageName, igName);
  const ig = p.platform === 'instagram';
  const name = ig ? ad.ig : ad.page;
  let body: ReactNode;
  if (p.layout === 'story' || p.layout === 'reels') {
    const wa = p.platform === 'whatsapp';
    body = (
      <div className={`ads-ph-story ${p.platform} ${p.layout}`}>
        <Media ad={ad} ratio="fill" />
        <div className="ads-ph-story-top">
          {p.layout === 'story' && <div className="ads-ph-bars"><i /><i /></div>}
          <div className="ads-ph-story-who">
            {wa ? <span className="ads-ph-wa-status">Status</span> : null}
            <Avatar ad={ad} ring={!wa} />
            <span><strong>{name}</strong><small>Sponsored</small></span>
            <span className="material-icons">more_horiz</span>
          </div>
        </div>
        <div className="ads-ph-story-foot">
          {p.layout === 'reels' && <p>{ad.text}</p>}
          {ad.cta && (
            <span className={`ads-ph-cta-pill ${p.platform}`}>
              {p.layout === 'story' && <i className="material-icons">keyboard_arrow_up</i>}
              {ad.cta}
            </span>
          )}
        </div>
        {p.layout === 'reels' && (
          <div className="ads-ph-reel-side">
            <i className="material-icons">favorite_border</i>
            <i className="material-icons">chat_bubble_outline</i>
            <i className="material-icons">send</i>
          </div>
        )}
      </div>
    );
  } else if (p.layout === 'inbox') {
    body = (
      <div className="ads-ph-inbox">
        <div className="ads-ph-inbox-head"><strong>Chats</strong><i className="material-icons">edit_square</i></div>
        <div className="ads-ph-inbox-row ad">
          <Avatar ad={ad} />
          <span>
            <strong>{ad.page}</strong>
            <small>Sponsored · {ad.text}</small>
          </span>
          <span className="thumb">{ad.media ? <img src={ad.media} alt="" referrerPolicy="no-referrer" /> : <i className="material-icons">image</i>}</span>
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ads-ph-inbox-row"><span className="ads-ph-av ghost" /><span><b /><b className="short" /></span></div>
        ))}
      </div>
    );
  } else if (p.layout === 'column') {
    body = (
      <div className="ads-ph-column">
        <small>Sponsored</small>
        <div className="ads-ph-column-ad">
          <Media ad={ad} ratio="wide" />
          <span><strong>{ad.headline}</strong><small>{ad.sub || ad.page}</small></span>
        </div>
      </div>
    );
  } else if (p.layout === 'grid') {
    body = (
      <div className="ads-ph-grid">
        <div className="ads-ph-grid-tile ad">
          <Media ad={ad} ratio="fill" />
          <span className="tag">Sponsored</span>
        </div>
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="ads-ph-grid-tile" />)}
        <p className="ads-ph-grid-cap"><strong>{p.platform === 'instagram' ? ad.ig : ad.headline}</strong> {ad.cta}</p>
      </div>
    );
  } else if (p.layout === 'video') {
    body = (
      <div className="ads-ph-video">
        <div className="ads-ph-video-player">
          <Media ad={ad} ratio="wide" />
          <span className="ads-ph-video-ad">Ad · {ad.page}</span>
          <span className="ads-ph-video-bar"><i /></span>
        </div>
        <div className="ads-ph-video-cta">
          <span><strong>{ad.headline}</strong><small>{ad.sub}</small></span>
          {ad.cta && <span className="ads-ph-btn">{ad.cta}</span>}
        </div>
      </div>
    );
  } else if (p.layout === 'native') {
    body = (
      <div className="ads-ph-native">
        <div className="ads-ph-app-bar"><i className="material-icons">menu</i><b /></div>
        <div className="ads-ph-native-ad">
          <span className="ads-ph-adtag">Ad</span>
          <div className="who"><Avatar ad={ad} /><strong>{ad.page}</strong></div>
          <Media ad={ad} ratio="wide" />
          <p>{ad.text}</p>
          {ad.cta && <span className="ads-ph-btn block">{ad.cta}</span>}
        </div>
        <b className="ghost-line" /><b className="ghost-line short" />
      </div>
    );
  } else if (p.layout === 'interstitial') {
    body = (
      <div className="ads-ph-inter">
        <span className="close material-icons">close</span>
        <Media ad={ad} ratio="tall" />
        <div className="who"><Avatar ad={ad} /><strong>{ad.page}</strong><span className="ads-ph-adtag">Ad</span></div>
        <p><strong>{ad.headline}</strong></p>
        {ad.cta && <span className="ads-ph-btn block">{ad.cta}</span>}
      </div>
    );
  } else if (ig) {
    body = (
      <div className="ads-ph-feed instagram">
        <div className="ads-ph-feed-head"><Avatar ad={ad} ring /><span><strong>{ad.ig}</strong><small>Sponsored</small></span><i className="material-icons">more_horiz</i></div>
        {ad.carousel ? <CarouselStrip ad={ad} variant="instagram" testid={testid ? `${testid}-carousel` : undefined} /> : <Media ad={ad} ratio="square" />}
        {ad.cta && <div className="ads-ph-ig-cta"><span>{ad.cta}</span><i className="material-icons">chevron_right</i></div>}
        <div className="ads-ph-ig-icons">
          <i className="material-icons">favorite_border</i><i className="material-icons">chat_bubble_outline</i><i className="material-icons">send</i>
          <span className="grow" /><i className="material-icons">bookmark_border</i>
        </div>
        <p className="ads-ph-ig-cap"><strong>{ad.ig}</strong> {ad.text}</p>
      </div>
    );
  } else {
    body = (
      <div className={`ads-ph-feed facebook${p.layout === 'desktop' ? ' desktop' : ''}`}>
        <div className="ads-ph-feed-head">
          <Avatar ad={ad} />
          <span><strong>{ad.page}</strong><small>Sponsored · <i className="material-icons">public</i></small></span>
          <i className="material-icons">more_horiz</i>
        </div>
        <p className="ads-ph-text">{ad.text}</p>
        {ad.carousel ? (
          <CarouselStrip ad={ad} variant="facebook" testid={testid ? `${testid}-carousel` : undefined} />
        ) : (
          <>
            <Media ad={ad} ratio="square" />
            <div className="ads-ph-fb-foot">
              <span>{ad.sub ? <small>{ad.sub}</small> : null}<strong>{ad.headline}</strong></span>
              {ad.cta && <span className="ads-ph-btn">{p.platform === 'facebook' && spec.objective === 'whatsapp' ? <i className="material-icons">chat</i> : null}{ad.cta}</span>}
            </div>
          </>
        )}
        <div className="ads-ph-fb-actions">
          <span><i className="material-icons">thumb_up_off_alt</i>Like</span>
          <span><i className="material-icons">chat_bubble_outline</i>Comment</span>
          <span><i className="material-icons">share</i>Share</span>
        </div>
      </div>
    );
  }
  return (
    <div className={`ads-ph ${p.layout}`} data-testid={testid} data-placement={p.key}>
      {p.layout !== 'desktop' && p.layout !== 'column' && <div className="ads-ph-status"><span>9:41</span><span className="material-icons">signal_cellular_alt</span></div>}
      {body}
    </div>
  );
}

// --------------------------------------------------- Meta's previews --

type Shot = { key: string; src?: string; error?: string; loading?: boolean };

/**
 * Meta's preview for each placement in `list`, at most `concurrency` asks at
 * a time (each is one generatepreviews call; the server caches them for ten
 * minutes). `dkey` changes when the ad changes.
 */
export function useMetaPreviews(api: CrmApi, spec: AdsCampaignSpec, list: PlacementDef[], dkey: string, ready: boolean, concurrency = 3) {
  const [shots, setShots] = useState<Record<string, Shot>>({});
  const specRef = useRef(spec);
  specRef.current = spec;
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  const listKey = list.map((p) => p.key).join(',');
  const [nonce, setNonce] = useState(0);
  // A request still on its way is shared by a later run (StrictMode, a filter
  // change), so Meta is never asked twice for the same placement and ad.
  const inflight = useRef(new Map<string, ReturnType<CrmApi['previewAdsCreative']>>());
  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    // Not asked yet for this ad, or asked by a run that was cancelled (filter changed) before Meta answered.
    const todo = list.filter((p) => !placementSkip(p, specRef.current) && (shotsRef.current[p.key]?.key !== dkey || shotsRef.current[p.key]?.loading));
    if (!todo.length) return undefined;
    setShots((s) => {
      const next = { ...s };
      for (const p of todo) next[p.key] = { key: dkey, loading: true };
      return next;
    });
    let i = 0;
    let paused = false;
    const worker = async () => {
      while (live && !paused && i < todo.length) {
        const p = todo[i];
        i += 1;
        try {
          const k = `${p.key}|${dkey}`;
          let req = inflight.current.get(k);
          if (!req) {
            req = api.previewAdsCreative(specRef.current, p.key);
            inflight.current.set(k, req);
            req.catch(() => {}).finally(() => inflight.current.delete(k));
          }
          // eslint-disable-next-line no-await-in-loop
          const r = await req;
          if (!live) return;
          const src = safeSrc(r.src);
          setShots((s) => ({ ...s, [p.key]: src ? { key: dkey, src } : { key: dkey, error: 'Meta returned a preview the CRM can’t show.' } }));
        } catch (e) {
          if (!live) return;
          const busy = errCode(e) === 'RATE_LIMITED';
          if (busy) paused = true;
          setShots((s) => ({ ...s, [p.key]: { key: dkey, error: busy ? 'Meta is busy, try again shortly.' : errCode(e) === 'NO_PREVIEW' ? 'Meta has no preview of this ad for this placement.' : errText(e) } }));
        }
      }
      // Meta said it's busy: the ones not asked yet stay sketches.
      if (live && paused) {
        setShots((s) => {
          const next = { ...s };
          for (const p of todo) if (next[p.key]?.loading) next[p.key] = { key: dkey, error: 'Meta is busy, try again shortly.' };
          return next;
        });
      }
    };
    for (let w = 0; w < Math.min(concurrency, todo.length); w += 1) void worker();
    return () => {
      live = false;
    };
  }, [api, dkey, ready, listKey, concurrency, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = (key: string) => {
    shotsRef.current = { ...shotsRef.current, [key]: { key: '' } };
    setShots((s) => ({ ...s, [key]: { key: '' } }));
    setNonce((n) => n + 1);
  };
  return { shots, retry };
}

const FILTERS: ['all' | PreviewPlatform, string][] = [
  ['all', 'All placements'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['messenger', 'Messenger'], ['whatsapp', 'WhatsApp'], ['audience_network', 'Audience Network'],
];

/** One placement: its name, then Meta's preview, or the sketch (with why). */
export function PlacementCard({
  p, spec, pageName, igName, shot, ready, dkey, skip, onRetry,
}: { p: PlacementDef; spec: AdsCampaignSpec; pageName: string; igName: string; shot?: Shot; ready: boolean; dkey: string; skip: string; onRetry: () => void }) {
  const meta = ready && !skip && shot?.key === dkey && shot.src;
  return (
    <figure className={`ads-pv-card${skip ? ' skipped' : ''}`} data-testid={`ads-pv-card-${p.key}`} data-state={skip ? 'skipped' : meta ? 'meta' : shot?.loading ? 'loading' : shot?.error ? 'error' : 'sketch'}>
      <figcaption>
        <span className={`ads-pv-plat ${p.platform}`}><i className="material-icons">{PLATFORM_ICON[p.platform]}</i></span>
        {p.label}
      </figcaption>
      {meta ? (
        <iframe
          className={`ads-pv-iframe ${p.layout}`}
          src={shot!.src}
          title={`Meta preview: ${p.label}`}
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          loading="lazy"
          data-testid={`ads-pv-iframe-${p.key}`}
        />
      ) : (
        <>
          <PlacementSketch p={p} spec={spec} pageName={pageName} igName={igName} testid={`ads-pv-sketch-${p.key}`} />
          <p className="ads-pv-note">
            {skip
              ? skip
              : !ready
                ? 'Sketch: Meta’s preview appears once the Page, the media and the text are in place.'
                : shot?.loading
                  ? 'Loading Meta’s preview…'
                  : shot?.error
                    ? <>Sketch. {shot.error} <button type="button" className="link" onClick={onRetry}>Try again</button></>
                    : 'Sketch'}
          </p>
        </>
      )}
    </figure>
  );
}

/** The "All placements" gallery (opened from the wizard's preview panel). */
export function AllPlacementsDialog({
  api, spec, pageName, igName = '', ready, dkey, onClose,
}: { api: CrmApi; spec: AdsCampaignSpec; pageName: string; igName?: string; ready: boolean; dkey: string; onClose: () => void }) {
  const [filter, setFilter] = useState<'all' | PreviewPlatform>('all');
  const list = useMemo(() => PLACEMENTS.filter((p) => filter === 'all' || p.platform === filter), [filter]);
  const { shots, retry } = useMetaPreviews(api, spec, list, dkey, ready);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, PLACEMENTS.filter((p) => k === 'all' || p.platform === k).length])), []);
  return (
    <ManageDialog title="Ad preview · all placements" testid="ads-pv-all" onClose={onClose} wide>
      <div className="ads-pv-filters" role="tablist" aria-label="Platform">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)} data-testid={`ads-pv-filter-${k}`}>
            {l} <span>{counts[k]}</span>
          </button>
        ))}
      </div>
      <p className="ads-wz-hint">
        {ready
          ? 'Meta’s own rendering of your ad in each placement. Where Meta can’t show this ad, a sketch shows the layout instead.'
          : 'Sketches of how each placement lays out your ad. Meta’s own previews load here once the Page, the media and the text are in place.'}
        {' '}Where your ad actually runs depends on the placements step ({spec.placements.mode === 'automatic' ? 'Advantage+ placements: Meta picks' : 'manual placements'}).
      </p>
      <div className="ads-pv-strip" data-testid="ads-pv-strip">
        {list.map((p) => (
          <PlacementCard key={p.key} p={p} spec={spec} pageName={pageName} igName={igName} shot={shots[p.key]} ready={ready} dkey={dkey} skip={placementSkip(p, spec)} onRetry={() => retry(p.key)} />
        ))}
      </div>
    </ManageDialog>
  );
}

export { PLATFORM_LABEL };
