// Template Library: a card gallery of ready-made templates, in the style of
// Meta's WhatsApp template library. Shown on Campaigns → Template Messages →
// Template Library and on Templates → Template Library.
//
//   WhatsApp   Meta's official library (GET /api/crm/templates/library, the
//              business's own WABA token server-side; read-only on the shared
//              test number). "Use template" creates it in the business's WABA.
//   Messenger  Meta's utility library (the existing search + clone to the Page)
//              and the CRM starters.
//   Instagram  The CRM starters (Instagram has no Meta template library).
// Messenger and Instagram are hidden for now (CHANNELS below): only WhatsApp shows.
// CRM starters are quick messages built into the CRM, labelled as such; "Use
// template" saves one as a quick message for that channel.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type {
  CampaignChannel, FieldProblem, LibraryTemplate, MetaCampaignInitialContent, MetaChannel, MetaChannelConnection, QuickCard,
  QuickMessage, QuickMessageInput, QuickStarter, TemplateComponent, TemplateItem, UtilityButton, UtilityTemplate, UtilityTemplateInput,
  UtilityVariable, WaLibraryTemplate, WaLibraryUseResult,
} from '../types';
import { CHANNEL_LABEL, errorCode, errorText, fieldError, paramCount, problemsOf } from '../metaMessaging';
import { Modal, QuickMessageEditor, QuickMessagePreview, UtilityCreateModal, VariablesEditor } from './MetaTemplates';
import { Dropdown, type KOption } from './Dropdown';
import { BladeSpinner } from './BladeSpinner';
import { useNotify } from './Dialogs';
import './MetaMessaging.css';
import './TemplateLibrary.css';

export type GalleryChannel = 'all' | CampaignChannel;

interface Props {
  api: CrmApi;
  onNavigate?: (view: string) => void;
  /** Start a WhatsApp campaign with this template. */
  onStartWhatsAppCampaign: (templateName: string) => void;
  /** Start a Messenger / Instagram campaign with this quick message or utility template. */
  onStartMetaCampaign: (channel: MetaChannel, content: MetaCampaignInitialContent) => void;
  /** Open that channel's own templates list. */
  onViewTemplates: (channel: CampaignChannel) => void;
  /** Something was created (lists elsewhere can reload). */
  onCreated?: (channel: CampaignChannel) => void;
  initialChannel?: GalleryChannel;
  /**
   * WhatsApp "Use template": open the Create template page filled in from it,
   * to edit and submit. Without it, the quick create dialog is used.
   */
  onEditWhatsApp?: (template: TemplateItem) => void;
}

/** A library template as a starting point for the WhatsApp Create template page. */
function waToTemplateItem(t: WaLibraryTemplate): TemplateItem {
  const auth = String(t.category).toUpperCase() === 'AUTHENTICATION';
  const components: TemplateComponent[] = [];
  if (t.header && !auth) components.push({ type: 'HEADER', format: 'TEXT', text: t.header } as TemplateComponent);
  components.push({ type: 'BODY', text: t.body } as TemplateComponent);
  if (t.footer) components.push({ type: 'FOOTER', text: t.footer } as TemplateComponent);
  const buttons = t.buttons.map((b) => {
    const type = String(b.type).toUpperCase();
    return type === 'OTP'
      ? { type: 'OTP', text: b.text, otp_type: 'COPY_CODE' }
      : { type, text: b.text, url: b.url, phone_number: b.phone };
  });
  if (buttons.length) components.push({ type: 'BUTTONS', buttons } as unknown as TemplateComponent);
  return {
    name: t.name,
    language: t.language || 'en_US',
    category: auth ? 'AUTHENTICATION' : 'UTILITY',
    kind: 'standard',
    bodyText: t.body,
    footerText: t.footer,
    components,
    variables: [],
  };
}

/** A Messenger library template as a starting point for the utility template form. */
function msgToUtilitySeed(t: LibraryTemplate): Partial<UtilityTemplateInput> {
  const language = /^en/i.test(t.language) ? 'en' : t.language || 'en';
  return {
    name: t.name,
    language,
    bodyText: t.body,
    bodyExamples: [...(t.bodyParams || [])],
    buttons: (t.buttons || [])
      .filter((b) => ['URL', 'PHONE_NUMBER'].includes(String(b.type).toUpperCase()))
      .slice(0, 3)
      .map((b) => ({ type: String(b.type).toUpperCase() as UtilityButton['type'], text: b.text, url: b.url || '', urlExample: '', phone: b.phone || '' })),
    variables: [],
  };
}

/** A CRM starter as a new quick message for that channel. */
function starterToQuick(s: QuickStarter, channel: MetaChannel): QuickMessageInput {
  return {
    name: s.name, channels: [channel], kind: s.kind, text: s.text, imageUrl: s.imageUrl,
    buttons: s.buttons, cards: s.cards, quickReplies: s.quickReplies,
  };
}

const ICON: Record<CampaignChannel, string> = { whatsapp: '/whatsapp.svg', messenger: '/channel-messenger.svg', instagram: '/channel-instagram.svg' };
const NAME: Record<CampaignChannel, string> = { whatsapp: 'WhatsApp', messenger: 'Messenger', instagram: 'Instagram' };
// WhatsApp only: Messenger / Instagram are hidden (campaigns are WhatsApp
// only). Their library code stays; add them back here to show them again.
const CHANNELS: CampaignChannel[] = ['whatsapp'];
export const LIBRARY_LANGUAGE_OPTIONS: KOption[] = [
  { value: 'en_US', label: 'English (US)' },
  { value: 'hi', label: 'Hindi' },
  { value: 'te', label: 'Telugu' },
  { value: 'ta', label: 'Tamil' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt_BR', label: 'Portuguese (BR)' },
  { value: 'id', label: 'Indonesian' },
  { value: 'ar', label: 'Arabic' },
];
const isEnglish = (l: string) => l === 'en_US' || l === 'en';
const CATEGORY_LABEL: Record<string, string> = { UTILITY: 'Utility', AUTHENTICATION: 'Authentication', CRM_STARTER: 'CRM starters' };
const PAGE = 24;
const SECTION_PREVIEW = 6;
const titleCase = (s: string) => {
  const v = String(s || '').replace(/_/g, ' ').toLowerCase();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : '';
};

type ButtonKind = 'url' | 'phone' | 'reply' | 'otp' | 'flow' | 'other';
interface Item {
  key: string;
  channel: CampaignChannel;
  source: 'meta' | 'starter';
  category: string;
  topic: string;
  topicLabel: string;
  industry: string[];
  name: string;
  title: string;
  body: string;
  footer: string;
  buttons: { kind: ButtonKind; text: string }[];
  chips: string[];
  cards: QuickCard[];
  language: string;
  wa?: WaLibraryTemplate;
  msg?: LibraryTemplate;
  starter?: QuickStarter;
}

const buttonKind = (type: string): ButtonKind => {
  const t = String(type || '').toUpperCase();
  if (t === 'URL') return 'url';
  if (t === 'PHONE_NUMBER') return 'phone';
  if (t === 'QUICK_REPLY') return 'reply';
  if (t === 'OTP' || t === 'COPY_CODE') return 'otp';
  if (t === 'FLOW' || t === 'FORMS') return 'flow';
  return 'other';
};
const BUTTON_ICON: Record<ButtonKind, string> = { url: 'open_in_new', phone: 'call', reply: 'reply', otp: 'content_copy', flow: 'list_alt', other: 'touch_app' };

function waItem(t: WaLibraryTemplate): Item {
  return {
    key: `wa:${t.name}:${t.language}`, channel: 'whatsapp', source: 'meta', category: t.category || 'UTILITY', topic: t.topic, topicLabel: titleCase(t.topic),
    industry: t.industry || [], name: t.name, title: t.header, body: t.body, footer: t.footer,
    buttons: t.buttons.map((b) => ({ kind: buttonKind(b.type), text: b.text || (buttonKind(b.type) === 'otp' ? 'Copy code' : 'Button') })),
    chips: [], cards: [], language: t.language, wa: t,
  };
}
function msgItem(t: LibraryTemplate): Item {
  return {
    key: `msg:${t.name}:${t.language}`, channel: 'messenger', source: 'meta', category: t.category || 'UTILITY', topic: t.topic, topicLabel: titleCase(t.topic),
    industry: t.industry || [], name: t.name, title: '', body: t.body, footer: '',
    buttons: t.buttons.map((b) => ({ kind: buttonKind(b.type), text: b.text || 'Button' })), chips: [], cards: [], language: t.language, msg: t,
  };
}
function starterItem(s: QuickStarter, channel: MetaChannel): Item {
  return {
    key: `starter:${channel}:${s.key}`, channel, source: 'starter', category: 'CRM_STARTER', topic: `starter:${s.category}`, topicLabel: s.categoryLabel,
    industry: [], name: s.name, title: '', body: s.kind === 'cards' ? '' : s.text, footer: '',
    buttons: s.kind === 'text' ? s.buttons.map((b) => ({ kind: (b.type === 'url' ? 'url' : 'reply') as ButtonKind, text: b.title })) : [],
    chips: s.kind === 'quick_replies' ? s.quickReplies.map((q) => q.title) : [], cards: s.kind === 'cards' ? s.cards : [], language: 'en', starter: s,
  };
}

/** Text with each {{…}} placeholder highlighted. */
function Highlighted({ text }: { text: string }) {
  const parts = String(text || '').split(/(\{\{[^}]+\}\})/g);
  return (
    <>
      {parts.map((p, i) => (/^\{\{[^}]+\}\}$/.test(p) ? <span key={i} className="tlb-ph">{p}</span> : <span key={i}>{p}</span>))}
    </>
  );
}

const clock = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** The message as a chat bubble on a chat-pattern background. */
function Bubble({ item, time }: { item: Item; time: string }) {
  return (
    <div className="tlb-chat">
      {item.cards.length > 0 ? (
        <div className="tlb-cards">
          {item.cards.slice(0, 3).map((c, i) => (
            <div className="tlb-bubble tlb-mini-card" key={i}>
              <div className="tlb-mini-img"><span className="material-icons" aria-hidden="true">image</span></div>
              <div className="tlb-b-title">{c.title}</div>
              {c.subtitle && <div className="tlb-b-body">{c.subtitle}</div>}
              {c.buttons.length > 0 && (
                <div className="tlb-b-btns">
                  {c.buttons.map((b, j) => (
                    <div className="tlb-b-btn" key={j}><span className="material-icons" aria-hidden="true">{b.type === 'url' ? 'open_in_new' : 'reply'}</span>{b.title}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {item.cards.length > 3 && <span className="tlb-more-cards">+{item.cards.length - 3}</span>}
        </div>
      ) : (
        <div className="tlb-bubble">
          {item.title && <div className="tlb-b-title"><Highlighted text={item.title} /></div>}
          <div className="tlb-b-body"><Highlighted text={item.body} /></div>
          {item.footer && <div className="tlb-b-footer">{item.footer}</div>}
          <div className="tlb-b-time">{time}</div>
          {item.buttons.length > 0 && (
            <div className="tlb-b-btns">
              {item.buttons.map((b, i) => (
                <div className="tlb-b-btn" key={i}><span className="material-icons" aria-hidden="true">{BUTTON_ICON[b.kind]}</span>{b.text}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {item.chips.length > 0 && (
        <div className="tlb-chips">{item.chips.map((c, i) => <span className="tlb-chip" key={i}>{c}</span>)}</div>
      )}
    </div>
  );
}

function LibraryCard({ item, time, actionLabel, onUse }: { item: Item; time: string; actionLabel: string; onUse: () => void }) {
  return (
    <article className="tlb-card" data-testid="tlb-card" data-name={item.name} data-channel={item.channel} data-source={item.source}>
      <Bubble item={item} time={time} />
      <div className="tlb-card-foot">
        <div className="tlb-card-name" title={item.name}>{item.name}</div>
        <div className="tlb-card-meta">
          <img src={ICON[item.channel]} alt={NAME[item.channel]} />
          {item.source === 'starter'
            ? <span className="tlb-badge starter" data-testid="tlb-starter-badge">CRM starter</span>
            : <span className="tlb-badge meta">{CATEGORY_LABEL[item.category] || titleCase(item.category)}</span>}
          {item.topicLabel && <span className="tlb-card-topic">{item.topicLabel}</span>}
        </div>
        <button type="button" className="k-btn sm tlb-use" onClick={onUse} data-testid="tlb-use">{actionLabel}</button>
      </div>
    </article>
  );
}

// =============================================================== use dialog ==

const STATUS_TEXT: Record<string, { label: string; tone: string; text: string }> = {
  APPROVED: { label: 'Approved', tone: 'green', text: 'Meta approved it right away. You can send it now.' },
  PENDING: { label: 'Pending review', tone: 'amber', text: 'Meta is reviewing it. It usually takes minutes; the status updates on the Templates page.' },
  REJECTED: { label: 'Rejected', tone: 'red', text: 'Meta rejected it. Open it on the Templates page to see why.' },
};

type Done =
  | { kind: 'whatsapp'; result: WaLibraryUseResult }
  | { kind: 'messenger'; template: UtilityTemplate }
  | { kind: 'starter'; channel: MetaChannel; qm: QuickMessage };

function UseDialog({
  api, item, waCanUse, waMode, messengerConnected, onClose, onNavigate, onStartWhatsAppCampaign, onStartMetaCampaign, onViewTemplates, onCreated,
}: {
  api: CrmApi; item: Item; waCanUse: boolean; waMode: string; messengerConnected: boolean; onClose: () => void;
} & Pick<Props, 'onNavigate' | 'onStartWhatsAppCampaign' | 'onStartMetaCampaign' | 'onViewTemplates' | 'onCreated'>) {
  const notify = useNotify();
  const defaultName = item.source === 'starter' ? item.name : item.name.replace(/[^a-z0-9_]/g, '_');
  const [name, setName] = useState(defaultName);
  const libButtons = item.wa?.buttons || item.msg?.buttons || [];
  const [inputs, setInputs] = useState<{ url?: string; urlSuffixExample?: string; phone?: string }[]>(() => libButtons.map(() => ({})));
  const [security, setSecurity] = useState(true);
  const [expiry, setExpiry] = useState('10');
  const [variables, setVariables] = useState<UtilityVariable[]>(() => Array.from({ length: paramCount(item.msg?.body || '') }, (_, i) => ({
    index: i + 1, source: i === 0 && /name/i.test(item.msg?.bodyParams?.[0] || '') ? 'contact_name' as const : 'text' as const, fallback: '',
  })));
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [editing, setEditing] = useState<QuickMessage | null>(null);
  const isAuth = item.category === 'AUTHENTICATION';
  const blocked = item.channel === 'whatsapp' ? !waCanUse : item.source === 'meta' && !messengerConnected;
  const err = (f: string) => fieldError(problems, f);

  async function submit() {
    setProblems([]);
    const local: FieldProblem[] = [];
    if (item.source === 'starter') {
      if (!name.trim()) local.push({ field: 'name', message: 'Give the quick message a name.' });
    } else {
      if (!/^[a-z0-9_]+$/.test(name)) local.push({ field: 'name', message: 'Use lowercase letters, numbers and underscores only in the name.' });
      libButtons.forEach((b, i) => {
        const t = String(b.type).toUpperCase();
        if (t === 'URL' && !/^https?:\/\/\S+$/.test(inputs[i]?.url || '')) local.push({ field: `buttonInputs.${i}.url`, message: `“${b.text}” needs your web address (https://…).` });
        if (t === 'URL' && /\{\{\s*1\s*\}\}$/.test(inputs[i]?.url || '') && !/^https?:\/\/\S+$/.test(inputs[i]?.urlSuffixExample || '')) local.push({ field: `buttonInputs.${i}.urlSuffixExample`, message: `“${b.text}”: add a full sample link for the {{1}} part.` });
        if (t === 'PHONE_NUMBER' && !/^\+\d{7,15}$/.test((inputs[i]?.phone || '').replace(/[\s()-]/g, ''))) local.push({ field: `buttonInputs.${i}.phone`, message: `“${b.text}” needs your phone number with the country code.` });
      });
    }
    if (local.length) { setProblems(local); return; }
    setSaving(true);
    try {
      if (item.channel === 'whatsapp' && item.wa) {
        const exp = expiry.trim() ? Number(expiry) : null;
        const r = await api.useWhatsAppLibraryTemplate({
          libraryTemplateName: item.wa.name, name, language: item.wa.language,
          buttonInputs: item.wa.buttons.map((b, i) => (b.input === 'url' ? { url: inputs[i]?.url || '', ...(inputs[i]?.urlSuffixExample ? { urlSuffixExample: inputs[i].urlSuffixExample } : {}) } : b.input === 'phone' ? { phone: inputs[i]?.phone || '' } : {})),
          ...(isAuth ? { bodyInputs: { addSecurityRecommendation: security, codeExpirationMinutes: exp } } : {}),
        });
        setDone({ kind: 'whatsapp', result: r.data });
        onCreated?.('whatsapp');
      } else if (item.msg) {
        const r = await api.cloneLibraryTemplate({
          libraryTemplateName: item.msg.name, name, language: item.msg.language,
          libraryBody: item.msg.body, libraryBodyParams: item.msg.bodyParams,
          libraryButtons: item.msg.buttons.map((b) => ({ type: b.type, text: b.text })),
          buttonInputs: item.msg.buttons.map((b, i) => (String(b.type).toUpperCase() === 'URL' ? { url: inputs[i]?.url || '' } : { phone: inputs[i]?.phone || '' })),
          variables,
        });
        setDone({ kind: 'messenger', template: r.data });
        onCreated?.('messenger');
      } else if (item.starter) {
        const ch = item.channel as MetaChannel;
        const r = await api.useQuickStarter(item.starter.key, ch, name.trim());
        setDone({ kind: 'starter', channel: ch, qm: r.data });
        onCreated?.(ch);
      }
    } catch (e) {
      const p = problemsOf(e);
      setProblems(p.length ? p : [{ field: '_', message: errorText(e) }]);
    } finally {
      setSaving(false);
    }
  }

  const title = done ? (done.kind === 'starter' ? 'Quick message saved' : 'Template created') : `Use “${item.name}”`;
  const status = done && done.kind !== 'starter' ? String(done.kind === 'whatsapp' ? done.result.status : done.template.status).toUpperCase() : '';
  const st = STATUS_TEXT[status] || STATUS_TEXT.PENDING;
  const approved = status === 'APPROVED';

  const footer = done ? (
    <>
      {done.kind === 'whatsapp' && (
        <>
          <button type="button" className="k-btn ghost" onClick={() => { onClose(); onViewTemplates('whatsapp'); }} data-testid="tlb-view-templates">View in templates</button>
          <button type="button" className="k-btn" disabled={!approved} title={approved ? undefined : 'Campaigns can only use approved templates.'} onClick={() => { onClose(); onStartWhatsAppCampaign(done.result.name); }} data-testid="tlb-start-campaign">
            <span className="material-icons">campaign</span> Start a campaign
          </button>
        </>
      )}
      {done.kind === 'messenger' && (
        <>
          <button type="button" className="k-btn ghost" onClick={() => { onClose(); onViewTemplates('messenger'); }} data-testid="tlb-view-templates">View in templates</button>
          <button type="button" className="k-btn" disabled={!approved} title={approved ? undefined : 'Campaigns can only use approved templates.'} onClick={() => { onClose(); onStartMetaCampaign('messenger', { utilityTemplateId: done.template._id }); }} data-testid="tlb-start-campaign">
            <span className="material-icons">campaign</span> Start a Messenger campaign
          </button>
        </>
      )}
      {done.kind === 'starter' && (
        <>
          <button type="button" className="k-btn ghost" onClick={() => { onClose(); notify('success', 'Saved to your quick messages', `Open a ${CHANNEL_LABEL[done.channel]} chat and use the Quick messages button to send “${done.qm.name}”.`); }} data-testid="tlb-later">Send in a chat later</button>
          <button type="button" className="k-btn ghost" onClick={() => setEditing(done.qm)} data-testid="tlb-edit"><span className="material-icons">edit</span> Edit</button>
          <button type="button" className="k-btn" onClick={() => { onClose(); onStartMetaCampaign(done.channel, { quickMessageId: done.qm._id }); }} data-testid="tlb-start-campaign">
            <span className="material-icons">campaign</span> Use in campaign
          </button>
        </>
      )}
    </>
  ) : (
    <>
      {problems.length > 0 && <span className="mm-foot-note err" data-testid="tlb-use-error">{problems[0].message}</span>}
      <button type="button" className="k-btn ghost" onClick={onClose}>Cancel</button>
      {!blocked && (
        <button type="button" className="k-btn" onClick={submit} disabled={saving} data-testid="tlb-use-submit">
          {saving ? 'Saving…' : item.source === 'starter' ? 'Save as quick message' : 'Create template'}
        </button>
      )}
    </>
  );

  return (
    <>
      <Modal title={title} onClose={onClose} wide testid="tlb-use-dialog" footer={footer}>
        {done ? (
          <div className="tlb-done" data-testid="tlb-use-done">
            {done.kind === 'starter' ? (
              <>
                <p className="tlb-done-line"><span className="tl-status green" data-testid="tlb-use-status">Saved</span> “{done.qm.name}” is now one of your {CHANNEL_LABEL[done.channel]} quick messages.</p>
                <p className="k-hint">Quick messages can be sent within 24 hours of the customer’s last message: from a chat, or as a campaign to everyone inside that window.</p>
              </>
            ) : (
              <>
                <p className="tlb-done-line">
                  <span className={`tl-status ${st.tone}`} data-testid="tlb-use-status">{st.label}</span>
                  “{done.kind === 'whatsapp' ? done.result.name : done.template.name}” {done.kind === 'whatsapp' ? 'is in your WhatsApp templates.' : 'is on your Facebook Page.'}
                </p>
                <p className="k-hint">{st.text}</p>
              </>
            )}
          </div>
        ) : (
          <div className="mm-editor tlb-use">
            <div className="mm-editor-form">
              {item.source === 'starter' ? (
                <p className="mm-notice" data-testid="tlb-use-starter-note">
                  <span className="material-icons">info</span>
                  <span>
                    A CRM starter, not a Meta template: it is saved as one of your {CHANNEL_LABEL[item.channel as MetaChannel]} quick messages,
                    which you can edit. No approval is needed; quick messages go out within 24 hours of the customer’s last message.
                  </span>
                </p>
              ) : (
                <p className="mm-notice">
                  <span className="material-icons">verified</span>
                  <span>
                    From Meta’s {item.channel === 'whatsapp' ? 'WhatsApp' : 'Messenger'} template library: the wording is fixed and already
                    categorised as {(CATEGORY_LABEL[item.category] || item.category).toLowerCase()}. Add your own link or phone number for its buttons.
                  </span>
                </p>
              )}
              {blocked ? (
                <div className="mm-connect" data-testid="tlb-use-connect">
                  <img src={ICON[item.channel]} alt="" />
                  <div>
                    <strong>{item.channel === 'whatsapp' ? 'Connect WhatsApp to use the library' : 'Connect Messenger to use the library'}</strong>
                    <p>
                      {item.channel === 'whatsapp'
                        ? waMode === 'sandbox'
                          ? 'You’re on the shared test number, so you can browse the library but not create templates. Connect your own WhatsApp number first.'
                          : 'Templates are created in your own WhatsApp Business Account. Connect it on Channel Status first.'
                        : 'Utility templates live on your Facebook Page. Connect it on Channel Status first.'}
                    </p>
                  </div>
                  {onNavigate && (
                    <button type="button" className="k-btn" onClick={() => { onClose(); onNavigate(`channel-status:${item.channel}`); }}>
                      Connect {NAME[item.channel]}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="k-field">
                    <label className="k-label" htmlFor="tlb-use-name">{item.source === 'starter' ? 'Quick message name' : 'Template name'}</label>
                    <input
                      id="tlb-use-name"
                      className="k-input"
                      value={name}
                      maxLength={item.source === 'starter' ? 80 : 512}
                      onChange={(e) => setName(item.source === 'starter' ? e.target.value : e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                      data-testid="tlb-use-name"
                    />
                    {err('name') && <p className="err mm-err">{err('name')}</p>}
                  </div>
                  {libButtons.map((b, i) => {
                    const t = String(b.type).toUpperCase();
                    if (t !== 'URL' && t !== 'PHONE_NUMBER') return null;
                    const isUrl = t === 'URL';
                    const v = inputs[i] || {};
                    const set = (patch: Partial<typeof v>) => {
                      setInputs(inputs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                      setProblems((p) => p.filter((x) => !x.field.startsWith(`buttonInputs.${i}.`)));
                    };
                    return (
                      <div className="k-field" key={i}>
                        <label className="k-label" htmlFor={`tlb-use-input-${i}`}>{isUrl ? `Your link for “${b.text}”` : `Your phone number for “${b.text}”`}</label>
                        <input
                          id={`tlb-use-input-${i}`}
                          className="k-input"
                          value={(isUrl ? v.url : v.phone) || ''}
                          placeholder={isUrl ? 'https://yourshop.example/orders' : '+919876543210'}
                          onChange={(e) => set(isUrl ? { url: e.target.value } : { phone: e.target.value })}
                          data-testid={`tlb-use-input-${i}`}
                        />
                        {isUrl && item.channel === 'whatsapp' && <p className="k-hint">End it with {'{{1}}'} to add a different ending (like an order number) on each send.</p>}
                        {err(`buttonInputs.${i}.${isUrl ? 'url' : 'phone'}`) && <p className="err mm-err">{err(`buttonInputs.${i}.${isUrl ? 'url' : 'phone'}`)}</p>}
                        {isUrl && /\{\{\s*1\s*\}\}$/.test(v.url || '') && (
                          <>
                            <input className="k-input tlb-suffix" value={v.urlSuffixExample || ''} placeholder="A full sample link, e.g. https://yourshop.example/orders/1042" onChange={(e) => set({ urlSuffixExample: e.target.value })} data-testid={`tlb-use-suffix-${i}`} aria-label="Sample link" />
                            {err(`buttonInputs.${i}.urlSuffixExample`) && <p className="err mm-err">{err(`buttonInputs.${i}.urlSuffixExample`)}</p>}
                          </>
                        )}
                      </div>
                    );
                  })}
                  {isAuth && (
                    <>
                      <label className="mc-confirm" data-testid="tlb-use-sec">
                        <input type="checkbox" checked={security} onChange={(e) => setSecurity(e.target.checked)} />
                        <span>Add “For your security, do not share this code.”</span>
                      </label>
                      <div className="k-field">
                        <label className="k-label" htmlFor="tlb-use-exp">Code expires after (minutes, 1–90; empty for none)</label>
                        <input id="tlb-use-exp" className="k-input" inputMode="numeric" value={expiry} onChange={(e) => setExpiry(e.target.value.replace(/\D/g, '').slice(0, 2))} data-testid="tlb-use-exp" style={{ maxWidth: 140 }} />
                        {err('bodyInputs.codeExpirationMinutes') && <p className="err mm-err">{err('bodyInputs.codeExpirationMinutes')}</p>}
                      </div>
                    </>
                  )}
                  {item.msg && <VariablesEditor count={paramCount(item.msg.body)} variables={variables} onChange={setVariables} examples={item.msg.bodyParams} />}
                </>
              )}
            </div>
            <div className="mm-editor-preview">
              <span className="k-label">Preview</span>
              {item.starter ? (
                <QuickMessagePreview qm={item.starter} channel={item.channel as MetaChannel} />
              ) : (
                <Bubble item={item} time={clock()} />
              )}
              {item.wa && item.wa.bodyParams.length > 0 && (
                <p className="k-hint">Sample values: {item.wa.bodyParams.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')}</p>
              )}
            </div>
          </div>
        )}
      </Modal>
      {editing && done?.kind === 'starter' && (
        <QuickMessageEditor
          api={api}
          initial={editing}
          defaultChannel={done.channel}
          onClose={() => setEditing(null)}
          onSaved={(q) => { setEditing(null); setDone({ ...done, qm: q }); notify('success', 'Quick message saved', `“${q.name}” was updated.`); }}
        />
      )}
    </>
  );
}

// ================================================================= gallery ==

type LoadState = 'idle' | 'loading' | 'ready' | 'error' | 'not_connected';
interface ChannelLoad {
  state: LoadState;
  key: string;
  items: Item[];
  error?: string;
  mode?: string;
  canUse?: boolean;
  reconnect?: boolean;
}
const idle: ChannelLoad = { state: 'idle', key: '', items: [] };

function FacetGroup({ title, facets, selected, onToggle, testPrefix }: {
  title: string; facets: { value: string; label: string; count: number }[]; selected: Set<string>; onToggle: (v: string) => void; testPrefix: string;
}) {
  if (!facets.length) return null;
  return (
    <fieldset className="tlb-facet">
      <legend>{title}</legend>
      {facets.map((f) => (
        <label key={f.value} className="tlb-check" data-testid={`${testPrefix}-${f.value}`}>
          <input type="checkbox" checked={selected.has(f.value)} onChange={() => onToggle(f.value)} />
          <span>{f.label}</span>
          <span className="tlb-count">{f.count}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function TemplateLibrary({
  api, onNavigate, onStartWhatsAppCampaign, onStartMetaCampaign, onViewTemplates, onCreated, initialChannel = 'all', onEditWhatsApp,
}: Props) {
  // "Use template" opens the channel's own create form, filled in from the card.
  const [utilSeed, setUtilSeed] = useState<Partial<UtilityTemplateInput> | null>(null);
  const [quickSeed, setQuickSeed] = useState<{ channel: MetaChannel; qm: QuickMessageInput } | null>(null);
  const shownChannel = (c: GalleryChannel): GalleryChannel => (c === 'all' || CHANNELS.includes(c) ? c : 'all');
  const [channel, setChannel] = useState<GalleryChannel>(() => shownChannel(initialChannel));
  const [qInput, setQInput] = useState('');
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('en_US');
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [industries, setIndustries] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [wa, setWa] = useState<ChannelLoad>(idle);
  const [msgLib, setMsgLib] = useState<ChannelLoad>(idle);
  const [starters, setStarters] = useState<QuickStarter[] | null>(null);
  const [startersError, setStartersError] = useState('');
  const [conns, setConns] = useState<Record<MetaChannel, MetaChannelConnection | null> | null>(null);
  const [visible, setVisible] = useState<Set<CampaignChannel>>(new Set());
  const [using, setUsing] = useState<Item | null>(null);
  const time = useMemo(clock, []);
  const seq = useRef({ wa: 0, msg: 0 });

  useEffect(() => { setChannel(shownChannel(initialChannel)); }, [initialChannel]); // eslint-disable-line react-hooks/exhaustive-deps
  // Search as you type, a moment after the last key.
  useEffect(() => {
    const t = setTimeout(() => setQuery(qInput.trim()), 400);
    return () => clearTimeout(t);
  }, [qInput]);
  useEffect(() => { setLimit(PAGE); }, [channel, query, language, cats, topics, industries]);

  // Which channels to load: the chosen one, or (All) each section once it scrolls into view.
  const wanted = useMemo(() => new Set<CampaignChannel>(channel === 'all' ? [...visible] : [channel]), [channel, visible]);
  const sectionEls = useRef(new Map<CampaignChannel, HTMLElement>());
  const sectionRef = useCallback((el: HTMLElement | null) => {
    if (el) sectionEls.current.set(el.dataset.channel as CampaignChannel, el);
  }, []);
  useEffect(() => {
    if (channel !== 'all') return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(new Set(CHANNELS));
      return undefined;
    }
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.channel as CampaignChannel);
      if (seen.length) setVisible((v) => (seen.every((c) => v.has(c)) ? v : new Set([...v, ...seen])));
    }, { rootMargin: '200px' });
    sectionEls.current.forEach((el) => { if (el.isConnected) io.observe(el); });
    return () => io.disconnect();
  }, [channel]);

  // The Meta connections and the starters are read once, when Messenger or Instagram is first shown.
  const metaRequested = useRef(false);
  useEffect(() => {
    if ((!wanted.has('messenger') && !wanted.has('instagram')) || metaRequested.current) return;
    metaRequested.current = true;
    api.getMetaChannels().then((r) => setConns(r.connections)).catch(() => setConns({ messenger: null, instagram: null }));
    api.getQuickStarters().then((r) => setStarters(r.data || [])).catch((e) => setStartersError(errorText(e)));
  }, [wanted, api]);

  const loadWa = useCallback(() => {
    const key = `${query}|${language}`;
    const n = ++seq.current.wa;
    setWa((w) => ({ ...w, state: 'loading', key }));
    api.getWhatsAppLibrary({ q: query, language }).then((r) => {
      if (n !== seq.current.wa) return;
      setWa({ state: 'ready', key, items: (r.data || []).map(waItem), mode: r.mode, canUse: r.canUse });
    }).catch((e) => {
      if (n !== seq.current.wa) return;
      const code = errorCode(e);
      if (code === 'WA_NOT_CONNECTED' || code === 'WA_TOKEN_INVALID') setWa({ state: 'not_connected', key, items: [], reconnect: code === 'WA_TOKEN_INVALID' });
      else setWa({ state: 'error', key, items: [], error: errorText(e) });
    });
  }, [api, query, language]);
  const messengerConnected = conns?.messenger?.status === 'connected';
  const loadMsg = useCallback(() => {
    const key = `${query}|${language}`;
    if (!messengerConnected) { setMsgLib({ state: 'not_connected', key, items: [] }); return; }
    const n = ++seq.current.msg;
    setMsgLib((m) => ({ ...m, state: 'loading', key }));
    api.searchTemplateLibrary(query, language).then((r) => {
      if (n !== seq.current.msg) return;
      setMsgLib({ state: 'ready', key, items: (r.data || []).map(msgItem) });
    }).catch((e) => {
      if (n !== seq.current.msg) return;
      const code = errorCode(e);
      if (code === 'CHANNEL_NOT_CONNECTED' || code === 'CHANNEL_DISCONNECTED') setMsgLib({ state: 'not_connected', key, items: [] });
      else setMsgLib({ state: 'error', key, items: [], error: errorText(e) });
    });
  }, [api, query, language, messengerConnected]);

  const loadKey = `${query}|${language}`;
  useEffect(() => {
    if (wanted.has('whatsapp') && wa.key !== loadKey) loadWa();
  }, [wanted, loadKey, wa.key, loadWa]);
  useEffect(() => {
    if (wanted.has('messenger') && conns && msgLib.key !== loadKey) loadMsg();
  }, [wanted, loadKey, msgLib.key, conns, loadMsg]);

  // ---- items per channel (search already applied by Meta for its libraries)
  const english = isEnglish(language);
  const starterItems = useCallback((ch: MetaChannel) => {
    if (!starters || !english) return [];
    const q = query.toLowerCase();
    return starters
      .filter((s) => s.channels.includes(ch))
      .filter((s) => !q || [s.name, s.text, s.categoryLabel, ...s.cards.map((c) => `${c.title} ${c.subtitle}`), ...s.quickReplies.map((r) => r.title)].join(' ').toLowerCase().includes(q))
      .map((s) => starterItem(s, ch));
  }, [starters, english, query]);
  const itemsOf = useCallback((ch: CampaignChannel): Item[] => {
    if (ch === 'whatsapp') return wa.items;
    if (ch === 'messenger') return [...msgLib.items, ...starterItems('messenger')];
    return starterItems('instagram');
  }, [wa.items, msgLib.items, starterItems]);

  const scope: CampaignChannel[] = channel === 'all' ? CHANNELS : [channel];
  const scoped = useMemo(() => scope.flatMap((ch) => itemsOf(ch)), [scope.join(), itemsOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const facetList = useCallback((values: string[], label: (v: string) => string) => {
    const m = new Map<string, number>();
    for (const v of values) if (v) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count, label: label(value) }));
  }, []);
  const topicLabels = useMemo(() => Object.fromEntries(scoped.map((i) => [i.topic, i.topicLabel])), [scoped]);
  const catFacets = facetList(scoped.map((i) => i.category), (v) => CATEGORY_LABEL[v] || titleCase(v));
  const topicFacets = facetList(scoped.map((i) => i.topic), (v) => topicLabels[v] || titleCase(v));
  const industryFacets = facetList(scoped.flatMap((i) => i.industry), titleCase);

  const passes = useCallback((i: Item) => (!cats.size || cats.has(i.category))
    && (!topics.size || topics.has(i.topic))
    && (!industries.size || i.industry.some((x) => industries.has(x))), [cats, topics, industries]);
  const filteredOf = useCallback((ch: CampaignChannel) => itemsOf(ch).filter(passes), [itemsOf, passes]);
  const filtered = useMemo(() => scope.flatMap((ch) => filteredOf(ch)), [scope.join(), filteredOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void) => (v: string) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v); else n.add(v);
    setter(n);
  };
  const anyFilter = cats.size + topics.size + industries.size > 0;
  const clearFilters = () => { setCats(new Set()); setTopics(new Set()); setIndustries(new Set()); };

  const actionLabel = (i: Item) => (i.channel === 'whatsapp' && !wa.canUse ? 'Preview' : 'Use template');

  // ---- per-channel states (loading / not connected / error / notes)
  function channelNotes(ch: CampaignChannel) {
    if (ch === 'whatsapp') {
      if (wa.state === 'not_connected') {
        return (
          <div className="mm-connect" data-testid="tlb-wa-connect">
            <img src={ICON.whatsapp} alt="" />
            <div>
              <strong>{wa.reconnect ? 'Reconnect WhatsApp to use the library' : 'Connect WhatsApp to use the library'}</strong>
              <p>Meta’s template library is read with your WhatsApp Business Account. Connect your WhatsApp number on Channel Status to browse it and create templates from it.</p>
            </div>
            {onNavigate && <button type="button" className="k-btn" onClick={() => onNavigate('channel-status:whatsapp')} data-testid="tlb-wa-connect-btn">Connect WhatsApp</button>}
          </div>
        );
      }
      if (wa.state === 'error') {
        return <p className="mm-notice warn" data-testid="tlb-error-whatsapp"><span className="material-icons">error_outline</span><span>{wa.error}</span><button type="button" className="k-btn ghost sm" onClick={loadWa}>Retry</button></p>;
      }
      if (wa.state === 'ready' && !wa.canUse) {
        return (
          <p className="mm-notice" data-testid="tlb-wa-readonly">
            <span className="material-icons">visibility</span>
            <span>{wa.mode === 'sandbox' ? 'You’re on the shared test number: you can browse Meta’s library, but creating templates needs your own WhatsApp number.' : 'Browse only: your WhatsApp Business Account isn’t fully connected.'}</span>
            {onNavigate && <button type="button" className="k-btn ghost sm" onClick={() => onNavigate('channel-status:whatsapp')}>Connect WhatsApp</button>}
          </p>
        );
      }
      return null;
    }
    const notes: ReactNode[] = [];
    if (ch === 'messenger' && msgLib.state === 'not_connected') {
      notes.push(
        <div className="mm-connect" data-testid="tlb-msg-connect" key="c">
          <img src={ICON.messenger} alt="" />
          <div>
            <strong>{conns?.messenger ? 'Reconnect Messenger to use Meta’s library' : 'Connect Messenger to use Meta’s library'}</strong>
            <p>Meta’s Messenger utility templates are copied to your Facebook Page. The CRM starters below work without it.</p>
          </div>
          {onNavigate && <button type="button" className="k-btn" onClick={() => onNavigate('channel-status:messenger')} data-testid="tlb-msg-connect-btn">Connect Messenger</button>}
        </div>,
      );
    }
    if (ch === 'messenger' && msgLib.state === 'error') {
      notes.push(<p className="mm-notice warn" data-testid="tlb-error-messenger" key="e"><span className="material-icons">error_outline</span><span>{msgLib.error}</span><button type="button" className="k-btn ghost sm" onClick={loadMsg}>Retry</button></p>);
    }
    if (ch === 'instagram') {
      notes.push(
        <p className="mm-notice" key="ig" data-testid="tlb-ig-note">
          <span className="material-icons">info</span>
          <span>Instagram has no Meta template library. These are CRM starters: ready-made quick messages you save, edit and send within 24 hours of the customer’s last message.</span>
        </p>,
      );
      if (conns && conns.instagram?.status !== 'connected') {
        notes.push(<p className="k-hint" key="igc" data-testid="tlb-ig-not-connected">Instagram isn’t connected yet: you can save starters now and send them once it is.</p>);
      }
    }
    if (!english) notes.push(<p className="k-hint" key="en" data-testid={`tlb-starters-english-${ch}`}>CRM starters are in English only. Choose English to see them.</p>);
    if (startersError) notes.push(<p className="mm-notice warn" key="se"><span className="material-icons">error_outline</span><span>{startersError}</span></p>);
    return notes.length ? <>{notes}</> : null;
  }
  const isLoading = (ch: CampaignChannel) => (ch === 'whatsapp' ? wa.state === 'loading' || wa.state === 'idle'
    : ch === 'messenger' ? (msgLib.state === 'loading' || msgLib.state === 'idle' || (english && !starters && !startersError))
      : english && !starters && !startersError);

  /** Open the create form for this card (or the connect / preview dialog when it can't be used yet). */
  function openUse(i: Item) {
    if (i.channel === 'whatsapp' && i.wa && onEditWhatsApp && wa.canUse) {
      onEditWhatsApp(waToTemplateItem(i.wa));
      return;
    }
    if (i.channel === 'messenger' && i.msg && messengerConnected) {
      setUtilSeed(msgToUtilitySeed(i.msg));
      return;
    }
    if (i.starter) {
      setQuickSeed({ channel: i.channel as MetaChannel, qm: starterToQuick(i.starter, i.channel as MetaChannel) });
      return;
    }
    setUsing(i);
  }

  const grid = (list: Item[]) => (
    <div className="tlb-grid">
      {list.map((i) => <LibraryCard key={i.key} item={i} time={time} actionLabel={actionLabel(i)} onUse={() => openUse(i)} />)}
    </div>
  );
  const empty = (ch: CampaignChannel) => <p className="mm-empty" data-testid={`tlb-empty-${ch}`}>{anyFilter || query ? 'No templates match. Try another word or clear the filters.' : 'Nothing here yet.'}</p>;

  const shown = channel === 'all'
    ? CHANNELS.reduce((n, ch) => n + Math.min(SECTION_PREVIEW, filteredOf(ch).length), 0)
    : Math.min(limit, filtered.length);

  return (
    <div className="tlb" data-testid="template-library">
      <div className="tlb-top">
        <div className="tl-search tlb-search">
          <input
            className="k-input"
            type="search"
            placeholder="Search templates, e.g. order, payment, appointment"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            aria-label="Search the template library"
            data-testid="tlb-search"
          />
          <span className="tl-search-icon material-icons" aria-hidden="true">search</span>
        </div>
        <div className="tlb-lang" data-testid="tlb-lang">
          <span className="material-icons" aria-hidden="true">translate</span>
          <Dropdown size="sm" options={LIBRARY_LANGUAGE_OPTIONS} value={language} onChange={setLanguage} className="tlb-lang-dd" />
        </div>
        <button type="button" className={`k-btn ghost sm tlb-filters-toggle${filtersOpen ? ' on' : ''}`} onClick={() => setFiltersOpen((v) => !v)} data-testid="tlb-filters-toggle" aria-expanded={filtersOpen}>
          <span className="material-icons">filter_list</span> Filters{anyFilter ? ` (${cats.size + topics.size + industries.size})` : ''}
        </button>
      </div>

      <div className="tlb-layout">
        <aside className={`tlb-filters${filtersOpen ? ' open' : ''}`} aria-label="Filters" data-testid="tlb-filters">
          {CHANNELS.length > 1 && (
          <fieldset className="tlb-facet">
            <legend>Channel</legend>
            {(['all', ...CHANNELS] as GalleryChannel[]).map((c) => (
              <button key={c} type="button" className={`tlb-ch${channel === c ? ' active' : ''}`} onClick={() => setChannel(c)} data-testid={`tlb-ch-${c}`} aria-pressed={channel === c}>
                {c === 'all' ? <span className="material-icons" aria-hidden="true">apps</span> : <img src={ICON[c]} alt="" />}
                <span>{c === 'all' ? 'All' : NAME[c]}</span>
              </button>
            ))}
          </fieldset>
          )}
          <FacetGroup title="Category" facets={catFacets} selected={cats} onToggle={toggle(cats, setCats)} testPrefix="tlb-cat" />
          <FacetGroup title="Topic" facets={topicFacets} selected={topics} onToggle={toggle(topics, setTopics)} testPrefix="tlb-topic" />
          <FacetGroup title="Industry" facets={industryFacets} selected={industries} onToggle={toggle(industries, setIndustries)} testPrefix="tlb-ind" />
          {anyFilter && <button type="button" className="tlb-clear" onClick={clearFilters} data-testid="tlb-clear">Clear filters</button>}
        </aside>

        <div className="tlb-main">
          <div className="tlb-count" data-testid="tlb-count">Showing {shown} of {filtered.length} result{filtered.length === 1 ? '' : 's'}</div>
          {channel === 'all' ? (
            CHANNELS.map((ch) => {
              const list = filteredOf(ch);
              return (
                <section key={ch} className="tlb-section" data-channel={ch} ref={sectionRef} data-testid={`tlb-section-${ch}`}>
                  <header className="tlb-section-head">
                    <h3><img src={ICON[ch]} alt="" /> {NAME[ch]}</h3>
                    <span className="tlb-section-sub">{ch === 'whatsapp' ? 'Meta’s template library' : ch === 'messenger' ? 'Meta’s utility library · CRM starters' : 'CRM starters'}</span>
                    {list.length > SECTION_PREVIEW && (
                      <button type="button" className="k-btn ghost sm" onClick={() => setChannel(ch)} data-testid={`tlb-see-all-${ch}`}>See all {list.length}</button>
                    )}
                  </header>
                  {channelNotes(ch)}
                  {list.length > 0 ? grid(list.slice(0, SECTION_PREVIEW)) : isLoading(ch) ? <BladeSpinner center={true} containerHeight={90} /> : empty(ch)}
                </section>
              );
            })
          ) : (
            <section className="tlb-section single" data-channel={channel} data-testid={`tlb-section-${channel}`}>
              {channelNotes(channel)}
              {filtered.length > 0 ? (
                <>
                  {grid(filtered.slice(0, limit))}
                  {filtered.length > limit && (
                    <div className="tlb-more">
                      <button type="button" className="k-btn ghost" onClick={() => setLimit((n) => n + PAGE)} data-testid="tlb-more">Load more</button>
                    </div>
                  )}
                </>
              ) : isLoading(channel) ? <BladeSpinner center={true} containerHeight={120} /> : empty(channel)}
            </section>
          )}
        </div>
      </div>

      {using && (
        <UseDialog
          api={api}
          item={using}
          waCanUse={!!wa.canUse}
          waMode={wa.mode || ''}
          messengerConnected={messengerConnected}
          onClose={() => setUsing(null)}
          onNavigate={onNavigate}
          onStartWhatsAppCampaign={onStartWhatsAppCampaign}
          onStartMetaCampaign={onStartMetaCampaign}
          onViewTemplates={onViewTemplates}
          onCreated={onCreated}
        />
      )}

      {utilSeed && (
        <UtilityCreateModal
          api={api}
          seed={utilSeed}
          onClose={() => setUtilSeed(null)}
          onCreated={(t) => {
            setUtilSeed(null);
            onCreated?.('messenger');
            onViewTemplates('messenger');
            void t; // the form already said whether Meta approved it
          }}
        />
      )}

      {quickSeed && (
        <QuickMessageEditor
          api={api}
          initial={null}
          seed={quickSeed.qm}
          defaultChannel={quickSeed.channel}
          onClose={() => setQuickSeed(null)}
          onSaved={(q) => {
            const ch = quickSeed.channel;
            setQuickSeed(null);
            onCreated?.(ch);
            onViewTemplates(ch);
            void q; // the editor already confirmed the save
          }}
        />
      )}
    </div>
  );
}
