// "Use from your apps": the API keys for the public API (/api/v1) and, for one
// template, a ready-to-copy request in cURL, Node.js and Python. Opened from
// the Templates list (the API column, or "API keys" in the header).
import { CopyIcon } from './AppIcons';
import { useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type { ApiKeyInfo, TemplateItem } from '../types';
import { useConfirm, useNotify } from './Dialogs';
import { useBackHandler } from '../useBackHandler';
import { templateVarCount } from './TemplateDrawer';
import './TemplateApiDialog.css';

type Lang = 'curl' | 'node' | 'python';
const LANGS: { key: Lang; label: string }[] = [
  { key: 'curl', label: 'cURL' },
  { key: 'node', label: 'Node.js' },
  { key: 'python', label: 'Python' },
];
const KEY_PLACEHOLDER = 'YOUR_API_KEY';

const isAuth = (t?: TemplateItem | null) => String(t?.category || '').toUpperCase() === 'AUTHENTICATION';
const headerFormat = (t: TemplateItem) => {
  const h = (t.components || []).find((c) => String(c.type).toUpperCase() === 'HEADER');
  return String(h?.format || '').toLowerCase();
};
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';

/** One request as cURL / Node.js / Python. */
function sample(lang: Lang, url: string, key: string, body: Record<string, unknown>, idempotent: boolean): string {
  const json = JSON.stringify(body, null, 2);
  if (lang === 'curl') {
    return [
      `curl -X POST '${url}' \\`,
      `  -H 'Authorization: Bearer ${key}' \\`,
      `  -H 'Content-Type: application/json' \\`,
      ...(idempotent ? ["  -H 'Idempotency-Key: order-1042' \\"] : []),
      `  -d '${json.replace(/'/g, "'\\''")}'`,
    ].join('\n');
  }
  if (lang === 'node') {
    return [
      `const res = await fetch('${url}', {`,
      "  method: 'POST',",
      '  headers: {',
      `    Authorization: 'Bearer ${key}', // keep the key on your server`,
      "    'Content-Type': 'application/json',",
      ...(idempotent ? ["    'Idempotency-Key': 'order-1042', // safe to retry"] : []),
      '  },',
      `  body: JSON.stringify(${json.replace(/\n/g, '\n  ')}),`,
      '});',
      'const data = await res.json();',
      'if (!res.ok) throw new Error(data.error.message);',
    ].join('\n');
  }
  return [
    'import requests',
    '',
    'res = requests.post(',
    `    "${url}",`,
    `    headers={"Authorization": "Bearer ${key}"${idempotent ? ', "Idempotency-Key": "order-1042"' : ''}},`,
    `    json=${json.replace(/\n/g, '\n    ').replace(/: true/g, ': True').replace(/: false/g, ': False')},`,
    '    timeout=15,',
    ')',
    'res.raise_for_status()',
    'print(res.json())',
  ].join('\n');
}

function Code({ text, testId }: { text: string; testId?: string }) {
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

export function TemplateApiDialog({
  api, template, connected, onClose,
}: {
  api: CrmApi;
  /** null: just the keys. */
  template: TemplateItem | null;
  /** The business has its own WhatsApp number (the API needs it). */
  connected: boolean;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<ApiKeyInfo | null>(null);
  const [lang, setLang] = useState<Lang>('curl');

  useBackHandler(true, onClose);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.app-dialog') && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  useEffect(() => {
    api.listApiKeys().then((r) => setKeys(r.data || [])).catch(() => setKeys([]));
  }, [api]);

  async function create() {
    setBusy(true);
    try {
      const r = await api.createApiKey(name.trim() || 'API key');
      setFresh(r.data);
      setName('');
      const { key: _secret, ...row } = r.data;
      setKeys((list) => [row, ...(list || [])]);
    } catch (e) {
      notify('error', 'Couldn’t create the key', (e as Error).message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k: ApiKeyInfo) {
    const ok = await confirm({
      title: `Revoke “${k.name}”?`,
      message: 'Apps using this key stop working at once. This can’t be undone; you can make a new key any time.',
      confirmLabel: 'Revoke',
    });
    if (!ok) return;
    try {
      await api.revokeApiKey(k.id);
      setKeys((list) => (list || []).filter((x) => x.id !== k.id));
      if (fresh?.id === k.id) setFresh(null);
      notify('success', 'Key revoked', '');
    } catch (e) {
      notify('error', 'Couldn’t revoke the key', (e as Error).message || 'Please try again.');
    }
  }

  const origin = api.apiOrigin();
  const key = fresh?.key || KEY_PLACEHOLDER;
  const approved = String(template?.status || '').toUpperCase() === 'APPROVED';
  const auth = isAuth(template);
  const requests = useMemo(() => {
    if (!template) return [];
    if (auth) {
      return [
        {
          title: '1. Send a one-time code',
          note: 'We make a 6-digit code, send it with this template and remember it (hashed) until it expires. Send your own with "code".',
          url: `${origin}/api/v1/otp/send`,
          body: { to: '+919876543210', template: template.name },
          response: { id: 'wamid.HBgM…', to: '919876543210', template: template.name, status: 'accepted', expiresAt: '2026-11-05T10:15:00.000Z' },
          idempotent: true,
        },
        {
          title: '2. Check the code your user typed',
          note: 'Valid once. Five wrong tries, or the expiry, and they need a new code.',
          url: `${origin}/api/v1/otp/verify`,
          body: { to: '+919876543210', code: '482913' },
          response: { valid: true },
          idempotent: false,
        },
      ];
    }
    const n = templateVarCount(template);
    const hf = headerFormat(template);
    const body: Record<string, unknown> = { to: '+919876543210', template: template.name };
    if (n) body.variables = Array.from({ length: n }, (_, i) => `value ${i + 1}`);
    if (['image', 'video', 'document'].includes(hf)) body.headerMediaUrl = `https://example.com/your-${hf === 'document' ? 'file.pdf' : hf === 'video' ? 'clip.mp4' : 'photo.jpg'}`;
    if (template.kind === 'lto') {
      body.offerCode = 'SAVE20';
      body.offerExpiresAt = '2026-12-31T18:30:00.000Z';
    }
    return [{
      title: 'Send this template',
      note: n
        ? `"variables" fill {{1}}${n > 1 ? `…{{${n}}}` : ''} in order. Leave them out to use the template’s own values (the contact’s name and so on).`
        : 'This template has no variables.',
      url: `${origin}/api/v1/messages/template`,
      body,
      response: { id: 'wamid.HBgM…', to: '919876543210', template: template.name, status: 'accepted' },
      idempotent: true,
    }];
  }, [template, auth, origin]);

  return (
    <div className="tad-backdrop" onClick={onClose}>
      <div className="tad-box" role="dialog" aria-modal="true" aria-label="Use from your apps" onClick={(e) => e.stopPropagation()} data-testid="tpl-api-dialog">
        <header className="tad-head">
          <span className="tad-head-ico" aria-hidden="true">
            <span className="material-icons">code</span>
          </span>
          <div className="tad-head-text">
            <h3>{template ? <>Send <span className="tad-name">{template.name}</span> from your apps</> : 'API keys'}</h3>
            <p>Your website, app or server can send your WhatsApp templates with an API key.</p>
          </div>
          <button type="button" className="tad-close" onClick={onClose} aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </header>

        <div className="tad-body">
          {!connected && (
            <div className="tad-warn" role="note">
              <span className="material-icons" aria-hidden="true">info</span>
              Connect your own WhatsApp number first: the API sends from it.
            </div>
          )}
          {template && !approved && (
            <div className="tad-warn" role="note">
              <span className="material-icons" aria-hidden="true">schedule</span>
              This template can be sent once WhatsApp approves it.
            </div>
          )}

          <section className="tad-sec">
            <h4>{template ? '1. Your API key' : 'Your API keys'}</h4>
            {fresh?.key && (
              <div className="tad-fresh" data-testid="tad-fresh-key">
                <div className="tad-fresh-head">
                  <span className="material-icons" aria-hidden="true">key</span>
                  <strong>Copy your new key now.</strong> You won’t see it again.
                </div>
                <Code text={fresh.key} testId="tad-secret" />
                <p className="tad-hint">Keep it on your server (an environment variable), never in a website’s or app’s code.</p>
              </div>
            )}
            <div className="tad-new">
              <input
                className="k-input"
                placeholder="Key name, e.g. Website or Booking app"
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
                      <code className="tad-key-mask">{k.prefix}…{k.lastFour}</code>
                    </div>
                    <span className="tad-key-meta">
                      Created {when(k.createdAt)} · last used {when(k.lastUsedAt)}
                    </span>
                    <button type="button" className="tad-revoke" onClick={() => revoke(k)} data-testid="tad-revoke">Revoke</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {template && (
            <section className="tad-sec">
              <div className="tad-sec-head">
                <h4>2. Send it</h4>
                <div className="tad-langs" role="tablist" aria-label="Language">
                  {LANGS.map((l) => (
                    <button
                      key={l.key}
                      type="button"
                      role="tab"
                      aria-selected={lang === l.key}
                      className={`tad-lang${lang === l.key ? ' on' : ''}`}
                      onClick={() => setLang(l.key)}
                      data-testid={`tad-lang-${l.key}`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              {requests.map((r) => (
                <div key={r.title} className="tad-req" data-testid="tad-request">
                  <div className="tad-req-title">
                    <span className="tad-method">POST</span>
                    <code>{r.url.replace(origin, '')}</code>
                    <span className="tad-req-label">{r.title}</span>
                  </div>
                  <p className="tad-hint">{r.note}</p>
                  <Code text={sample(lang, r.url, key, r.body, r.idempotent)} testId="tad-sample" />
                  <details className="tad-resp">
                    <summary>Response</summary>
                    <Code text={JSON.stringify(r.response, null, 2)} />
                  </details>
                </div>
              ))}
            </section>
          )}

          <section className="tad-sec tad-ref">
            <h4>{template ? '3. Good to know' : 'Endpoints'}</h4>
            <ul>
              <li><code>GET /api/v1/templates</code> lists your approved templates and what each needs.</li>
              <li><code>POST /api/v1/messages/template</code> sends a template; <code>POST /api/v1/otp/send</code> and <code>/otp/verify</code> handle one-time codes.</li>
              <li><code>GET /api/v1/messages/&#123;id&#125;</code> tells you if it was delivered or read, or why it failed.</li>
              <li>Add an <code>Idempotency-Key</code> header to retry a send safely: the same key within 24 hours won’t send twice.</li>
              <li>Up to 120 requests a minute per key. Errors come back as <code>{'{ "error": { "code", "message" } }'}</code>.</li>
              <li>Messages sent through the API appear in your Chats, and count like any other template.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
