// "What do you want to do on WhatsApp?": asked once after sign-up, and again
// from the profile menu (Pages in my menu). The ticks decide which pages the
// sidebar shows (menuChoices.ts).
import { useMemo, useState } from 'react';
import type { VerticalConfig } from '../verticals';
import { menuChoicesFor, type MenuChoice } from '../menuChoices';
import './MenuSetup.css';

interface Props {
  vertical: VerticalConfig;
  /** What's ticked when it opens. */
  initial: string[];
  /**
   * 'new': just signed up (Skip keeps the recommended set).
   * 'existing': had every page before this question (Skip keeps them all).
   * 'edit': opened from the profile menu (Cancel changes nothing).
   */
  mode: 'new' | 'existing' | 'edit';
  /** null = every page. */
  onSave: (picks: string[] | null) => Promise<void>;
  onClose?: () => void;
}

function Choice({ c, on, toggle }: { c: MenuChoice; on: boolean; toggle: () => void }) {
  return (
    <button type="button" className={`ms-choice${on ? ' on' : ''}`} onClick={toggle} aria-pressed={on} data-testid="ms-choice" data-id={c.id}>
      <span className="material-icons ms-choice-ic" aria-hidden="true">{c.icon}</span>
      <span className="ms-choice-text">
        <span className="ms-choice-label">{c.label}</span>
        <span className="ms-choice-hint">{c.hint}</span>
      </span>
      {c.recommended && <span className="ms-rec">Recommended</span>}
      <span className="material-icons ms-tick" aria-hidden="true">{on ? 'check_box' : 'check_box_outline_blank'}</span>
    </button>
  );
}

export function MenuSetup({ vertical, initial, mode, onSave, onClose }: Props) {
  const choices = useMemo(() => menuChoicesFor(vertical), [vertical]);
  const [picks, setPicks] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const main = choices.filter((c) => !c.id.startsWith('form:'));
  const forms = choices.filter((c) => c.id.startsWith('form:'));
  const toggle = (id: string) => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const recommended = choices.filter((c) => c.recommended).map((c) => c.id);

  async function save(next: string[] | null) {
    setBusy(true);
    setError('');
    try {
      await onSave(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please try again.');
      setBusy(false);
    }
  }

  const biz = vertical.key === 'other' ? 'business' : vertical.label;
  return (
    <div className="ms-backdrop" role="dialog" aria-modal="true" aria-labelledby="ms-title" data-testid="menu-setup" data-mode={mode}>
      <div className="ms-box">
        <header className="ms-head">
          <span className="material-icons ms-head-ic" aria-hidden="true">tune</span>
          <div>
            <h2 id="ms-title">What do you want to do on WhatsApp?</h2>
            <p>
              Tick what your {biz} needs and we’ll show only those pages. You can change it any time from your
              profile menu → <b>Pages in my menu</b>.
            </p>
          </div>
          {mode === 'edit' && onClose && (
            <button type="button" className="ms-x" onClick={onClose} aria-label="Close" disabled={busy}>
              <span className="material-icons">close</span>
            </button>
          )}
        </header>

        <div className="ms-body">
          {main.length > 0 && (
            <section>
              <h3>Main</h3>
              <div className="ms-grid">{main.map((c) => <Choice key={c.id} c={c} on={picks.includes(c.id)} toggle={() => toggle(c.id)} />)}</div>
            </section>
          )}
          {forms.length > 0 && (
            <section>
              <h3>WhatsApp forms <span>each one gets a page for its answers</span></h3>
              <div className="ms-grid">{forms.map((c) => <Choice key={c.id} c={c} on={picks.includes(c.id)} toggle={() => toggle(c.id)} />)}</div>
            </section>
          )}
          <p className="ms-always">
            <span className="material-icons" aria-hidden="true">check_circle</span>
            Always there: Chats, Templates, Campaigns and Automation. A page that gets something from a customer shows
            up on its own, even if you didn’t tick it.
          </p>
          {error && <div className="pa-error">{error}</div>}
        </div>

        <footer className="ms-foot">
          {mode === 'edit' ? (
            <>
              <button type="button" className="k-btn ghost sm" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="k-btn ghost sm" onClick={() => save(null)} disabled={busy} data-testid="ms-all">Show every page</button>
            </>
          ) : (
            <button
              type="button"
              className="k-btn ghost sm"
              onClick={() => save(mode === 'new' ? recommended : null)}
              disabled={busy}
              data-testid="ms-skip"
            >
              {mode === 'new' ? 'Skip, use the recommended' : 'Skip, keep all pages'}
            </button>
          )}
          <button type="button" className="k-btn sm" onClick={() => save(picks)} disabled={busy} data-testid="ms-save">
            {busy ? 'Saving…' : mode === 'edit' ? 'Save' : `Continue${picks.length ? ` (${picks.length})` : ''}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
