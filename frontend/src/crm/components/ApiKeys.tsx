// The business's API keys for the public API (/api/v1), shared by every
// "API" dialog (Templates, Catalog, Categories, Members, Offers):
//   secret       kp_live_…  for its server: every endpoint
//   publishable  kp_pub_…   for its website's own pages: read-only data, only
//                           from the website addresses listed on the key
// Plus the copyable code block those dialogs use.
import { useEffect, useState } from 'react';
import type { CrmApi } from '../api';
import type { ApiKeyInfo, ApiKeyType } from '../types';
import { CopyIcon } from './AppIcons';
import { useConfirm, useNotify } from './Dialogs';

export const API_DOCS_URL = 'https://kapsosolutions.com/docs';

export const whenText = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';

/** A code block with a copy button. */
export function ApiCode({ text, testId }: { text: string; testId?: string }) {
  const notify = useNotify();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      notify('success', 'Copied', '');
    } catch {
      notify('error', 'Could not copy', 'Select the text and copy it.');
    }
  };
  return (
    <div className="tad-code">
      <pre data-testid={testId}><code>{text}</code></pre>
      <button type="button" className="tad-copy" onClick={copy} aria-label="Copy">
        <CopyIcon />
      </button>
    </div>
  );
}

const TYPE_TEXT: Record<ApiKeyType, { label: string; hint: string }> = {
  secret: { label: 'Secret key', hint: 'For your server. Every endpoint. Never put it in a web page or app.' },
  publishable: { label: 'Website key', hint: 'For your website’s pages. Read-only, and only works on the websites you list.' },
};

/**
 * Create, list and revoke keys. `onFresh` gets the new key (with its value,
 * shown once) so the dialog can put it into its code samples.
 */
export function ApiKeysSection({
  api, heading = 'Your API keys', defaultType = 'secret', onFresh,
}: {
  api: CrmApi;
  heading?: string;
  defaultType?: ApiKeyType;
  onFresh?: (k: ApiKeyInfo | null) => void;
}) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [type, setType] = useState<ApiKeyType>(defaultType);
  const [name, setName] = useState('');
  const [origins, setOrigins] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<ApiKeyInfo | null>(null);

  useEffect(() => {
    api.listApiKeys().then((r) => setKeys(r.data || [])).catch(() => setKeys([]));
  }, [api]);

  async function create() {
    const list = origins.split(/[\s,]+/).map((o) => o.trim()).filter(Boolean);
    if (type === 'publishable' && !list.length) {
      notify('error', 'Add your website', 'Enter the website address(es) this key will be used on, e.g. https://www.example.com');
      return;
    }
    setBusy(true);
    try {
      const r = await api.createApiKey({ name: name.trim() || (type === 'publishable' ? 'Website key' : 'API key'), type, allowedOrigins: list });
      setFresh(r.data);
      onFresh?.(r.data);
      setName('');
      setOrigins('');
      const { key: _secret, ...row } = r.data;
      setKeys((l) => [row, ...(l || [])]);
    } catch (e) {
      notify('error', 'Couldn’t create the key', (e as Error).message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k: ApiKeyInfo) {
    const ok = await confirm({
      title: `Revoke “${k.name}”?`,
      message: 'Apps and websites using this key stop working at once. This can’t be undone; you can make a new key any time.',
      confirmLabel: 'Revoke',
    });
    if (!ok) return;
    try {
      await api.revokeApiKey(k.id);
      setKeys((l) => (l || []).filter((x) => x.id !== k.id));
      if (fresh?.id === k.id) {
        setFresh(null);
        onFresh?.(null);
      }
      notify('success', 'Key revoked', '');
    } catch (e) {
      notify('error', 'Couldn’t revoke the key', (e as Error).message || 'Please try again.');
    }
  }

  // Changing a website key's websites, inline on its row.
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  async function saveOrigins() {
    if (!editing) return;
    try {
      const r = await api.updateApiKey(editing.id, { allowedOrigins: editing.value.split(/[\s,]+/).filter(Boolean) });
      setKeys((l) => (l || []).map((x) => (x.id === editing.id ? { ...x, ...r.data } : x)));
      setEditing(null);
      notify('success', 'Websites updated', '');
    } catch (e) {
      notify('error', 'Couldn’t update the key', (e as Error).message || 'Please try again.');
    }
  }

  return (
    <section className="tad-sec" data-testid="api-keys-section">
      <h4>{heading}</h4>
      {fresh?.key && (
        <div className="tad-fresh" data-testid="tad-fresh-key">
          <div className="tad-fresh-head">
            <span className="material-icons" aria-hidden="true">key</span>
            <strong>Copy your new {fresh.type === 'publishable' ? 'website' : 'secret'} key now.</strong> You won’t see it again.
          </div>
          <ApiCode text={fresh.key} testId="tad-secret" />
          <p className="tad-hint">
            {fresh.type === 'publishable'
              ? 'Safe in your website’s code: it can only read, and only on the websites you listed.'
              : 'Keep it on your server (an environment variable), never in a website’s or app’s code.'}
          </p>
        </div>
      )}
      <div className="tad-types" role="radiogroup" aria-label="Key type">
        {(['secret', 'publishable'] as ApiKeyType[]).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            className={`tad-type${type === t ? ' on' : ''}`}
            onClick={() => setType(t)}
            data-testid={`tad-type-${t}`}
          >
            <span className="material-icons" aria-hidden="true">{t === 'secret' ? 'dns' : 'language'}</span>
            <span>
              <strong>{TYPE_TEXT[t].label}</strong>
              <small>{TYPE_TEXT[t].hint}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="tad-new">
        <input
          className="k-input"
          placeholder={type === 'publishable' ? 'Key name, e.g. Main website' : 'Key name, e.g. Booking server'}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && create()}
          aria-label="Key name"
          data-testid="tad-key-name"
        />
        <button type="button" className="k-btn tad-create" onClick={create} disabled={busy} data-testid="tad-create-key">
          <span className="material-icons" aria-hidden="true">add</span>
          {busy ? 'Creating…' : 'Create key'}
        </button>
      </div>
      {type === 'publishable' && (
        <input
          className="k-input tad-origins"
          placeholder="Your website(s), e.g. https://www.example.com, https://*.example.com"
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
          aria-label="Websites"
          data-testid="tad-origins"
        />
      )}
      {keys === null ? (
        <p className="tad-hint">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="tad-hint" data-testid="tad-no-keys">No keys yet. Create one to start.</p>
      ) : (
        <ul className="tad-keys" data-testid="tad-keys">
          {keys.map((k) => (
            <li key={k.id} className="tad-key">
              <div className="tad-key-main">
                <span className="tad-key-name">{k.name}</span>
                <span className={`tad-key-type ${k.type === 'publishable' ? 'pub' : 'sec'}`}>{k.type === 'publishable' ? 'Website' : 'Secret'}</span>
                <code className="tad-key-mask">{k.prefix}…{k.lastFour}</code>
              </div>
              <span className="tad-key-meta">
                Created {whenText(k.createdAt)} · last used {whenText(k.lastUsedAt)}
                {k.type === 'publishable' && editing?.id !== k.id && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="tad-link"
                      onClick={() => setEditing({ id: k.id, value: (k.allowedOrigins || []).join(', ') })}
                      title="Change the websites"
                      data-testid="tad-edit-origins"
                    >
                      {(k.allowedOrigins || []).join(', ') || 'no websites'}
                    </button>
                  </>
                )}
              </span>
              {editing?.id === k.id && (
                <div className="tad-origin-edit">
                  <input
                    className="k-input"
                    value={editing.value}
                    onChange={(e) => setEditing({ id: k.id, value: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && saveOrigins()}
                    aria-label="Websites"
                    autoFocus
                  />
                  <button type="button" className="k-btn sm" onClick={saveOrigins}>Save</button>
                  <button type="button" className="k-btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              )}
              <button type="button" className="tad-revoke" onClick={() => revoke(k)} data-testid="tad-revoke">Revoke</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
