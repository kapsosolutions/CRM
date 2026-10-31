// Catalog → Get started, after Meta's login popup: "Choose your catalog".
// Same dialog look and keyboard behaviour as the Ads page's ad-account picker
// (Ads.css .ads-dialog-*): Esc / Back / backdrop close, Tab stays inside.
import { useEffect, useId, useRef, useState } from 'react';
import type { MetaCatalogLogin, MetaCatalogOption } from '../types';
import { useBackHandler } from '../useBackHandler';
import './Ads.css';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

function firstPick(login: MetaCatalogLogin): string {
  const list = login.catalogs;
  if (login.currentId && list.some((c) => c.id === login.currentId)) return login.currentId;
  const onWa = list.filter((c) => c.onWhatsApp);
  if (onWa.length === 1) return onWa[0].id;
  return list.length === 1 ? list[0].id : '';
}

const countText = (c: MetaCatalogOption) =>
  c.productCount == null ? '' : `${c.productCount} product${c.productCount === 1 ? '' : 's'}`;

export function CatalogPicker({
  login, busy, error, onClearError, onCancel, onRetry, onConnect, onManual, onLinkedInManager,
}: {
  login: MetaCatalogLogin;
  busy: boolean;
  /** The last connect error (ASSET_IN_USE, LINK_FAILED, SESSION_EXPIRED, …). */
  error: { code: string; text: string } | null;
  onClearError: () => void;
  onCancel: () => void;
  /** Reruns Meta's popup; called straight from the click. */
  onRetry: () => void;
  onConnect: (catalogId: string) => void;
  /** Type a catalog id instead (when Meta shared none). */
  onManual: () => void;
  /** "I've connected it": re-read the WhatsApp account, connect what's on it. */
  onLinkedInManager: () => void;
}) {
  const titleId = useId();
  const descId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState(() => firstPick(login));
  const empty = login.catalogs.length === 0;
  const expired = error?.code === 'SESSION_EXPIRED';
  // A catalog WhatsApp refused as not E-commerce: the business makes a new one
  // in Commerce Manager, then runs Meta's window again to share it.
  const notEcommerce = error?.code === 'NOT_ECOMMERCE';
  // Meta wouldn't let the CRM link the catalog: hand over to WhatsApp Manager
  // (Choose a Catalogue → Connect), then come back and check.
  const managerUrl = login.whatsappManagerUrl || '';
  const handOff = !!managerUrl && !!error && ['NOT_ECOMMERCE', 'LINK_FAILED', 'NOT_LINKED_YET'].includes(error.code);
  const [openedManager, setOpenedManager] = useState(false);
  const showRetry = (empty || expired || notEcommerce) && !handOff;
  const chosen = login.catalogs.find((c) => c.id === picked) || null;
  const onWa = login.catalogs.find((c) => c.onWhatsApp) || null;
  const replaces = chosen && !chosen.onWhatsApp && onWa ? onWa : null;

  const live = useRef({ busy, onCancel });
  live.current = { busy, onCancel };
  const close = () => {
    if (!live.current.busy) live.current.onCancel();
  };
  // Browser Back closes it, like Esc (same as the CRM's other dialogs).
  useBackHandler(true, close);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    const first =
      box?.querySelector<HTMLElement>('input[name="meta-catalog"]:checked') ||
      box?.querySelector<HTMLElement>('input[name="meta-catalog"]') ||
      box?.querySelector<HTMLElement>('[data-autofocus]') ||
      box?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const els = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const firstEl = els[0];
      const lastEl = els[els.length - 1];
      const inside = boxRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === firstEl || !inside)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && (document.activeElement === lastEl || !inside)) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (prev && document.contains(prev)) prev.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ads-dialog-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={boxRef}
        className="ads-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-testid="catalog-picker"
      >
        <div className="ads-dialog-head">
          <h3 className="ads-dialog-title" id={titleId}>
            Choose your catalog
          </h3>
          <button type="button" className="ads-dialog-close" onClick={close} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="ads-dialog-body">
          {empty ? (
            <div className="ads-dialog-empty" data-testid="catalog-picker-empty">
              <span className="material-icons" aria-hidden="true">storefront</span>
              <strong>No catalogs were shared</strong>
              <p id={descId}>
                Meta didn’t return any catalog for this login. Select your catalog on the catalogs step of Meta’s
                window, or create one in{' '}
                <a href="https://business.facebook.com/commerce/" target="_blank" rel="noopener noreferrer">
                  Commerce Manager
                </a>{' '}
                first. If Meta’s window had no catalogs step, connecting a catalog here isn’t open to your account yet:
                it needs a role on the Kapso Meta app (admin, developer or tester) until Meta approves catalog access.
              </p>
              <button type="button" className="crm-cat-manual-link" onClick={onManual} disabled={busy} data-testid="catalog-picker-manual">
                Enter a catalog ID instead
              </button>
            </div>
          ) : (
            <>
              <p className="ads-dialog-intro" id={descId}>
                The CRM connects this catalog to your WhatsApp Business Account and syncs your products into it.
              </p>
              <div className="ads-picker-list" role="radiogroup" aria-labelledby={titleId}>
                {login.catalogs.map((c) => (
                  <label
                    key={c.id}
                    className={`ads-picker-item${c.id === picked ? ' selected' : ''}`}
                    data-testid="catalog-picker-item"
                  >
                    <input
                      type="radio"
                      name="meta-catalog"
                      value={c.id}
                      checked={c.id === picked}
                      onChange={() => {
                        setPicked(c.id);
                        onClearError();
                      }}
                      disabled={busy}
                    />
                    <span>
                      <strong>{c.name}</strong>
                      <small>{[c.id, countText(c), c.businessName].filter(Boolean).join(' · ')}</small>
                    </span>
                    {c.id === login.currentId ? (
                      <span className="ads-pill green">In use</span>
                    ) : c.onWhatsApp ? (
                      <span className="ads-pill green">On WhatsApp</span>
                    ) : null}
                  </label>
                ))}
              </div>
              {replaces && (
                <p className="ads-note" data-testid="catalog-picker-replaces">
                  A WhatsApp Business Account has one catalog. Connecting {chosen?.name} replaces {replaces.name} on it.
                </p>
              )}
              {!login.canManage && (
                <p className="ads-note" data-testid="catalog-picker-nomanage">
                  Meta didn’t grant managing catalogs (catalog_management) in this login, so the product sync uses your
                  WhatsApp connection instead.
                </p>
              )}
            </>
          )}
          {handOff && (
            <div className="cat-handoff" role="status" data-testid="catalog-picker-handoff">
              <strong>Connect it in WhatsApp Manager</strong>
              <ol>
                <li>Click <b>Open WhatsApp Manager</b>. It opens your WhatsApp account’s Catalogue page in a new tab.</li>
                <li>Click <b>Choose a Catalogue</b>, pick {chosen?.name || 'your catalog'} and click <b>Connect</b>.</li>
                <li>Come back to this tab and click <b>I’ve connected it</b>.</li>
              </ol>
              {error?.code === 'NOT_LINKED_YET' && (
                <p className="cat-handoff-warn" data-testid="catalog-picker-not-linked">
                  Your WhatsApp account doesn’t have a catalog connected yet. Finish the step in WhatsApp Manager, then click again.
                </p>
              )}
              {notEcommerce && (
                <p className="cat-handoff-hint">
                  WhatsApp only works with E-commerce catalogs. If WhatsApp Manager doesn’t list yours,{' '}
                  <a href="https://business.facebook.com/commerce/" target="_blank" rel="noopener noreferrer">
                    create an E-commerce catalog in Commerce Manager
                  </a>
                  .
                </p>
              )}
              {openedManager && (
                <a className="cat-handoff-again" href={managerUrl} target="_blank" rel="noopener noreferrer">
                  Open WhatsApp Manager again
                </a>
              )}
            </div>
          )}
          {error && !handOff && (
            <div className="ads-dialog-error" role="alert" data-testid="catalog-picker-error">
              <span className="material-icons" aria-hidden="true">error_outline</span>
              <span>
                {error.text}
                {notEcommerce && (
                  <>
                    {' '}
                    <a href="https://business.facebook.com/commerce/" target="_blank" rel="noopener noreferrer">
                      Open Commerce Manager
                    </a>
                  </>
                )}
              </span>
            </div>
          )}
        </div>

        <div className="ads-dialog-foot">
          <button type="button" className="ads-dialog-btn cancel" onClick={close} disabled={busy} data-testid="catalog-picker-cancel">
            Cancel
          </button>
          {handOff ? (
            openedManager ? (
              <button
                type="button"
                className="ads-dialog-btn primary"
                onClick={onLinkedInManager}
                disabled={busy}
                data-testid="catalog-picker-linked"
              >
                {busy ? 'Checking…' : 'I’ve connected it'}
              </button>
            ) : (
              <a
                className="ads-dialog-btn primary cat-handoff-open"
                href={managerUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpenedManager(true)}
                data-autofocus
                data-testid="catalog-picker-open-manager"
              >
                Open WhatsApp Manager
                <span className="material-icons" aria-hidden="true">open_in_new</span>
              </a>
            )
          ) : showRetry ? (
            <button
              type="button"
              className="ads-dialog-btn primary"
              onClick={onRetry}
              disabled={busy}
              data-autofocus
              data-testid="catalog-picker-retry"
            >
              {expired ? 'Connect again' : 'Try again'}
            </button>
          ) : (
            <button
              type="button"
              className="ads-dialog-btn primary"
              disabled={busy || !picked}
              onClick={() => onConnect(picked)}
              data-testid="catalog-picker-connect"
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
