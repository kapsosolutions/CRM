// Templates → Ready-made: the business type's cards, then the chosen card's
// choices with a live list of what the customer goes through and what the
// business needs to set up. "Create flow" saves the generated flow as a new
// draft (flowTemplates.ts builds it).
import { useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type { WaFlowDef } from '../types';
import type { VerticalConfig } from '../verticals';
import {
  buildTemplate, checkTemplateFlow, choicesFor, extrasFor, isLinkKind, LINK_INFO, LINK_KINDS, LINK_NEED, linkProblem, MAX_EXTRAS, optionsFor, templateCardsFor,
  type ChoiceDef, type LinkDetails, type LinkKind, type TemplateCard, type TemplateOptions,
} from '../flowTemplates';
import './FlowTemplateGallery.css';

/** "Delivery · pay online", or "… (2)" when a flow already has that name. */
function freeName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) if (!taken.has(`${base} (${i})`)) return `${base} (${i})`;
}

/** The short tags on a card: how it pays, PDF, how many menu items. */
function tagsOf(card: TemplateCard, v: VerticalConfig): string[] {
  const o = optionsFor(card);
  const t: string[] = [];
  if (card.main.kind === 'order' || card.main.kind === 'booking') {
    if (card.main.kind === 'order') {
      t.push(o.mode === 'choose' ? 'Customer chooses how' : o.mode === 'takeaway' ? (v.key === 'restaurant' ? 'Takeaway' : 'Pickup') : o.mode === 'dinein' ? 'Dine-in' : 'Delivery');
    }
    t.push(o.pay === 'online' ? 'Pay online' : o.pay === 'cash' ? 'Pay later' : o.pay === 'both' ? 'Online or later' : 'No payment');
    if (o.confirm === 'pdf') t.push('PDF slip');
  } else if (card.main.kind === 'form') {
    t.push('Form');
    if (o.categoryStep && v.showsPage('categories')) t.push(`${v.categoryLabel} first`);
  } else {
    t.push('Order status');
  }
  if (o.extras.length) t.push(`Menu · ${o.extras.length + 1} items`);
  return t;
}

/**
 * The details of a Location / Call / Brochure / Website menu item, asked when
 * it's picked: the same pop-up as a block's settings on the Map and in Journeys.
 */
function LinkDetailsModal({
  kind, initial, inMenu, onSave, onRemove, onClose,
}: {
  kind: LinkKind;
  initial: LinkDetails;
  /** Already in the menu: offer to take it out. */
  inMenu: boolean;
  onSave: (d: LinkDetails) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const info = LINK_INFO[kind];
  const [d, setD] = useState<LinkDetails>(initial);
  const [tried, setTried] = useState(false);
  const problem = linkProblem(kind, d);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const save = () => {
    setTried(true);
    if (!problem) onSave({ text: d.text.trim(), label: d.label.trim(), value: d.value.trim() });
  };
  return (
    <div className="jn-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="ftg-link-backdrop">
      <div className="jn-modal ftg-link-modal" role="dialog" aria-modal="true" aria-label={`${info.title} settings`} data-testid="ftg-link-modal" data-kind={kind} style={{ ['--k' as string]: info.color }}>
        <header className="jn-modal-head">
          <span className="jn-ic"><span className="material-icons">{info.icon}</span></span>
          <div className="jn-modal-titles">
            <h3>{info.title}</h3>
            <p>{kind === 'call' ? 'A message with a button that calls you' : 'A message with a button that opens your link'}</p>
          </div>
          <button type="button" className="jn-modal-x" onClick={onClose} aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </header>
        <div className="jn-modal-body">
          <div className="fl-node jn-fields" style={{ ['--k' as string]: info.color }}>
            <label className="ftg-link-label" htmlFor="ftg-link-value">{info.valueLabel}</label>
            <input
              id="ftg-link-value"
              className="ftg-link-input"
              value={d.value}
              onChange={(e) => setD({ ...d, value: e.target.value })}
              placeholder={info.placeholder}
              inputMode={kind === 'call' ? 'tel' : 'url'}
              autoFocus
              data-testid="ftg-link-value"
            />
            <div className="ftg-hint">{info.hint}</div>
            <label className="ftg-link-label" htmlFor="ftg-link-text">Message</label>
            <textarea
              id="ftg-link-text"
              className="fl-node-text"
              value={d.text}
              onChange={(e) => setD({ ...d, text: e.target.value })}
              rows={3}
              data-testid="ftg-link-text"
            />
            <label className="ftg-link-label" htmlFor="ftg-link-button">Button text</label>
            <input
              id="ftg-link-button"
              className="ftg-link-input"
              value={d.label}
              onChange={(e) => setD({ ...d, label: e.target.value })}
              maxLength={20}
              data-testid="ftg-link-button"
            />
            <div className="ftg-hint">{d.label.length}/20 characters</div>
            <div className="ftg-link-preview" aria-hidden="true">
              <div className="ftg-link-bubble">{d.text || info.defaults.text}</div>
              <div className="ftg-link-btn">
                <span className="material-icons">{kind === 'call' ? 'call' : 'open_in_new'}</span>
                {d.label || info.defaults.label}
              </div>
            </div>
            {tried && problem && <div className="pa-error" data-testid="ftg-link-problem">{problem}</div>}
          </div>
        </div>
        <footer className="jn-modal-foot">
          {inMenu ? (
            <button type="button" className="k-btn ghost sm danger" onClick={onRemove} data-testid="ftg-link-remove">
              <span className="material-icons">delete_outline</span> Remove from menu
            </button>
          ) : (
            <button type="button" className="k-btn ghost sm" onClick={onClose} data-testid="ftg-link-cancel">Cancel</button>
          )}
          <span className="jn-modal-note">{inMenu ? 'Saved with the flow when you create it.' : 'Adds it to the menu.'}</span>
          <button type="button" className="k-btn sm" onClick={save} data-testid="ftg-link-save">{inMenu ? 'Save' : 'Add to menu'}</button>
        </footer>
      </div>
    </div>
  );
}

export function ReadyTemplates({
  api,
  vertical,
  existingNames,
  onCreated,
}: {
  api: CrmApi;
  vertical: VerticalConfig;
  existingNames: string[];
  onCreated: (flow: WaFlowDef) => void;
}) {
  const cards = useMemo(() => templateCardsFor(vertical), [vertical]);
  const [card, setCard] = useState<TemplateCard | null>(null);
  const [opts, setOpts] = useState<TemplateOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The Location / Call / Brochure / Website item whose details are being asked.
  const [editingLink, setEditingLink] = useState<LinkKind | null>(null);

  const built = useMemo(() => (card && opts ? buildTemplate(card, vertical, opts) : null), [card, opts, vertical]);
  const problems = useMemo(() => (built ? checkTemplateFlow(built.flow) : []), [built]);
  const choices: ChoiceDef[] = card && opts ? choicesFor(card, vertical, opts) : [];
  const extras = card ? extrasFor(card, vertical) : [];

  function open(c: TemplateCard) {
    setCard(c);
    setOpts(optionsFor(c));
    setError('');
  }
  const set = (patch: Partial<TemplateOptions>) => setOpts((o) => (o ? { ...o, ...patch } : o));
  function addExtra(o: TemplateOptions, id: string): TemplateOptions {
    if (o.extras.includes(id) || o.extras.length >= MAX_EXTRAS) return o;
    // Keep the menu in the order the list shows.
    const order = extras.map((x) => x.id);
    return { ...o, extras: [...o.extras, id].sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
  }
  function toggleExtra(id: string) {
    // These need the business's own link or number first: ask in a pop-up.
    if (isLinkKind(id)) {
      setEditingLink(id);
      return;
    }
    setOpts((o) => {
      if (!o) return o;
      if (o.extras.includes(id)) return { ...o, extras: o.extras.filter((x) => x !== id) };
      return addExtra(o, id);
    });
  }
  function saveLink(kind: LinkKind, det: LinkDetails) {
    setOpts((o) => (o ? addExtra({ ...o, links: { ...o.links, [kind]: det } }, kind) : o));
    setEditingLink(null);
  }
  function removeLink(kind: LinkKind) {
    setOpts((o) => (o ? { ...o, extras: o.extras.filter((x) => x !== kind) } : o));
    setEditingLink(null);
  }
  /** A setup line that a pop-up can fill in. */
  const linkOfNeed = (need: string): LinkKind | null => LINK_KINDS.find((k) => LINK_NEED[k] === need) || null;

  async function create() {
    if (!built || !card || problems.length) return;
    setBusy(true);
    setError('');
    try {
      const name = freeName(built.flow.name, new Set(existingNames));
      const r = await api.createFlowDef({ ...built.flow, name });
      onCreated(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the flow');
      setBusy(false);
    }
  }

  if (!card || !opts || !built) {
    return (
      <div className="ftg" data-testid="ftg-gallery">
        <div className="ftg-grid">
          {cards.map((c) => (
            <button type="button" className="ftg-card" key={c.id} onClick={() => open(c)} data-testid={`ftg-card-${c.id}`}>
              <span className="material-icons ftg-card-ic">{c.icon}</span>
              <span className="ftg-card-title">{c.title}</span>
              <span className="ftg-card-desc">{c.description}</span>
              <span className="ftg-tags">
                {tagsOf(c, vertical).map((t) => <span className="ftg-tag" key={t}>{t}</span>)}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const stats = `${built.flow.screens.length} screen${built.flow.screens.length === 1 ? '' : 's'} · ${(built.flow.blocks || []).length} message block${(built.flow.blocks || []).length === 1 ? '' : 's'}`;
  return (
    <div className="ftg ftg-config" data-testid="ftg-config" data-card={card.id}>
      <button type="button" className="ftg-back" onClick={() => setCard(null)} data-testid="ftg-back">
        <span className="material-icons">arrow_back</span> All templates
      </button>
      <div className="ftg-config-head">
        <span className="material-icons ftg-card-ic">{card.icon}</span>
        <div>
          <div className="ftg-config-title">{card.title}</div>
          <div className="ftg-card-desc">{card.description}</div>
        </div>
      </div>

      <div className="ftg-cols">
        <div className="ftg-choices">
          {choices.map((c) => (
            <div className="ftg-choice" key={c.key} data-testid={`ftg-choice-${c.key}`}>
              <div className="ftg-choice-label">{c.label}</div>
              {c.kind === 'bool' ? (
                <label className="ftg-switch">
                  <input
                    type="checkbox"
                    checked={!!opts[c.key]}
                    onChange={(e) => set({ [c.key]: e.target.checked } as Partial<TemplateOptions>)}
                  />
                  <span className="ftg-switch-track"><span className="ftg-switch-thumb" /></span>
                  <span>{opts[c.key] ? 'Yes' : 'No'}</span>
                </label>
              ) : c.key === 'design' ? (
                <select
                  className="ftg-select"
                  value={String(opts[c.key])}
                  onChange={(e) => set({ [c.key]: e.target.value } as Partial<TemplateOptions>)}
                >
                  {(c.options || []).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select>
              ) : (
                <div className="ftg-seg">
                  {(c.options || []).map((x) => (
                    <button
                      type="button"
                      key={x.value}
                      className={`ftg-seg-btn${String(opts[c.key]) === x.value ? ' on' : ''}`}
                      onClick={() => set({ [c.key]: x.value } as Partial<TemplateOptions>)}
                      data-value={x.value}
                    >
                      {x.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="ftg-choice" data-testid="ftg-extras">
            <div className="ftg-choice-label">
              Extra menu items <span className="ftg-muted">({opts.extras.length}/{MAX_EXTRAS})</span>
            </div>
            <div className="ftg-chips">
              {extras.map((x) => {
                const on = opts.extras.includes(x.id);
                const full = !on && opts.extras.length >= MAX_EXTRAS;
                const link = isLinkKind(x.id) ? x.id : null;
                const missing = !!link && on && !!linkProblem(link, opts.links[link]);
                return (
                  <button
                    type="button"
                    key={x.id}
                    className={`ftg-chip${on ? ' on' : ''}${missing ? ' missing' : ''}`}
                    onClick={() => toggleExtra(x.id)}
                    disabled={full}
                    data-extra={x.id}
                    title={link ? (on ? `Edit ${LINK_INFO[link].title}` : `Add ${LINK_INFO[link].title}: asks for your details`) : undefined}
                  >
                    <span className="material-icons">{on ? (missing ? 'error_outline' : 'check') : x.icon}</span>
                    {x.label}
                    {link && on && <span className="material-icons ftg-chip-edit">edit</span>}
                  </button>
                );
              })}
            </div>
            <div className="ftg-hint">
              {opts.extras.length
                ? 'The flow opens on a menu with these next to the main journey.'
                : 'With no extras, the flow goes straight into the journey.'}
            </div>
          </div>
        </div>

        <div className="ftg-preview">
          <div className="ftg-preview-head">What the customer does</div>
          <ol className="ftg-steps" data-testid="ftg-steps">
            {built.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          <div className="ftg-preview-head">Set up first</div>
          <ul className="ftg-needs" data-testid="ftg-needs">
            {built.needs.map((s) => {
              const link = linkOfNeed(s);
              return (
                <li key={s}>
                  <span className="material-icons">check_box_outline_blank</span>
                  {link ? (
                    <button type="button" className="ftg-need-btn" onClick={() => setEditingLink(link)} data-need={link}>{s}</button>
                  ) : s}
                </li>
              );
            })}
          </ul>
          <div className="ftg-stats" data-testid="ftg-stats">{stats}, wired on the Map</div>
          {problems.length > 0 && (
            <div className="pa-error" data-testid="ftg-problems">This combination can’t be built: {problems[0]}</div>
          )}
          {error && <div className="pa-error">{error}</div>}
          <button type="button" className="k-btn ftg-create" onClick={create} disabled={busy || problems.length > 0} data-testid="ftg-create">
            <span className="material-icons">auto_awesome</span>
            {busy ? 'Creating…' : 'Create flow'}
          </button>
          <div className="ftg-hint">It’s saved as a draft you can change, then publish.</div>
        </div>
      </div>
      {editingLink && (
        <LinkDetailsModal
          kind={editingLink}
          initial={{ ...LINK_INFO[editingLink].defaults, ...(opts.links[editingLink] || {}) }}
          inMenu={opts.extras.includes(editingLink)}
          onSave={(det) => saveLink(editingLink, det)}
          onRemove={() => removeLink(editingLink)}
          onClose={() => setEditingLink(null)}
        />
      )}
    </div>
  );
}
