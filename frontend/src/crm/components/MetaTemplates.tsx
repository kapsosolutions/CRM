// Templates → Messenger and Templates → Instagram.
//
// Messenger: utility templates (approved by Meta, the only messages allowed
// outside the 24-hour window, for order / account / appointment / event
// updates) and quick messages. Instagram: quick messages only (Instagram has
// no approved templates; nothing can be sent outside the window).
//
// Quick messages are rich messages saved in the CRM (text with buttons,
// image, cards / carousel, quick-reply chips): no Meta approval, sent only
// inside the 24-hour window. The builder checks each channel's limits live
// (../metaMessaging.ts); the server checks them again.
import { CopyIcon } from './AppIcons';
import { useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type {
  FieldProblem, LibraryTemplate, MetaChannel, MetaChannelConnection, QuickButton, QuickMessage, QuickMessageInput,
  QuickMessageKind, UtilityButton, UtilityTemplate, UtilityTemplateInput, UtilityVariable,
} from '../types';
import {
  CHANNEL_LABEL, KIND_LABEL, LIMITS, UTILITY_LANGUAGES, UTILITY_LIMITS, allQuickProblems, bytes, emptyButton, emptyCard,
  emptyQuickMessage, emptyUtilityButton, errorText, fieldError, languageLabel, paramCount, problemsOf,
  quickProblems, renderParams, utilityProblems, utilityReason,
} from '../metaMessaging';
import { useConfirm, useNotify } from './Dialogs';
import { Dropdown } from './Dropdown';
import { BladeSpinner } from './BladeSpinner';
import { Pager, usePaged } from './Pager';
import './MetaMessaging.css';

const CHANNEL_ICON: Record<MetaChannel, string> = { messenger: '/channel-messenger.svg', instagram: '/channel-instagram.svg' };
const STATUS_TONE: Record<string, string> = { APPROVED: 'green', REJECTED: 'red', PAUSED: 'grey', DISABLED: 'grey', DELETED: 'grey' };
const titleCase = (s: string) => {
  const v = String(s || '').replace(/_/g, ' ').toLowerCase();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : '—';
};
const dateLabel = (iso?: string | null) => {
  const ms = iso ? new Date(iso).getTime() : 0;
  return ms ? new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
};

// ================================================================ previews ==

/** How a quick message looks in the channel's app (Messenger blue / Instagram). */
export function QuickMessagePreview({ qm, channel, compact = false }: { qm: QuickMessageInput; channel: MetaChannel; compact?: boolean }) {
  const btn = (b: QuickButton, i: number) => (
    <span className="mm-pv-btn" key={i}>
      {b.type === 'url' && <span className="material-icons" aria-hidden="true">open_in_new</span>}
      {b.title || 'Button'}
    </span>
  );
  return (
    <div className={`mm-pv mm-pv-${channel}${compact ? ' compact' : ''}`} data-testid="qm-preview" data-channel={channel}>
      {!compact && (
        <div className="mm-pv-head">
          <img src={CHANNEL_ICON[channel]} alt="" />
          <span>{CHANNEL_LABEL[channel]}</span>
        </div>
      )}
      <div className="mm-pv-thread">
        {qm.kind === 'text' && (
          qm.buttons.length ? (
            <div className="mm-pv-card mm-pv-buttontpl">
              <div className="mm-pv-card-text">{qm.text || 'Your message'}</div>
              <div className="mm-pv-btns">{qm.buttons.map(btn)}</div>
            </div>
          ) : (
            <div className="mm-pv-bubble">{qm.text || 'Your message'}</div>
          )
        )}
        {qm.kind === 'image' && (
          <>
            {qm.imageUrl ? <img className="mm-pv-image" src={qm.imageUrl} alt="" /> : <div className="mm-pv-image ph"><span className="material-icons">image</span></div>}
            {qm.text.trim() && <div className="mm-pv-bubble">{qm.text}</div>}
          </>
        )}
        {qm.kind === 'cards' && (
          <div className="mm-pv-carousel" data-testid="qm-preview-cards">
            {qm.cards.map((c, i) => (
              <div className="mm-pv-card mm-pv-gcard" key={i}>
                {c.imageUrl ? <img className="mm-pv-gimg" src={c.imageUrl} alt="" /> : <div className="mm-pv-gimg ph"><span className="material-icons">image</span></div>}
                <div className="mm-pv-gtext">
                  <div className="mm-pv-gtitle">{c.title || `Card ${i + 1}`}</div>
                  {c.subtitle && <div className="mm-pv-gsub">{c.subtitle}</div>}
                </div>
                {c.buttons.length > 0 && <div className="mm-pv-btns">{c.buttons.map(btn)}</div>}
              </div>
            ))}
          </div>
        )}
        {qm.kind === 'quick_replies' && (
          <>
            <div className="mm-pv-bubble">{qm.text || 'Your question'}</div>
            <div className="mm-pv-chips">
              {qm.quickReplies.map((q, i) => <span className="mm-pv-chip" key={i}>{q.title || `Reply ${i + 1}`}</span>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A Messenger utility message as the customer sees it. */
export function UtilityPreview({ bodyText, values, buttons }: { bodyText: string; values: string[]; buttons: UtilityButton[] }) {
  return (
    <div className="mm-pv mm-pv-messenger" data-testid="utility-preview">
      <div className="mm-pv-head">
        <img src={CHANNEL_ICON.messenger} alt="" />
        <span>Messenger</span>
      </div>
      <div className="mm-pv-thread">
        <div className="mm-pv-card">
          <div className="mm-pv-card-text">{renderParams(bodyText, values) || 'Your update'}</div>
          {buttons.length > 0 && (
            <div className="mm-pv-btns">
              {buttons.map((b, i) => (
                <span className="mm-pv-btn" key={i}>
                  <span className="material-icons" aria-hidden="true">{b.type === 'URL' ? 'open_in_new' : 'call'}</span>
                  {b.text || 'Button'}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="mm-pv-meta">Utility message</div>
      </div>
    </div>
  );
}

// ============================================================ modal shell ==

export function Modal({ title, onClose, children, footer, wide = false, testid }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; testid?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="mm-backdrop" onClick={onClose}>
      <div className={`mm-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} data-testid={testid} onClick={(e) => e.stopPropagation()}>
        <header className="mm-modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </header>
        <div className="mm-modal-body">{children}</div>
        {footer && <footer className="mm-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

const FieldErr = ({ problems, field }: { problems: FieldProblem[]; field: string }) => {
  const m = fieldError(problems, field);
  return m ? <p className="err mm-err">{m}</p> : null;
};

function Counter({ value, max, unit = 'characters' }: { value: string; max: number; unit?: 'characters' | 'bytes' }) {
  const n = unit === 'bytes' ? bytes(value) : value.length;
  return <span className={`mm-count${n > max ? ' over' : ''}`}>{n.toLocaleString('en-US')}/{max.toLocaleString('en-US')}{unit === 'bytes' ? ' bytes' : ''}</span>;
}

// ===================================================== quick message editor ==

function ButtonsEditor({ list, onChange, max, titleMax, prefix, problems }: {
  list: QuickButton[]; onChange: (l: QuickButton[]) => void; max: number; titleMax: number; prefix: string; problems: FieldProblem[];
}) {
  const set = (i: number, patch: Partial<QuickButton>) => onChange(list.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="mm-buttons">
      {list.map((b, i) => (
        <div className="mm-button-row" key={i}>
          <Dropdown
            size="sm"
            options={[{ value: 'url', label: 'Opens a link' }, { value: 'postback', label: 'Sends a reply' }]}
            value={b.type}
            onChange={(v) => set(i, { type: v as QuickButton['type'] })}
            className="mm-btn-type"
          />
          <input className="k-input" placeholder="Label" value={b.title} maxLength={60} onChange={(e) => set(i, { title: e.target.value })} aria-label={`Button ${i + 1} label`} />
          {b.type === 'url' ? (
            <input className="k-input" placeholder="https://…" value={b.url} onChange={(e) => set(i, { url: e.target.value })} aria-label={`Button ${i + 1} link`} />
          ) : (
            <input className="k-input" placeholder="Reply value (optional)" value={b.payload} maxLength={1000} onChange={(e) => set(i, { payload: e.target.value })} aria-label={`Button ${i + 1} reply value`} />
          )}
          <button type="button" className="icon-btn" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={`Remove button ${i + 1}`}>
            <span className="material-icons">delete_outline</span>
          </button>
          <span className={`mm-count${b.title.length > titleMax ? ' over' : ''}`}>{b.title.length}/{titleMax}</span>
          <FieldErr problems={problems} field={`${prefix}.${i}.title`} />
          <FieldErr problems={problems} field={`${prefix}.${i}.url`} />
        </div>
      ))}
      {list.length < max && (
        <button type="button" className="k-btn ghost sm" onClick={() => onChange([...list, emptyButton()])}>
          <span className="material-icons">add</span> Add button
        </button>
      )}
    </div>
  );
}

function ImageField({ api, value, onChange, label = 'Image' }: { api: CrmApi; value: string; onChange: (v: string) => void; label?: string }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  async function pick(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) {
      notify('error', 'Not an image', 'Choose a PNG or JPEG image.');
      return;
    }
    setBusy(true);
    try {
      onChange(await api.uploadMedia(file, 'crm/quick-messages'));
    } catch (e) {
      notify('error', 'Upload failed', errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mm-image-field">
      <input className="k-input" placeholder="https://… or upload" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} address`} />
      <label className={`k-btn ghost sm mm-upload${busy ? ' busy' : ''}`}>
        <span className="material-icons">upload</span> {busy ? 'Uploading…' : 'Upload'}
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
    </div>
  );
}

export function QuickMessageEditor({ api, initial, seed, defaultChannel, onClose, onSaved }: {
  api: CrmApi; initial: QuickMessage | null; defaultChannel: MetaChannel; onClose: () => void; onSaved: (q: QuickMessage) => void;
  /** A new quick message that starts from this content (Template Library → Use template). */
  seed?: QuickMessageInput | null;
}) {
  const notify = useNotify();
  const copy = (q: QuickMessageInput): QuickMessageInput => ({
    name: q.name, channels: [...q.channels], kind: q.kind, text: q.text, imageUrl: q.imageUrl,
    buttons: q.buttons.map((b) => ({ ...b })), cards: q.cards.map((c) => ({ ...c, buttons: c.buttons.map((b) => ({ ...b })) })),
    quickReplies: q.quickReplies.map((x) => ({ ...x })),
  });
  const [qm, setQm] = useState<QuickMessageInput>(() => (initial ? copy(initial) : seed ? copy(seed) : emptyQuickMessage(defaultChannel)));
  const [previewCh, setPreviewCh] = useState<MetaChannel>(initial?.channels[0] || defaultChannel);
  const [serverProblems, setServerProblems] = useState<FieldProblem[]>([]);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const problems = useMemo(() => allQuickProblems(qm), [qm]);
  const shown = touched ? [...problems, ...serverProblems.filter((s) => !problems.some((p) => p.message === s.message))] : serverProblems;
  const set = (patch: Partial<QuickMessageInput>) => { setQm((q) => ({ ...q, ...patch })); setServerProblems([]); };
  const channelsFor = qm.channels.length ? qm.channels : [defaultChannel];
  const pvChannel = channelsFor.includes(previewCh) ? previewCh : channelsFor[0];
  // The strictest limits of the chosen channels (Instagram counts bytes).
  const textLimit = qm.channels.includes('instagram') ? LIMITS.instagram : LIMITS.messenger;

  function setKind(kind: QuickMessageKind) {
    setQm((q) => ({
      ...q,
      kind,
      cards: kind === 'cards' && !q.cards.length ? [emptyCard()] : q.cards,
      quickReplies: kind === 'quick_replies' && !q.quickReplies.length ? [{ title: '', payload: '' }] : q.quickReplies,
    }));
  }
  function toggleChannel(ch: MetaChannel) {
    set({ channels: qm.channels.includes(ch) ? qm.channels.filter((c) => c !== ch) : [...qm.channels, ch] });
  }
  const setCard = (i: number, patch: Partial<QuickMessageInput['cards'][number]>) => set({ cards: qm.cards.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  async function save() {
    setTouched(true);
    if (problems.length) return;
    setSaving(true);
    try {
      const r = initial ? await api.updateQuickMessage(initial._id, qm) : await api.createQuickMessage(qm);
      notify('success', initial ? 'Quick message saved' : 'Quick message created', `“${r.data.name}” is ready to send.`);
      onSaved(r.data);
    } catch (e) {
      const p = problemsOf(e);
      setServerProblems(p);
      if (!p.length) notify('error', 'Could not save', errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initial ? 'Edit quick message' : 'New quick message'}
      onClose={onClose}
      wide
      testid="qm-editor"
      footer={(
        <>
          {touched && shown.length > 0 && <span className="mm-foot-note err" data-testid="qm-problems">{shown[0].message}</span>}
          <button type="button" className="k-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="k-btn" onClick={save} disabled={saving} data-testid="qm-save">{saving ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <div className="mm-editor">
        <div className="mm-editor-form">
          <div className="k-field">
            <label className="k-label" htmlFor="qm-name">Name</label>
            <input id="qm-name" className="k-input" value={qm.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Weekend offers" />
            <FieldErr problems={shown} field="name" />
          </div>
          <div className="k-field">
            <span className="k-label">Send on</span>
            <div className="mm-check-row">
              {(['messenger', 'instagram'] as MetaChannel[]).map((ch) => (
                <label key={ch} className={`mm-check${qm.channels.includes(ch) ? ' on' : ''}`}>
                  <input type="checkbox" checked={qm.channels.includes(ch)} onChange={() => toggleChannel(ch)} />
                  <img src={CHANNEL_ICON[ch]} alt="" /> {CHANNEL_LABEL[ch]}
                </label>
              ))}
            </div>
            <FieldErr problems={shown} field="channels" />
          </div>
          <div className="k-field">
            <span className="k-label">Kind</span>
            <div className="mm-seg" role="tablist" aria-label="Kind">
              {(Object.keys(KIND_LABEL) as QuickMessageKind[]).map((k) => (
                <button type="button" role="tab" aria-selected={qm.kind === k} key={k} className={`mm-seg-btn${qm.kind === k ? ' active' : ''}`} onClick={() => setKind(k)} data-testid={`qm-kind-${k}`}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>

          {(qm.kind === 'text' || qm.kind === 'quick_replies' || qm.kind === 'image') && (
            <div className="k-field">
              <label className="k-label" htmlFor="qm-text">
                {qm.kind === 'image' ? 'Caption (optional, sent after the image)' : qm.kind === 'quick_replies' ? 'Question' : 'Message'}
              </label>
              <textarea id="qm-text" className="k-input mm-textarea" rows={4} value={qm.text} onChange={(e) => set({ text: e.target.value })} />
              <div className="mm-field-foot">
                {qm.kind === 'text' && qm.buttons.length
                  ? <Counter value={qm.text} max={textLimit.buttonText} />
                  : <Counter value={qm.text} max={textLimit.text} unit={textLimit.textUnit} />}
              </div>
              <FieldErr problems={shown} field="text" />
            </div>
          )}
          {qm.kind === 'text' && (
            <div className="k-field">
              <span className="k-label">Buttons (optional, up to 3)</span>
              <ButtonsEditor list={qm.buttons} onChange={(buttons) => set({ buttons })} max={3} titleMax={20} prefix="buttons" problems={shown} />
            </div>
          )}
          {qm.kind === 'image' && (
            <div className="k-field">
              <span className="k-label">Image</span>
              <ImageField api={api} value={qm.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
              {qm.channels.includes('instagram') && <p className="k-hint">Instagram accepts PNG and JPEG images up to 8 MB.</p>}
              <FieldErr problems={shown} field="imageUrl" />
            </div>
          )}
          {qm.kind === 'cards' && (
            <div className="k-field">
              <span className="k-label">Cards ({qm.cards.length}/10) — one card, or a carousel of up to 10</span>
              {qm.cards.map((c, i) => (
                <div className="mm-card-edit" key={i} data-testid={`qm-card-${i}`}>
                  <div className="mm-card-edit-head">
                    <strong>Card {i + 1}</strong>
                    {qm.cards.length > 1 && (
                      <button type="button" className="icon-btn" onClick={() => set({ cards: qm.cards.filter((_, j) => j !== i) })} aria-label={`Remove card ${i + 1}`}>
                        <span className="material-icons">delete_outline</span>
                      </button>
                    )}
                  </div>
                  <ImageField api={api} value={c.imageUrl} onChange={(imageUrl) => setCard(i, { imageUrl })} label={`Card ${i + 1} image`} />
                  <input className="k-input" placeholder="Title" value={c.title} onChange={(e) => setCard(i, { title: e.target.value })} aria-label={`Card ${i + 1} title`} />
                  <div className="mm-field-foot"><Counter value={c.title} max={80} /></div>
                  <FieldErr problems={shown} field={`cards.${i}.title`} />
                  <input className="k-input" placeholder="Subtitle" value={c.subtitle} onChange={(e) => setCard(i, { subtitle: e.target.value })} aria-label={`Card ${i + 1} subtitle`} />
                  <div className="mm-field-foot"><Counter value={c.subtitle} max={80} /></div>
                  <FieldErr problems={shown} field={`cards.${i}.subtitle`} />
                  <FieldErr problems={shown} field={`cards.${i}.imageUrl`} />
                  <ButtonsEditor list={c.buttons} onChange={(buttons) => setCard(i, { buttons })} max={3} titleMax={20} prefix={`cards.${i}.buttons`} problems={shown} />
                </div>
              ))}
              {qm.cards.length < 10 && (
                <button type="button" className="k-btn ghost sm" onClick={() => set({ cards: [...qm.cards, emptyCard()] })} data-testid="qm-add-card">
                  <span className="material-icons">add</span> Add card
                </button>
              )}
              <FieldErr problems={shown} field="cards" />
              {qm.channels.includes('instagram') && <p className="k-hint">On Instagram, cards show in the mobile app (not on instagram.com on a computer).</p>}
            </div>
          )}
          {qm.kind === 'quick_replies' && (
            <div className="k-field">
              <span className="k-label">Quick replies ({qm.quickReplies.length}/13)</span>
              {qm.quickReplies.map((q, i) => (
                <div className="mm-button-row" key={i}>
                  <input className="k-input" placeholder="Label" value={q.title} onChange={(e) => set({ quickReplies: qm.quickReplies.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} aria-label={`Quick reply ${i + 1}`} />
                  <span className={`mm-count${q.title.length > 20 ? ' over' : ''}`}>{q.title.length}/20</span>
                  <button type="button" className="icon-btn" onClick={() => set({ quickReplies: qm.quickReplies.filter((_, j) => j !== i) })} aria-label={`Remove quick reply ${i + 1}`}>
                    <span className="material-icons">delete_outline</span>
                  </button>
                  <FieldErr problems={shown} field={`quickReplies.${i}.title`} />
                </div>
              ))}
              {qm.quickReplies.length < 13 && (
                <button type="button" className="k-btn ghost sm" onClick={() => set({ quickReplies: [...qm.quickReplies, { title: '', payload: '' }] })}>
                  <span className="material-icons">add</span> Add quick reply
                </button>
              )}
              <FieldErr problems={shown} field="quickReplies" />
            </div>
          )}
        </div>

        <div className="mm-editor-preview">
          {channelsFor.length > 1 && (
            <div className="mm-seg sm" role="tablist" aria-label="Preview channel">
              {channelsFor.map((ch) => (
                <button type="button" key={ch} className={`mm-seg-btn${pvChannel === ch ? ' active' : ''}`} onClick={() => setPreviewCh(ch)} data-testid={`qm-preview-${ch}`}>
                  {CHANNEL_LABEL[ch]}
                </button>
              ))}
            </div>
          )}
          <QuickMessagePreview qm={qm} channel={pvChannel} />
          {quickProblems(qm, pvChannel).length === 0 && <p className="mm-ok" data-testid="qm-ok"><span className="material-icons">check_circle</span> Fits {CHANNEL_LABEL[pvChannel]}’s limits</p>}
        </div>
      </div>
    </Modal>
  );
}

// ==================================================== quick messages list ==

export function QuickMessagesSection({ api, channel }: { api: CrmApi; channel: MetaChannel }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [rows, setRows] = useState<QuickMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<QuickMessage | 'new' | null>(null);
  const [preview, setPreview] = useState<QuickMessage | null>(null);

  function load() {
    setLoading(true);
    return api.getQuickMessages(channel).then((r) => setRows(r.data || [])).catch(() => setRows([])).finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [channel]);

  async function duplicate(q: QuickMessage) {
    try {
      await api.duplicateQuickMessage(q._id);
      notify('success', 'Quick message copied', `“${q.name} (copy)” was added.`);
      load();
    } catch (e) {
      notify('error', 'Could not copy', errorText(e));
    }
  }
  const paged = usePaged(rows, channel, { key: 'quick-messages', noun: ['quick message', 'quick messages'] });
  async function remove(q: QuickMessage) {
    const ok = await confirm({ title: 'Delete quick message?', message: `“${q.name}” will be deleted. Campaigns that use it will stop sending it.`, confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await api.deleteQuickMessage(q._id);
      notify('success', 'Quick message deleted');
      load();
    } catch (e) {
      notify('error', 'Could not delete', errorText(e));
    }
  }

  return (
    <section className="mm-section" data-testid={`qm-section-${channel}`}>
      <div className="mm-section-head">
        <div>
          <h3>Quick messages</h3>
          <p className="mm-sub">
            Saved messages you build here: text, an image, cards or a carousel, and quick-reply chips. No approval from Meta is needed,
            and they can only be sent within 24 hours of the customer’s last message.
          </p>
        </div>
        <button type="button" className="k-btn" onClick={() => setEditing('new')} data-testid="qm-new">
          <span className="material-icons">add</span> New quick message
        </button>
      </div>
      <div className="tl-table-wrap">
        <table className="tl-table mm-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Kind</th>
              <th scope="col">Channels</th>
              <th scope="col">Last updated</th>
              <th scope="col" className="c">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr><td colSpan={5} className="tl-empty"><BladeSpinner center={true} containerHeight={80} /></td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="tl-empty">No quick messages for {CHANNEL_LABEL[channel]} yet. Create your first one.</td></tr>
            )}
            {paged.items.map((q) => (
              <tr key={q._id} data-qm-id={q._id}>
                <td>
                  <button type="button" className="tl-name" onClick={() => setPreview(q)}>{q.name}</button>
                </td>
                <td>{KIND_LABEL[q.kind]}{q.kind === 'cards' && q.cards.length > 1 ? ` · carousel of ${q.cards.length}` : ''}</td>
                <td>
                  <span className="mm-ch-icons">
                    {q.channels.map((ch) => <img key={ch} src={CHANNEL_ICON[ch]} alt={CHANNEL_LABEL[ch]} title={CHANNEL_LABEL[ch]} />)}
                  </span>
                </td>
                <td>{dateLabel(q.updatedAt || q.createdAt)}</td>
                <td className="c">
                  <div className="tl-actions">
                    <button type="button" className="tl-act" onClick={() => setPreview(q)} title="Preview" aria-label={`Preview ${q.name}`}><span className="material-icons">visibility</span></button>
                    <button type="button" className="tl-act" onClick={() => setEditing(q)} title="Edit" aria-label={`Edit ${q.name}`}><span className="material-icons">edit</span></button>
                    <button type="button" className="tl-act" onClick={() => duplicate(q)} title="Duplicate" aria-label={`Duplicate ${q.name}`}><CopyIcon /></button>
                    <button type="button" className="tl-act danger" onClick={() => remove(q)} title="Delete" aria-label={`Delete ${q.name}`}><span className="material-icons">delete_outline</span></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager {...paged.pager} />
      {editing && (
        <QuickMessageEditor
          api={api}
          initial={editing === 'new' ? null : editing}
          defaultChannel={channel}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)} testid="qm-preview-modal">
          <div className="mm-preview-pair">
            {preview.channels.map((ch) => <QuickMessagePreview key={ch} qm={preview} channel={ch} />)}
          </div>
        </Modal>
      )}
    </section>
  );
}

// ================================================= utility template forms ==

export function VariablesEditor({ count, variables, onChange, examples }: {
  count: number; variables: UtilityVariable[]; onChange: (v: UtilityVariable[]) => void; examples?: string[];
}) {
  if (!count) return null;
  const vars = Array.from({ length: count }, (_, i) => variables.find((v) => v.index === i + 1) || { index: i + 1, source: 'text' as const, fallback: '' });
  const set = (i: number, patch: Partial<UtilityVariable>) => onChange(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <div className="mm-vars">
      <span className="k-label">When sending, fill each placeholder with</span>
      {vars.map((v, i) => (
        <div className="mm-var-row" key={i}>
          <code>{`{{${i + 1}}}`}</code>
          {examples?.[i] && <span className="mm-var-ex">e.g. {examples[i]}</span>}
          <Dropdown
            size="sm"
            options={[{ value: 'contact_name', label: 'The contact’s name' }, { value: 'text', label: 'A value typed when sending' }]}
            value={v.source}
            onChange={(s) => set(i, { source: s as UtilityVariable['source'] })}
            className="mm-var-src"
          />
          {v.source === 'contact_name' && (
            <input className="k-input" placeholder="If there's no name, use…" value={v.fallback} maxLength={60} onChange={(e) => set(i, { fallback: e.target.value })} aria-label={`Fallback for {{${i + 1}}}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export function UtilityCreateModal({ api, onClose, onCreated, seed }: {
  api: CrmApi; onClose: () => void; onCreated: (t: UtilityTemplate) => void;
  /** Start from this content (Template Library → Use template). */
  seed?: Partial<UtilityTemplateInput> | null;
}) {
  const notify = useNotify();
  const [v, setV] = useState<UtilityTemplateInput>(() => ({ name: '', language: 'en', bodyText: '', bodyExamples: [], buttons: [], variables: [], ...(seed || {}) }));
  const [touched, setTouched] = useState(false);
  const [server, setServer] = useState<FieldProblem[]>([]);
  const [saving, setSaving] = useState(false);
  const problems = useMemo(() => utilityProblems(v), [v]);
  const shown = touched ? [...problems, ...server] : server;
  const count = paramCount(v.bodyText);
  const set = (patch: Partial<UtilityTemplateInput>) => { setV((x) => ({ ...x, ...patch })); setServer([]); };
  const setBtn = (i: number, patch: Partial<UtilityButton>) => set({ buttons: v.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  async function submit() {
    setTouched(true);
    if (problems.length) return;
    setSaving(true);
    try {
      // Every {{n}} gets a mapping, the default (typed when sending) unless changed.
      const variables = Array.from({ length: count }, (_, i) => v.variables.find((x) => x.index === i + 1) || { index: i + 1, source: 'text' as const, fallback: '' });
      const r = await api.createUtilityTemplate({ ...v, bodyExamples: v.bodyExamples.slice(0, count), variables });
      notify('success', 'Template submitted', r.data.status === 'APPROVED' ? `Meta approved “${r.data.name}”.` : `“${r.data.name}” is ${titleCase(r.data.status).toLowerCase()} at Meta.`);
      onCreated(r.data);
    } catch (e) {
      const p = problemsOf(e);
      setServer(p);
      if (!p.length) notify('error', 'Meta didn’t accept the template', errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Create a utility template"
      onClose={onClose}
      wide
      testid="ut-create"
      footer={(
        <>
          {touched && shown.length > 0 && <span className="mm-foot-note err">{shown[0].message}</span>}
          <button type="button" className="k-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="k-btn" onClick={submit} disabled={saving} data-testid="ut-submit">{saving ? 'Submitting…' : 'Submit to Meta'}</button>
        </>
      )}
    >
      <div className="mm-editor">
        <div className="mm-editor-form">
          <p className="mm-notice">
            <span className="material-icons">info</span>
            Utility templates are for updates and reminders only: an order, an account, an appointment or an event. Promotions, offers and
            discounts are not allowed and Meta rejects them.
          </p>
          <div className="mm-two">
            <div className="k-field">
              <label className="k-label" htmlFor="ut-name">Name</label>
              <input id="ut-name" className="k-input" value={v.name} maxLength={UTILITY_LIMITS.name} placeholder="order_update" onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/\s+/g, '_') })} />
              <FieldErr problems={shown} field="name" />
            </div>
            <div className="k-field">
              <span className="k-label">Language</span>
              <Dropdown options={UTILITY_LANGUAGES} value={v.language} onChange={(language) => set({ language })} />
            </div>
          </div>
          <div className="k-field">
            <label className="k-label" htmlFor="ut-body">Message</label>
            <textarea id="ut-body" className="k-input mm-textarea" rows={5} value={v.bodyText} placeholder="Hi {{1}}, your order {{2}} has shipped." onChange={(e) => set({ bodyText: e.target.value })} />
            <div className="mm-field-foot">
              <button type="button" className="k-btn ghost sm" onClick={() => set({ bodyText: `${v.bodyText}{{${count + 1}}}` })}>
                <span className="material-icons">add</span> Placeholder {`{{${count + 1}}}`}
              </button>
              <Counter value={v.bodyText} max={UTILITY_LIMITS.body} />
            </div>
            <FieldErr problems={shown} field="bodyText" />
          </div>
          {count > 0 && (
            <div className="k-field">
              <span className="k-label">Sample values (Meta reviews the template with them)</span>
              {Array.from({ length: count }, (_, i) => (
                <div key={i}>
                  <div className="mm-var-row">
                    <code>{`{{${i + 1}}}`}</code>
                    <input className="k-input" value={v.bodyExamples[i] || ''} placeholder="Sample" onChange={(e) => { const ex = [...v.bodyExamples]; ex[i] = e.target.value; set({ bodyExamples: ex }); }} aria-label={`Sample for {{${i + 1}}}`} />
                  </div>
                  <FieldErr problems={shown} field={`bodyExamples.${i}`} />
                </div>
              ))}
            </div>
          )}
          <VariablesEditor count={count} variables={v.variables} onChange={(variables) => set({ variables })} />
          <div className="k-field">
            <span className="k-label">Buttons (optional, up to 3)</span>
            {v.buttons.map((b, i) => (
              <div className="mm-ubtn" key={i}>
                <div className="mm-button-row">
                  <Dropdown size="sm" options={[{ value: 'URL', label: 'Visit website' }, { value: 'PHONE_NUMBER', label: 'Call phone' }]} value={b.type} onChange={(t) => setBtn(i, { type: t as UtilityButton['type'] })} className="mm-btn-type" />
                  <input className="k-input" placeholder="Label" value={b.text} maxLength={40} onChange={(e) => setBtn(i, { text: e.target.value })} aria-label={`Button ${i + 1} label`} />
                  {b.type === 'URL' ? (
                    <input className="k-input" placeholder="https://… (end with {{1}} for a per-message part)" value={b.url} onChange={(e) => setBtn(i, { url: e.target.value })} aria-label={`Button ${i + 1} link`} />
                  ) : (
                    <input className="k-input" placeholder="+919876543210" value={b.phone} onChange={(e) => setBtn(i, { phone: e.target.value })} aria-label={`Button ${i + 1} phone`} />
                  )}
                  <button type="button" className="icon-btn" onClick={() => set({ buttons: v.buttons.filter((_, j) => j !== i) })} aria-label={`Remove button ${i + 1}`}>
                    <span className="material-icons">delete_outline</span>
                  </button>
                </div>
                {b.type === 'URL' && /\{\{\s*1\s*\}\}/.test(b.url) && (
                  <input className="k-input" placeholder="Full sample link, e.g. https://shop.example/track/1042" value={b.urlExample} onChange={(e) => setBtn(i, { urlExample: e.target.value })} aria-label={`Button ${i + 1} sample link`} />
                )}
                <FieldErr problems={shown} field={`buttons.${i}.text`} />
                <FieldErr problems={shown} field={`buttons.${i}.url`} />
                <FieldErr problems={shown} field={`buttons.${i}.urlExample`} />
                <FieldErr problems={shown} field={`buttons.${i}.phone`} />
              </div>
            ))}
            {v.buttons.length < UTILITY_LIMITS.buttons && (
              <button type="button" className="k-btn ghost sm" onClick={() => set({ buttons: [...v.buttons, emptyUtilityButton()] })}>
                <span className="material-icons">add</span> Add button
              </button>
            )}
          </div>
        </div>
        <div className="mm-editor-preview">
          <UtilityPreview bodyText={v.bodyText} values={v.bodyExamples} buttons={v.buttons} />
        </div>
      </div>
    </Modal>
  );
}

function LibraryModal({ api, onClose, onCloned }: { api: CrmApi; onClose: () => void; onCloned: (t: UtilityTemplate) => void }) {
  const notify = useNotify();
  const [q, setQ] = useState('');
  const [language, setLanguage] = useState('en');
  const [rows, setRows] = useState<LibraryTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [pick, setPick] = useState<LibraryTemplate | null>(null);
  const [name, setName] = useState('');
  const [inputs, setInputs] = useState<{ url?: string; phone?: string }[]>([]);
  const [variables, setVariables] = useState<UtilityVariable[]>([]);
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [saving, setSaving] = useState(false);

  async function search() {
    setBusy(true);
    setError('');
    try {
      const r = await api.searchTemplateLibrary(q.trim(), language);
      setRows(r.data || []);
    } catch (e) {
      setError(errorText(e));
      setRows([]);
    } finally {
      setBusy(false);
      setSearched(true);
    }
  }
  useEffect(() => { search(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function choose(t: LibraryTemplate) {
    setPick(t);
    setName(`${t.name}`.replace(/[^a-z0-9_]/g, '_'));
    setInputs(t.buttons.map(() => ({})));
    setVariables(Array.from({ length: paramCount(t.body) }, (_, i) => ({ index: i + 1, source: i === 0 && /name/i.test(t.bodyParams[0] || '') ? 'contact_name' : 'text', fallback: '' })));
    setProblems([]);
  }

  async function clone() {
    if (!pick) return;
    const local: FieldProblem[] = [];
    if (!/^[a-z0-9_]+$/.test(name)) local.push({ field: 'name', message: 'Use lowercase letters, numbers and underscores only in the name.' });
    pick.buttons.forEach((b, i) => {
      if (b.type === 'URL' && !/^https?:\/\//.test(inputs[i]?.url || '')) local.push({ field: `buttonInputs.${i}.url`, message: `“${b.text}” needs your web address (https://…).` });
      if (b.type === 'PHONE_NUMBER' && !/^\+\d{7,15}$/.test((inputs[i]?.phone || '').replace(/[\s()-]/g, ''))) local.push({ field: `buttonInputs.${i}.phone`, message: `“${b.text}” needs your phone number with the country code.` });
    });
    setProblems(local);
    if (local.length) return;
    setSaving(true);
    try {
      const r = await api.cloneLibraryTemplate({
        libraryTemplateName: pick.name,
        name,
        language: pick.language || language,
        libraryBody: pick.body,
        libraryBodyParams: pick.bodyParams,
        libraryButtons: pick.buttons.map((b) => ({ type: b.type, text: b.text })),
        buttonInputs: inputs,
        variables,
      });
      notify('success', 'Template added', `“${r.data.name}” is ${titleCase(r.data.status).toLowerCase()}.`);
      onCloned(r.data);
    } catch (e) {
      const p = problemsOf(e);
      setProblems(p);
      if (!p.length) notify('error', 'Meta didn’t accept the copy', errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={pick ? `Use “${pick.name}”` : 'Use one of Meta’s templates'}
      onClose={onClose}
      wide
      testid="ut-library"
      footer={pick ? (
        <>
          {problems.length > 0 && <span className="mm-foot-note err">{problems[0].message}</span>}
          <button type="button" className="k-btn ghost" onClick={() => setPick(null)}>Back</button>
          <button type="button" className="k-btn" onClick={clone} disabled={saving} data-testid="ut-clone">{saving ? 'Adding…' : 'Add to my templates'}</button>
        </>
      ) : undefined}
    >
      {!pick ? (
        <div className="mm-library">
          <div className="mm-library-search">
            <input className="k-input" type="search" placeholder="Search Meta’s templates, e.g. order, appointment" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }} aria-label="Search the template library" data-testid="ut-library-q" />
            <Dropdown size="sm" options={UTILITY_LANGUAGES} value={language} onChange={setLanguage} className="mm-lib-lang" />
            <button type="button" className="k-btn sm" onClick={search} disabled={busy} data-testid="ut-library-search">{busy ? 'Searching…' : 'Search'}</button>
          </div>
          <p className="k-hint">Meta’s templates are already approved for utility messages. Copy one to your Page and fill in your own link or phone number.</p>
          {error && <p className="err">{error}</p>}
          {!busy && searched && !error && rows.length === 0 && <p className="mm-empty">No templates match. Try another word.</p>}
          <div className="mm-lib-grid">
            {rows.map((t) => (
              <button type="button" key={`${t.name}-${t.language}`} className="mm-lib-item" onClick={() => choose(t)} data-testid="ut-library-item">
                <span className="mm-lib-name">{t.name}</span>
                <span className="mm-lib-meta">{titleCase(t.topic)} · {titleCase(t.usecase)} · {languageLabel(t.language)}</span>
                <span className="mm-lib-body">{renderParams(t.body, t.bodyParams)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mm-editor">
          <div className="mm-editor-form">
            <div className="k-field">
              <label className="k-label" htmlFor="ut-clone-name">Name for your copy</label>
              <input id="ut-clone-name" className="k-input" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '_'))} />
              <FieldErr problems={problems} field="name" />
            </div>
            {pick.buttons.map((b, i) => (
              <div className="k-field" key={i}>
                <label className="k-label">{b.type === 'URL' ? `Your link for “${b.text}”` : `Your phone number for “${b.text}”`}</label>
                <input
                  className="k-input"
                  value={(b.type === 'URL' ? inputs[i]?.url : inputs[i]?.phone) || ''}
                  placeholder={b.type === 'URL' ? 'https://yourshop.example/orders' : '+919876543210'}
                  onChange={(e) => setInputs(inputs.map((x, j) => (j === i ? (b.type === 'URL' ? { url: e.target.value } : { phone: e.target.value }) : x)))}
                  data-testid={`ut-clone-input-${i}`}
                />
                <FieldErr problems={problems} field={`buttonInputs.${i}.${b.type === 'URL' ? 'url' : 'phone'}`} />
              </div>
            ))}
            <VariablesEditor count={paramCount(pick.body)} variables={variables} onChange={setVariables} examples={pick.bodyParams} />
          </div>
          <div className="mm-editor-preview">
            <UtilityPreview bodyText={pick.body} values={pick.bodyParams} buttons={pick.buttons.map((b) => ({ type: b.type === 'PHONE_NUMBER' ? 'PHONE_NUMBER' : 'URL', text: b.text, url: b.url, urlExample: '', phone: b.phone }))} />
          </div>
        </div>
      )}
    </Modal>
  );
}

// ============================================== utility templates section ==

function UtilityTemplatesSection({ api, connection, onNavigate }: {
  api: CrmApi; connection: MetaChannelConnection | null; onNavigate?: (view: string) => void;
}) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [rows, setRows] = useState<UtilityTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<'create' | 'library' | null>(null);
  const [preview, setPreview] = useState<UtilityTemplate | null>(null);
  const connected = connection?.status === 'connected';

  function load() {
    setLoading(true);
    return api.getUtilityTemplates().then((r) => setRows(r.data || [])).catch(() => setRows([])).finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await api.refreshUtilityTemplates();
      setRows(r.data || []);
      notify('success', 'Statuses refreshed', r.updated || r.added ? `${r.updated} changed, ${r.added} added from your Page.` : 'Everything is up to date.');
    } catch (e) {
      notify('error', 'Could not refresh', errorText(e));
    } finally {
      setRefreshing(false);
    }
  }
  const paged = usePaged(rows, '', { key: 'utility-templates', noun: ['template', 'templates'] });
  async function remove(t: UtilityTemplate) {
    const ok = await confirm({ title: 'Delete template?', message: `“${t.name}” will be deleted from your Facebook Page too (every language of it). Campaigns using it will stop sending it.`, confirmLabel: 'Delete template' });
    if (!ok) return;
    try {
      await api.deleteUtilityTemplate(t._id);
      notify('success', 'Template deleted', `“${t.name}” was removed.`);
      load();
    } catch (e) {
      notify('error', 'Delete failed', errorText(e));
    }
  }

  return (
    <section className="mm-section" data-testid="ut-section">
      <div className="mm-section-head">
        <div>
          <h3>Utility templates <span className="mm-badge">Approved by Meta</span></h3>
          <p className="mm-sub">
            The only messages Messenger allows more than 24 hours after a customer’s last message. Use them for updates and reminders
            (orders, accounts, appointments, events), never for promotions.
          </p>
        </div>
        {connected && (
          <div className="mm-head-actions">
            <button type="button" className="k-btn ghost" onClick={refresh} disabled={refreshing} data-testid="ut-refresh" title="Read the latest status from Meta">
              <span className={`material-icons${refreshing ? ' mm-spin' : ''}`}>refresh</span> Refresh
            </button>
            <button type="button" className="k-btn ghost" onClick={() => setModal('library')} data-testid="ut-library-open">
              <span className="material-icons">library_books</span> Use one of Meta’s templates
            </button>
            <button type="button" className="k-btn" onClick={() => setModal('create')} data-testid="ut-create-open">
              <span className="material-icons">add</span> Create template
            </button>
          </div>
        )}
      </div>
      {!connected ? (
        <div className="mm-connect" data-testid="ut-connect">
          <img src={CHANNEL_ICON.messenger} alt="" />
          <div>
            <strong>{connection ? 'Messenger needs to be reconnected' : 'Connect Messenger first'}</strong>
            <p>
              Utility templates live on your Facebook Page.{' '}
              {connection ? `Meta removed the CRM’s access to ${connection.pageName || 'your Page'}.` : 'Connect your Page on Channel Status to create and send them.'}
            </p>
          </div>
          {onNavigate && (
            <button type="button" className="k-btn" onClick={() => onNavigate('channel-status:messenger')} data-testid="ut-connect-btn">
              {connection ? 'Reconnect Messenger' : 'Connect Messenger'}
            </button>
          )}
        </div>
      ) : (
        <div className="tl-table-wrap">
          <table className="tl-table mm-table">
            <thead>
              <tr>
                <th scope="col">Template name</th>
                <th scope="col">Language</th>
                <th scope="col" className="c">Status</th>
                <th scope="col">Last updated</th>
                <th scope="col" className="c">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && <tr><td colSpan={5} className="tl-empty"><BladeSpinner center={true} containerHeight={80} /></td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={5} className="tl-empty">No utility templates yet. Create one or copy one of Meta’s.</td></tr>}
              {paged.items.map((t) => (
                <tr key={t._id} data-ut-name={t.name}>
                  <td>
                    <button type="button" className="tl-name" onClick={() => setPreview(t)}>{t.name}</button>
                    {t.origin === 'clone' && <span className="tl-kind">From Meta’s library</span>}
                    {!t.onCurrentPage && <span className="tl-kind">Other Page</span>}
                  </td>
                  <td>{languageLabel(t.language)}</td>
                  <td className="c">
                    <span className={`tl-status ${STATUS_TONE[t.status] || 'amber'}`} data-testid="ut-status">{titleCase(t.status)}</span>
                    {t.status === 'REJECTED' && t.rejectedReason && <span className="tl-reason" title={utilityReason(t.rejectedReason)}>{utilityReason(t.rejectedReason)}</span>}
                  </td>
                  <td>{dateLabel(t.updatedAt || t.createdAt)}</td>
                  <td className="c">
                    <div className="tl-actions">
                      <button type="button" className="tl-act" onClick={() => setPreview(t)} title="Preview" aria-label={`Preview ${t.name}`}><span className="material-icons">visibility</span></button>
                      <button type="button" className="tl-act danger" onClick={() => remove(t)} title="Delete" aria-label={`Delete ${t.name}`}><span className="material-icons">delete_outline</span></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {connected && <Pager {...paged.pager} />}
      {modal === 'create' && <UtilityCreateModal api={api} onClose={() => setModal(null)} onCreated={() => { setModal(null); load(); }} />}
      {modal === 'library' && <LibraryModal api={api} onClose={() => setModal(null)} onCloned={() => { setModal(null); load(); }} />}
      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)} testid="ut-preview-modal">
          <UtilityPreview bodyText={preview.bodyText} values={preview.bodyExamples} buttons={preview.buttons} />
          <p className="k-hint">
            {languageLabel(preview.language)} · {titleCase(preview.status)}
            {preview.status === 'REJECTED' && preview.rejectedReason ? ` · ${utilityReason(preview.rejectedReason)}` : ''}
          </p>
        </Modal>
      )}
    </section>
  );
}

// ================================================================= panels ==

export function MetaTemplatesPanel({ api, channel, onNavigate }: { api: CrmApi; channel: MetaChannel; onNavigate?: (view: string) => void }) {
  const [connections, setConnections] = useState<Record<MetaChannel, MetaChannelConnection | null> | null>(null);
  useEffect(() => {
    api.getMetaChannels().then((r) => setConnections(r.connections)).catch(() => setConnections({ messenger: null, instagram: null }));
  }, [api]);
  const conn = connections ? connections[channel] : null;
  return (
    <div className="mm-panel" data-testid={`meta-templates-${channel}`}>
      {channel === 'instagram' && (
        <p className="mm-notice" data-testid="ig-note">
          <span className="material-icons">info</span>
          Instagram has no approved templates. Messages can only be sent within 24 hours of the customer’s last message, so quick messages
          are what you can save and reuse here.
        </p>
      )}
      {connections && !conn && channel === 'instagram' && (
        <div className="mm-connect">
          <img src={CHANNEL_ICON.instagram} alt="" />
          <div>
            <strong>Instagram isn’t connected</strong>
            <p>You can build quick messages now; to send them, connect Instagram on Channel Status.</p>
          </div>
          {onNavigate && (
            <button type="button" className="k-btn" onClick={() => onNavigate('channel-status:instagram')} data-testid="ig-connect-btn">
              Connect Instagram
            </button>
          )}
        </div>
      )}
      {channel === 'messenger' && (connections ? <UtilityTemplatesSection api={api} connection={conn} onNavigate={onNavigate} /> : <BladeSpinner center={true} containerHeight={120} />)}
      <QuickMessagesSection api={api} channel={channel} />
    </div>
  );
}
