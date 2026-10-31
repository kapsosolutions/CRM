// Campaigns → New campaign → Messenger / Instagram.
//
// The audience is the business's own chats on that channel (everyone, or
// those active in the last N days), counted live: how many are inside the
// 24-hour window right now and how many are outside it. What each contact
// gets is decided by the server when their turn comes (the window is checked
// again then):
//   Messenger — a quick message (inside the window only), an approved utility
//               template (anyone, updates only), or both (quick inside, the
//               template for everyone else);
//   Instagram — a quick message, or text with an optional image, inside the
//               window only; everyone else is skipped.
import { useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type {
  CampaignDetail, CampaignInput, MetaAudienceCounts, MetaCampaignContent, MetaCampaignInitialContent, MetaChannel, MetaChannelConnection,
  QuickMessage, QuickMessageInput, UtilityTemplate,
} from '../types';
import { CHANNEL_LABEL, errorText, paramCount, quickProblems } from '../metaMessaging';
import { QuickMessagePreview, UtilityPreview } from './MetaTemplates';
import { Dropdown } from './Dropdown';
import { useConfirm, useNotify } from './Dialogs';
import './MetaMessaging.css';

interface Props {
  api: CrmApi;
  channel: MetaChannel;
  /** A draft or scheduled campaign being edited. */
  initial?: CampaignDetail | null;
  /** A new campaign: preselect this quick message or utility template ("Use in campaign"). */
  initialContent?: MetaCampaignInitialContent | null;
  onBack: () => void;
  onSaved: () => void;
  onNavigate?: (view: string) => void;
}

const ACTIVE_OPTIONS = [
  { value: '0', label: 'Everyone who has messaged you' },
  { value: '1', label: 'Active in the last 24 hours' },
  { value: '7', label: 'Active in the last 7 days' },
  { value: '30', label: 'Active in the last 30 days' },
  { value: '90', label: 'Active in the last 90 days' },
];
const ICON: Record<MetaChannel, string> = { messenger: '/channel-messenger.svg', instagram: '/channel-instagram.svg' };

function toLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function MetaCampaignCreate({ api, channel, initial, initialContent, onBack, onSaved, onNavigate }: Props) {
  const notify = useNotify();
  const confirm = useConfirm();
  const label = CHANNEL_LABEL[channel];
  const ic = initial?.content || null;
  // A utility template only exists on Messenger; a preselected one opens in that mode.
  const pre = !ic ? initialContent || null : null;
  const preUtility = channel === 'messenger' ? pre?.utilityTemplateId || '' : '';
  const [name, setName] = useState(initial?.name || '');
  const [activeDays, setActiveDays] = useState(String(initial?.audienceFilter?.activeDays ?? 0));
  const [counts, setCounts] = useState<MetaAudienceCounts | null>(null);
  const [mode, setMode] = useState<MetaCampaignContent['mode']>(ic?.mode || (preUtility ? 'utility' : 'quick'));
  const [quickId, setQuickId] = useState(ic?.quickMessageId || pre?.quickMessageId || '');
  const [utilityId, setUtilityId] = useState(ic?.utilityTemplateId || preUtility);
  const [bodyVals, setBodyVals] = useState<string[]>(ic?.utilityParams?.body || []);
  const [btnVals, setBtnVals] = useState<string[]>(ic?.utilityParams?.buttons || []);
  const [text, setText] = useState(ic?.text || '');
  const [imageUrl, setImageUrl] = useState(ic?.imageUrl || '');
  const [confirmed, setConfirmed] = useState(!!ic?.confirmedNonPromotional);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>(initial?.status === 'scheduled' ? 'later' : 'now');
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput(initial?.scheduledAt ? new Date(initial.scheduledAt) : new Date(Date.now() + 3600 * 1000)));
  const [quick, setQuick] = useState<QuickMessage[]>([]);
  const [templates, setTemplates] = useState<UtilityTemplate[]>([]);
  const [conn, setConn] = useState<MetaChannelConnection | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getQuickMessages(channel).then((r) => setQuick(r.data || [])).catch(() => setQuick([]));
    if (channel === 'messenger') api.getUtilityTemplates().then((r) => setTemplates(r.data || [])).catch(() => setTemplates([]));
    api.getMetaChannels().then((r) => setConn(r.connections[channel])).catch(() => setConn(null));
  }, [api, channel]);
  useEffect(() => {
    let live = true;
    api.getCampaignAudience(channel, Number(activeDays)).then((r) => { if (live) setCounts(r); }).catch(() => { if (live) setCounts(null); });
    return () => { live = false; };
  }, [api, channel, activeDays]);

  const usesQuick = mode === 'quick' || mode === 'both';
  const usesUtility = channel === 'messenger' && (mode === 'utility' || mode === 'both');
  const approved = templates.filter((t) => t.status === 'APPROVED' && t.onCurrentPage);
  const qm = quick.find((q) => q._id === quickId) || null;
  const tpl = templates.find((t) => t._id === utilityId) || null;
  const nParams = tpl ? paramCount(tpl.bodyText) : 0;
  const connected = conn?.status === 'connected';

  // Changing the template resets its values (sized to its placeholders).
  useEffect(() => {
    if (!tpl) return;
    setBodyVals((v) => Array.from({ length: nParams }, (_, i) => v[i] || ''));
    setBtnVals((v) => Array.from({ length: tpl.urlParamCount }, (_, i) => v[i] || ''));
  }, [tpl, nParams]);

  const textMessage: QuickMessageInput = useMemo(() => (imageUrl.trim()
    ? { name: 'Text', channels: [channel], kind: 'image', text, imageUrl: imageUrl.trim(), buttons: [], cards: [], quickReplies: [] }
    : { name: 'Text', channels: [channel], kind: 'text', text, imageUrl: '', buttons: [], cards: [], quickReplies: [] }), [text, imageUrl, channel]);

  const inW = counts?.inWindow ?? 0;
  const outW = counts?.outsideWindow ?? 0;
  const total = counts?.total ?? 0;

  /** What would block "Send now" / "Schedule". */
  const blocker = (() => {
    if (!name.trim()) return 'Give the campaign a name.';
    if (conn === null || (conn && !connected)) return `${label} isn’t connected. Connect it on Channel Status first.`;
    if (usesQuick && !qm) return 'Choose a quick message.';
    if (usesQuick && qm && quickProblems(qm, channel).length) return quickProblems(qm, channel)[0].message;
    if (mode === 'text' && quickProblems(textMessage, channel).length) return quickProblems(textMessage, channel)[0].message;
    if (usesUtility && !tpl) return 'Choose an approved utility template.';
    if (usesUtility && tpl) {
      const missing = tpl.variables.some((v, i) => v.source === 'text' && !v.fallback && !(bodyVals[i] || '').trim() && i < nParams)
        || btnVals.some((v) => !v.trim());
      if (missing) return 'Fill in the template’s values.';
      if (!confirmed) return 'Tick the box to confirm this is an update or reminder, not marketing.';
    }
    if (!total) return `No ${label} contacts in this audience.`;
    if (scheduleMode === 'later' && new Date(scheduledAt).getTime() <= Date.now()) return 'Pick a future date and time.';
    return '';
  })();

  function body(m: CampaignInput['mode']): CampaignInput {
    return {
      name: name.trim(),
      channel,
      mode: m,
      recipients: [],
      audience: { activeDays: Number(activeDays) },
      ...(scheduleMode === 'later' && scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
      content: {
        mode,
        ...(usesQuick ? { quickMessageId: quickId } : {}),
        ...(usesUtility ? { utilityTemplateId: utilityId, utilityParams: { body: bodyVals, buttons: btnVals }, confirmedNonPromotional: confirmed } : {}),
        ...(mode === 'text' ? { text, imageUrl: imageUrl.trim() } : {}),
      },
    };
  }

  function outcome(): string {
    if (channel === 'instagram' || mode === 'quick' || mode === 'text') {
      return `${inW} of ${total} are inside the 24-hour window right now and would get it; ${outW} would be skipped (outside the 24-hour window).`;
    }
    if (mode === 'utility') return `All ${total} would get the utility template (allowed outside the window for updates).`;
    return `${inW} would get the quick message, ${outW} the utility template.`;
  }

  async function save(m: CampaignInput['mode']) {
    setError('');
    if (m !== 'draft') {
      if (blocker) { setError(blocker); return; }
      const ok = await confirm({
        title: m === 'now' ? `Send this ${label} campaign now?` : `Schedule this ${label} campaign?`,
        message: `${outcome()} The window is checked again for each contact when their message goes out.`,
        confirmLabel: m === 'now' ? 'Send now' : 'Schedule',
        tone: 'primary',
      });
      if (!ok) return;
    } else if (!name.trim()) {
      setError('Give the campaign a name.');
      return;
    }
    setSaving(true);
    try {
      if (initial?._id) await api.updateCampaign(initial._id, body(m));
      else await api.createCampaign(body(m));
      notify('success', m === 'draft' ? 'Draft saved' : m === 'now' ? 'Campaign started' : 'Campaign scheduled', `“${name.trim()}” on ${label}.`);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const contentOptions = channel === 'messenger'
    ? [
      { key: 'quick', title: 'A quick message', text: `Rich message (cards, buttons, chips). Only for contacts inside the 24-hour window; the rest are skipped.` },
      { key: 'utility', title: 'A utility template', text: 'Approved by Meta. Can go to everyone, also outside the window, but only for updates (orders, accounts, appointments, events).' },
      { key: 'both', title: 'Both', text: 'The quick message for contacts inside the window, the utility template for everyone else.' },
    ]
    : [
      { key: 'quick', title: 'A quick message', text: 'One of your saved Instagram quick messages.' },
      { key: 'text', title: 'Text, with an optional image', text: 'Write it here.' },
    ];

  return (
    <div className="page campaign-create-page mc-page" data-testid={`meta-campaign-${channel}`}>
      <header className="page-head campaign-create-head">
        <div className="camp-head-left">
          <button className="k-btn ghost sm camp-back-btn" onClick={onBack} title="Back to Campaigns Overview">
            <span className="material-icons">arrow_back</span>
            <span>Campaigns Overview</span>
          </button>
          <span className="camp-head-sep">/</span>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={ICON[channel]} alt="" width={22} height={22} /> {initial?._id ? 'Edit' : 'New'} {label} campaign
          </h2>
        </div>
      </header>
      <div className="page-body">
        <div className="mc-layout">
          <div className="mc-form">
            {conn !== undefined && !connected && (
              <div className="mm-connect" data-testid="mc-not-connected">
                <img src={ICON[channel]} alt="" />
                <div>
                  <strong>{label} isn’t connected</strong>
                  <p>You can save a draft; to send, connect {label} on Channel Status.</p>
                </div>
                {onNavigate && <button type="button" className="k-btn ghost" onClick={() => onNavigate(`channel-status:${channel}`)}>Connect {label}</button>}
              </div>
            )}
            {channel === 'instagram' ? (
              <p className="mm-notice warn" data-testid="mc-ig-explain">
                <span className="material-icons">schedule</span>
                <span>
                  Instagram only allows messages within 24 hours of the customer’s last message, and has no approved templates.
                  This campaign goes <strong>only to contacts who are inside the 24-hour window when their message is sent</strong>;
                  everyone else is skipped with the reason “outside the 24-hour window”.
                </span>
              </p>
            ) : (
              <p className="mm-notice" data-testid="mc-msg-explain">
                <span className="material-icons">info</span>
                <span>
                  Messenger allows any message within 24 hours of the customer’s last message. After that, only an approved utility
                  template, and only for updates and reminders, never promotions.
                </span>
              </p>
            )}

            <div className="k-field">
              <label className="k-label" htmlFor="mc-name">Campaign name</label>
              <input id="mc-name" className="k-input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${label} weekend update`} />
            </div>

            <div className="k-field">
              <span className="k-label">Audience: your {label} chats</span>
              <Dropdown options={ACTIVE_OPTIONS} value={activeDays} onChange={setActiveDays} />
              <div className="mc-counts" data-testid="mc-counts">
                <div className="mc-count"><strong data-testid="mc-total">{counts ? total : '…'}</strong><span>contacts</span></div>
                <div className="mc-count in"><strong data-testid="mc-in">{counts ? inW : '…'}</strong><span>inside the 24-hour window now</span></div>
                <div className="mc-count out"><strong data-testid="mc-out">{counts ? outW : '…'}</strong><span>outside it</span></div>
              </div>
              {counts?.capped && <p className="err">More than 5,000 contacts: narrow the audience.</p>}
            </div>

            <div className="k-field">
              <span className="k-label">What to send</span>
              {contentOptions.map((o) => (
                <label key={o.key} className={`mc-option${mode === o.key ? ' on' : ''}`} data-testid={`mc-mode-${o.key}`}>
                  <input type="radio" name="mc-mode" checked={mode === o.key} onChange={() => setMode(o.key as MetaCampaignContent['mode'])} />
                  <div><strong>{o.title}</strong><span>{o.text}</span></div>
                </label>
              ))}
            </div>

            {usesQuick && (
              <div className="k-field">
                <span className="k-label">Quick message</span>
                {quick.length ? (
                  <Dropdown options={quick.map((q) => ({ value: q._id, label: q.name }))} value={quickId} onChange={setQuickId} placeholder="Choose a quick message" />
                ) : (
                  <p className="k-hint">No {label} quick messages yet. Create one on the Templates page, {label} tab.</p>
                )}
              </div>
            )}
            {mode === 'text' && (
              <>
                <div className="k-field">
                  <label className="k-label" htmlFor="mc-text">Message</label>
                  <textarea id="mc-text" className="k-input mm-textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
                </div>
                <div className="k-field">
                  <label className="k-label" htmlFor="mc-image">Image (optional): an https:// address</label>
                  <input id="mc-image" className="k-input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
                </div>
              </>
            )}
            {usesUtility && (
              <div className="k-field">
                <span className="k-label">Utility template</span>
                {approved.length ? (
                  <Dropdown options={approved.map((t) => ({ value: t._id, label: `${t.name} (${t.language})` }))} value={utilityId} onChange={setUtilityId} placeholder="Choose an approved template" />
                ) : (
                  <p className="k-hint">No approved utility templates yet. Create one on the Templates page, Messenger tab.</p>
                )}
                {tpl && Array.from({ length: nParams }, (_, i) => {
                  const v = tpl.variables[i];
                  return (
                    <div className="mm-var-row" key={i}>
                      <code>{`{{${i + 1}}}`}</code>
                      {v?.source === 'contact_name' ? (
                        <span className="mm-var-ex">Each contact’s name{v.fallback ? ` (or “${v.fallback}”)` : ''}</span>
                      ) : (
                        <input className="k-input" value={bodyVals[i] || ''} placeholder={tpl.bodyExamples[i] || 'Value for everyone'} onChange={(e) => setBodyVals(bodyVals.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Value for {{${i + 1}}}`} />
                      )}
                    </div>
                  );
                })}
                {tpl && btnVals.map((v, i) => (
                  <div className="mm-var-row" key={`b${i}`}>
                    <code>Link {i + 1}</code>
                    <input className="k-input" value={v} placeholder="End of the link" onChange={(e) => setBtnVals(btnVals.map((x, j) => (j === i ? e.target.value : x)))} />
                  </div>
                ))}
                <label className="mc-confirm" data-testid="mc-confirm">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  <span>
                    This is an update or reminder about an order, account, appointment or event, <strong>not marketing</strong>{' '}
                    (no offers, discounts or promotions). Meta can restrict the Page for promotional utility messages.
                  </span>
                </label>
              </div>
            )}

            <div className="k-field">
              <span className="k-label">When</span>
              <div className="mm-seg" role="tablist">
                <button type="button" className={`mm-seg-btn${scheduleMode === 'now' ? ' active' : ''}`} onClick={() => setScheduleMode('now')}>Send now</button>
                <button type="button" className={`mm-seg-btn${scheduleMode === 'later' ? ' active' : ''}`} onClick={() => setScheduleMode('later')} data-testid="mc-later">Schedule</button>
              </div>
              {scheduleMode === 'later' && (
                <input className="k-input" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} aria-label="Send at" style={{ marginTop: 8, maxWidth: 260 }} />
              )}
            </div>

            {counts && total > 0 && <p className="mm-notice" data-testid="mc-outcome"><span className="material-icons">groups</span><span>{outcome()}</span></p>}
            {error && <p className="err" data-testid="mc-error">{error}</p>}
            <div className="mc-actions">
              <button type="button" className="k-btn ghost" onClick={() => save('draft')} disabled={saving} data-testid="mc-draft">
                <span className="material-icons">save</span> Save draft
              </button>
              <button
                type="button"
                className="k-btn"
                onClick={() => save(scheduleMode === 'later' ? 'schedule' : 'now')}
                disabled={saving || !!blocker}
                title={blocker || undefined}
                data-testid="mc-send"
              >
                <span className="material-icons">{scheduleMode === 'later' ? 'schedule_send' : 'send'}</span>
                {scheduleMode === 'later' ? 'Schedule' : 'Send now'}
              </button>
            </div>
            {blocker && <p className="k-hint" data-testid="mc-blocker">{blocker}</p>}
          </div>

          <aside className="mc-side">
            <span className="k-label">Preview</span>
            {usesQuick && qm && <QuickMessagePreview qm={qm} channel={channel} />}
            {mode === 'text' && <QuickMessagePreview qm={textMessage} channel={channel} />}
            {usesUtility && tpl && (
              <UtilityPreview
                bodyText={tpl.bodyText}
                values={Array.from({ length: nParams }, (_, i) => (tpl.variables[i]?.source === 'contact_name' ? 'Priya' : bodyVals[i] || tpl.bodyExamples[i] || ''))}
                buttons={tpl.buttons}
              />
            )}
            {!((usesQuick && qm) || mode === 'text' || (usesUtility && tpl)) && <p className="k-hint">Choose what to send to see it here.</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}
