// Auto-send settings for a template: the keyword a customer can send, order
// statuses that fire it when an order moves, and named events the CRM raises
// (a doctor marked unavailable). Any one alone is enough.
//
// Shared by the template composer (chosen while creating) and the template
// view page (changed any time). Triggers only ever fire APPROVED templates.
import { useState } from 'react';
import type { TriggerEvent } from '../types';

export interface TriggerDraft {
  enabled: boolean;
  keywords: string[];
  statuses: string[];
  events: string[];
}

export const EMPTY_TRIGGER: TriggerDraft = { enabled: false, keywords: [], statuses: [], events: [] };

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** Is there anything for the trigger to match on? */
export const triggerHasRules = (t: TriggerDraft) =>
  t.keywords.length > 0 || t.statuses.length > 0 || t.events.length > 0;

interface Props {
  value: TriggerDraft;
  onChange: (next: TriggerDraft) => void;
  statuses: string[];
  events: TriggerEvent[];
}

export function AutoSendFields({ value, onChange, statuses, events }: Props) {
  const [draft, setDraft] = useState('');
  const set = (patch: Partial<TriggerDraft>) => onChange({ ...value, ...patch });

  function addKeyword() {
    const k = draft.trim();
    if (!k) return;
    // Matched case-insensitively on the server, so store one casing only.
    if (!value.keywords.some((x) => x.toLowerCase() === k.toLowerCase())) set({ keywords: [...value.keywords, k] });
    setDraft('');
  }
  const toggle = (list: string[], item: string) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  return (
    <div className="as-fields">
      <div className="tpl-auto-sec">
        <label className="k-label sm" htmlFor="as-keyword">When someone sends</label>
        <div className="tpl-kw-row">
          <input
            id="as-keyword"
            className="k-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addKeyword();
              }
            }}
            placeholder="e.g. price"
          />
          <button type="button" className="k-btn ghost sm" onClick={addKeyword} disabled={!draft.trim()}>
            Add
          </button>
        </div>
        {value.keywords.length > 0 && (
          <div className="tpl-kw-list">
            {value.keywords.map((k) => (
              <span className="tpl-kw" key={k}>
                {k}
                <button
                  type="button"
                  onClick={() => set({ keywords: value.keywords.filter((x) => x !== k) })}
                  aria-label={`Remove keyword ${k}`}
                >
                  <span className="material-icons">close</span>
                </button>
              </span>
            ))}
          </div>
        )}
        <p className="k-hint">
          Matched on the whole message, ignoring case. “price” fires on <em>price</em> but not on “what is the price”.
        </p>
      </div>

      {statuses.length > 0 && (
        <div className="tpl-auto-sec">
          <span className="k-label sm">Or when an order becomes</span>
          <div className="tpl-st-list">
            {statuses.map((s) => (
              <button
                type="button"
                key={s}
                aria-pressed={value.statuses.includes(s)}
                className={`tpl-st${value.statuses.includes(s) ? ' on' : ''}`}
                onClick={() => set({ statuses: toggle(value.statuses, s) })}
              >
                {ORDER_STATUS_LABEL[s] || s}
              </button>
            ))}
          </div>
          <p className="k-hint">Sent to the customer who placed that order, on the change only.</p>
        </div>
      )}

      {events.length > 0 && (
        <div className="tpl-auto-sec">
          <span className="k-label sm">Or when this happens</span>
          <div className="tpl-st-list">
            {events.map((e) => (
              <button
                type="button"
                key={e.key}
                aria-pressed={value.events.includes(e.key)}
                className={`tpl-st${value.events.includes(e.key) ? ' on' : ''}`}
                onClick={() => set({ events: toggle(value.events, e.key) })}
                title={e.hint || ''}
              >
                {e.label}
              </button>
            ))}
          </div>
          <p className="k-hint">
            {events.find((e) => value.events.includes(e.key))?.hint || 'Raised by the CRM rather than by the customer.'}
          </p>
        </div>
      )}
    </div>
  );
}

/** One-line summary of what fires a template ("price · Delivered"). */
export function triggerSummary(t: TriggerDraft, events: TriggerEvent[] = []): string {
  return [
    ...t.keywords,
    ...t.statuses.map((s) => ORDER_STATUS_LABEL[s] || s),
    ...t.events.map((e) => events.find((x) => x.key === e)?.label || e),
  ].join(' · ');
}
