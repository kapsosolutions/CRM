// After a flow is published: the Meta templates its later updates need
// ("Appointment confirmed", "Order out for delivery", a form's "confirmed").
// A flow's own replies go out inside the 24-hour chat window and need none;
// these go out later, so Meta has to approve them. Each one comes with its
// auto-send already set and its buttons (open the flow again, reply, call).
import { useState } from 'react';
import type { CrmApi, UpdateTemplateItem, UpdateTemplateResult } from '../api';
import { useBackHandler } from '../useBackHandler';

const BUTTON_ICON: Record<string, string> = { FLOW: 'dynamic_form', QUICK_REPLY: 'reply', PHONE_NUMBER: 'call' };
const STATUS_WORD: Record<string, string> = { APPROVED: 'Approved', PENDING: 'Waiting for Meta', REJECTED: 'Rejected', PAUSED: 'Paused' };

export function UpdateTemplatesModal({
  api,
  flowId,
  flowName,
  items,
  onClose,
  onDone,
}: {
  api: CrmApi;
  flowId: string;
  flowName: string;
  items: UpdateTemplateItem[];
  onClose: () => void;
  /** After a submit: a one-line summary for the flash. */
  onDone: (summary: string) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.filter((i) => !i.exists).map((i) => i.key)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<UpdateTemplateResult[] | null>(null);
  useBackHandler(true, onClose);

  function toggle(key: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }
  function create() {
    setBusy(true);
    setError('');
    api
      .createUpdateTemplates(flowId, [...picked])
      .then((r) => {
        setResults(r.data);
        const made = r.data.filter((x) => x.ok && !x.skipped).length;
        const failed = r.data.filter((x) => !x.ok).length;
        onDone(
          made
            ? `${made} template${made === 1 ? '' : 's'} sent to Meta for approval.${failed ? ` ${failed} not created.` : ''}`
            : failed ? 'Meta didn’t accept the templates. See why in the list.' : 'Those templates are already there.',
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not create the templates.'))
      .finally(() => setBusy(false));
  }
  const byKey = new Map((results || []).map((r) => [r.key, r]));
  const shown = results ? items.filter((i) => byKey.has(i.key)) : items;

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal-box ut-box" onClick={(e) => e.stopPropagation()} data-testid="ut-modal">
        <div className="modal-head">
          <h3>Templates for updates · {flowName}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            <span className="material-icons">close</span>
          </button>
        </div>
        <div className="modal-body ut-body">
          {!results && (
            <p className="k-hint" style={{ marginTop: 0 }}>
              Replies inside the flow need no template. These updates reach customers later, after the 24-hour chat
              window, so Meta has to approve them first (usually within minutes). Each one sends itself at the moment
              shown. They are Utility templates in English.
            </p>
          )}
          {error && <p className="err">{error}</p>}
          <ul className="ut-list">
            {shown.map((it) => {
              const r = byKey.get(it.key);
              return (
                <li key={it.key} className={`ut-item${it.exists && !r ? ' have' : ''}`} data-testid={`ut-${it.key}`}>
                  <label className="ut-row">
                    {!results && (
                      <input
                        type="checkbox"
                        checked={picked.has(it.key)}
                        disabled={it.exists || busy}
                        onChange={() => toggle(it.key)}
                      />
                    )}
                    <span className="ut-text">
                      <span className="ut-title">{it.title}</span>
                      <span className="ut-why">
                        <span className="material-icons">bolt</span> {it.why}
                      </span>
                    </span>
                    {it.exists && !r && (
                      <span className="ut-tag">Already added · {STATUS_WORD[it.existingStatus || ''] || it.existingStatus}</span>
                    )}
                    {r && (
                      <span className={`ut-tag ${r.ok ? (r.skipped ? '' : 'ok') : 'bad'}`} data-testid={`ut-res-${it.key}`}>
                        {!r.ok ? 'Not created' : r.skipped ? 'Already there' : `Sent · ${STATUS_WORD[r.status || 'PENDING'] || r.status}`}
                      </span>
                    )}
                  </label>
                  <div className="ut-bubble">
                    <p>{it.preview}</p>
                    {it.buttons.length > 0 && (
                      <div className="ut-btns">
                        {it.buttons.map((b) => (
                          <span key={b.text} className="ut-btn">
                            <span className="material-icons">{BUTTON_ICON[b.type] || 'touch_app'}</span> {b.text}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {r && !r.ok && r.error && <p className="err ut-err">{r.error}</p>}
                  {r && r.ok && !r.skipped && r.name !== it.name && (
                    <p className="k-hint ut-err">Saved as {r.name}: Meta still holds the name {it.name}.</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="modal-foot">
          {results ? (
            <button className="k-btn" onClick={onClose} data-testid="ut-done">Done</button>
          ) : (
            <>
              <button className="k-btn ghost sm" onClick={onClose} disabled={busy} data-testid="ut-skip">Skip</button>
              <button className="k-btn" onClick={create} disabled={busy || picked.size === 0} data-testid="ut-create">
                <span className="material-icons">send</span>
                {busy ? 'Sending to Meta…' : `Create ${picked.size} template${picked.size === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
