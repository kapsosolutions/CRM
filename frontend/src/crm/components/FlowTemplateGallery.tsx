// Templates → Ready-made: the business type's cards, then the chosen card's
// choices with a live list of what the customer goes through and what the
// business needs to set up. "Create flow" saves the generated flow as a new
// draft (flowTemplates.ts builds it).
import { useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type { WaFlowDef } from '../types';
import type { VerticalConfig } from '../verticals';
import {
  buildTemplate, checkTemplateFlow, choicesFor, extrasFor, MAX_EXTRAS, optionsFor, templateCardsFor,
  type ChoiceDef, type TemplateCard, type TemplateOptions,
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
  function toggleExtra(id: string) {
    setOpts((o) => {
      if (!o) return o;
      if (o.extras.includes(id)) return { ...o, extras: o.extras.filter((x) => x !== id) };
      if (o.extras.length >= MAX_EXTRAS) return o;
      // Keep the menu in the order the list shows.
      const order = extras.map((x) => x.id);
      return { ...o, extras: [...o.extras, id].sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
    });
  }

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
                return (
                  <button
                    type="button"
                    key={x.id}
                    className={`ftg-chip${on ? ' on' : ''}`}
                    onClick={() => toggleExtra(x.id)}
                    disabled={full}
                    data-extra={x.id}
                  >
                    <span className="material-icons">{on ? 'check' : x.icon}</span>
                    {x.label}
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
            {built.needs.map((s) => (
              <li key={s}><span className="material-icons">check_box_outline_blank</span>{s}</li>
            ))}
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
    </div>
  );
}
