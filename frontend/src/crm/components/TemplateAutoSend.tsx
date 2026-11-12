// Auto-send settings for a template: the keyword a customer can send, order
// statuses that fire it when an order moves, and named events the CRM raises
// (a doctor marked unavailable). Any one alone is enough.
//
// Shared by the template composer (chosen while creating) and the template
// view page (changed any time). Triggers only ever fire APPROVED templates.
import { useState } from 'react';
import type { TriggerEvent } from '../types';
import { presetById } from '../flowForms';

export interface TriggerDraft {
  enabled: boolean;
  keywords: string[];
  statuses: string[];
  events: string[];
  /** Form answers that fire it: '<form id>:<status>', e.g. 'pre_arrival:confirmed'. */
  formStatuses: string[];
}

export const EMPTY_TRIGGER: TriggerDraft = { enabled: false, keywords: [], statuses: [], events: [], formStatuses: [] };

/** A form answer's statuses a template can fire on (New is the submission itself). */
export const FORM_STATUS_LABEL: Record<string, string> = { contacted: 'Contacted', confirmed: 'Confirmed', done: 'Done', cancelled: 'Cancelled' };

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
  t.keywords.length > 0 || t.statuses.length > 0 || t.events.length > 0 || (t.formStatuses?.length ?? 0) > 0;

interface Props {
  value: TriggerDraft;
  onChange: (next: TriggerDraft) => void;
  statuses: string[];
  events: TriggerEvent[];
  /** The business's own word for each status ("Completed" for a clinic). */
  statusLabels?: Record<string, string>;
  /** What one record is called: "order", "appointment", "enquiry"… */
  recordWord?: string;
  /** The business's forms, each with its own statuses (Pre-arrival check-in, Airport transfer…). */
  forms?: { id: string; label: string; icon?: string }[];
}

export function AutoSendFields({ value, onChange, statuses, events, statusLabels, recordWord = 'order', forms = [] }: Props) {
  const nameOf = (s: string) => statusLabels?.[s] || ORDER_STATUS_LABEL[s] || s;
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
          <span className="k-label sm">Or when {/^[aeiou]/i.test(recordWord) ? 'an' : 'a'} {recordWord} becomes</span>
          <div className="tpl-st-list">
            {statuses.map((s) => (
              <button
                type="button"
                key={s}
                aria-pressed={value.statuses.includes(s)}
                className={`tpl-st${value.statuses.includes(s) ? ' on' : ''}`}
                onClick={() => set({ statuses: toggle(value.statuses, s) })}
              >
                {nameOf(s)}
              </button>
            ))}
          </div>
          <p className="k-hint">Sent to the customer whose {recordWord} it is, on the change only.</p>
        </div>
      )}

      {forms.length > 0 && (
        <div className="tpl-auto-sec" data-testid="as-forms">
          <span className="k-label sm">Or when a form answer becomes</span>
          <div className="as-form-rows">
            {forms.map((f) => (
              <div className="as-form-row" key={f.id} data-form={f.id}>
                <span className="as-form-name">
                  {f.icon && <span className="material-icons" aria-hidden="true">{f.icon}</span>}
                  {f.label}
                </span>
                <div className="tpl-st-list">
                  {Object.entries(FORM_STATUS_LABEL).map(([st, label]) => {
                    const k = `${f.id}:${st}`;
                    const on = (value.formStatuses || []).includes(k);
                    return (
                      <button
                        type="button"
                        key={k}
                        aria-pressed={on}
                        className={`tpl-st${on ? ' on' : ''}`}
                        onClick={() => set({ formStatuses: toggle(value.formStatuses || [], k) })}
                        data-key={k}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="k-hint">Sent to the customer who filled in that form, when you change its status on the form’s page.</p>
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
export function triggerSummary(t: TriggerDraft, events: TriggerEvent[] = [], statusLabels?: Record<string, string>): string {
  return [
    ...t.keywords,
    ...t.statuses.map((s) => statusLabels?.[s] || ORDER_STATUS_LABEL[s] || s),
    ...t.events.map((e) => events.find((x) => x.key === e)?.label || e),
    ...(t.formStatuses || []).map((k) => {
      const [form, st] = k.split(':');
      return `${presetById(form)?.title || form}: ${FORM_STATUS_LABEL[st] || st}`;
    }),
  ].join(' · ');
}
