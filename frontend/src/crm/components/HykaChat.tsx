// Hyka AI: Automation → Flows → "Build with Hyka AI". A chat that asks the
// business step by step what its WhatsApp flow should do, shows what it will
// build, and on "Continue to publish" saves and publishes it. The business
// never sees screens or the map; a master-password session can open the
// result in the builder. The understanding is ours (hyka/brain.ts).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type { WaFlowDef } from '../types';
import type { VerticalConfig } from '../verticals';
import {
  HYKA_NAME, hykaBuild, hykaReply, hykaStart, type HykaChip, type HykaCtx, type HykaInput, type HykaMsg, type HykaState,
} from '../hyka/brain';
import './HykaChat.css';

/** "Food orders", or "Food orders (2)" when a flow already has that name. */
function freeName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) if (!taken.has(`${base} (${i})`)) return `${base} (${i})`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** How long Hyka "types" before a reply. */
const THINK_MS = 420;
/** The Generating animation shows for at least this long. */
const GENERATE_MS = 2600;

/** **bold** and line breaks; everything else is plain text. */
function rich(text: string): ReactNode {
  return text.split('\n').map((line, i, all) => (
    <Fragment key={i}>
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith('**') && part.endsWith('**') && part.length > 4
        ? <b key={j}>{part.slice(2, -2)}</b>
        : <Fragment key={j}>{part}</Fragment>))}
      {i < all.length - 1 && <br />}
    </Fragment>
  ));
}

export function HykaMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="hyka-mark">
      <defs>
        <linearGradient id="hykaG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#24d06e" />
          <stop offset="0.55" stopColor="#0ea5e9" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="10" fill="url(#hykaG)" />
      <path d="M16 6.5l2.3 6.2 6.2 2.3-6.2 2.3L16 23.5l-2.3-6.2-6.2-2.3 6.2-2.3z" fill="#fff" />
      <circle cx="23.5" cy="23.5" r="2" fill="#fff" opacity="0.85" />
    </svg>
  );
}

/** The "Generating" animation (letters lighting up over a colour sweep). */
function Generating({ status }: { status: string }) {
  return (
    <div className="hyka-gen" data-testid="hyka-generating" role="status" aria-live="polite">
      <div className="hyka-loader-wrapper" aria-hidden="true">
        {'Generating'.split('').map((l, i) => <span className="hyka-loader-letter" key={i}>{l}</span>)}
        <div className="hyka-loader" />
      </div>
      <div className="hyka-gen-status">{status}</div>
    </div>
  );
}

function Summary({ s, onGo }: { s: NonNullable<HykaMsg['summary']>; onGo?: (page: string) => void }) {
  return (
    <div className="hyka-sum" data-testid="hyka-summary">
      <div className="hyka-sum-head">
        <span className="material-icons">{s.icon}</span>
        <div>
          <div className="hyka-sum-name">{s.name}</div>
          <div className="hyka-sum-sub">{s.title} · {s.screens} screen{s.screens === 1 ? '' : 's'}</div>
        </div>
      </div>
      {s.menu.length > 0 && (
        <div className="hyka-sum-block">
          <div className="hyka-sum-label">The menu customers see</div>
          <div className="hyka-sum-menu">{s.menu.map((m) => <span key={m}>{m}</span>)}</div>
        </div>
      )}
      <div className="hyka-sum-block">
        <div className="hyka-sum-label">What happens</div>
        <ol className="hyka-sum-steps">{s.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>
      </div>
      {s.warnings.map((w) => (
        <div className="hyka-sum-warn" key={w.text} data-testid="hyka-warning">
          <span className="material-icons">info</span>
          <span>{w.text}</span>
          {w.page && onGo && (
            <button type="button" className="hyka-link" onClick={() => onGo(w.page as string)}>{w.pageLabel}</button>
          )}
        </div>
      ))}
      {s.needs.length > 0 && (
        <ul className="hyka-sum-needs">{s.needs.map((n) => <li key={n}>{n}</li>)}</ul>
      )}
    </div>
  );
}

interface Props {
  api: CrmApi;
  vertical: VerticalConfig;
  businessName?: string;
  /** Master-password session: may open the result in the builder. */
  staff: boolean;
  existingNames: string[];
  flowsActive: boolean;
  onClose: () => void;
  /** A flow was created or published: refresh the list. */
  onChanged: () => void;
  /** Staff only: open this flow in the builder. */
  onOpenFlow?: (flow: WaFlowDef) => void;
  /** Open another CRM page (Categories, Members, Catalog). */
  onNavigate?: (page: string) => void;
  onFlowsActive?: (on: boolean) => void;
}

/** The loader's font, fetched only when the chat opens. */
function usePoppins() {
  useEffect(() => {
    if (document.getElementById('hyka-poppins')) return;
    const l = document.createElement('link');
    l.id = 'hyka-poppins';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@600&display=swap';
    document.head.appendChild(l);
  }, []);
}

/** How many categories, members and products the business has (null = not known). */
function useCounts(api: CrmApi, v: VerticalConfig): HykaCtx['counts'] {
  const [counts, setCounts] = useState<HykaCtx['counts']>({ categories: null, members: null, products: null });
  useEffect(() => {
    let live = true;
    const count = (key: keyof HykaCtx['counts'], p: Promise<{ data?: unknown[] }>) =>
      p.then((r) => live && setCounts((c) => ({ ...c, [key]: (r.data || []).length }))).catch(() => {});
    if (v.showsPage('categories')) count('categories', api.getCategories());
    if (v.showsPage('members')) count('members', api.getMembers());
    if (v.showsPage('catalog')) count('products', api.getProducts());
    return () => {
      live = false;
    };
  }, [api, v]);
  return counts;
}

export function HykaChat({
  api, vertical, businessName, staff, existingNames, flowsActive, onClose, onChanged, onOpenFlow, onNavigate, onFlowsActive,
}: Props) {
  usePoppins();
  const counts = useCounts(api, vertical);
  const ctx: HykaCtx = useMemo(() => ({ v: vertical, businessName, counts, staff }), [vertical, businessName, counts, staff]);
  const first = useMemo(() => hykaStart({ v: vertical, businessName, counts: { categories: null, members: null, products: null }, staff }), [vertical, businessName, staff]);
  const [state, setState] = useState<HykaState>(first.state);
  const [msgs, setMsgs] = useState<HykaMsg[]>(first.msgs);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState('');
  const [text, setText] = useState('');
  const [picks, setPicks] = useState<string[]>([]);
  const flowRef = useRef<WaFlowDef | null>(null);
  const userSeq = useRef(0);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const live = useRef(true);
  useEffect(() => {
    // Set again on mount: StrictMode unmounts and remounts once in development.
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const last = msgs[msgs.length - 1];
  // A new pick-several question starts from what's already in the menu.
  useEffect(() => {
    if (last?.multi) setPicks(last.multi.options.filter((o) => o.on).map((o) => o.id));
  }, [last]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, typing, busy]);

  const push = useCallback((m: HykaMsg[]) => setMsgs((l) => [...l, ...m]), []);
  const said = (t: string) => {
    userSeq.current += 1;
    push([{ id: `u${userSeq.current}`, from: 'user', text: t }]);
  };
  const bot = (m: Omit<HykaMsg, 'id' | 'from'>) => {
    userSeq.current += 1;
    push([{ id: `b${userSeq.current}`, from: 'bot', ...m }]);
  };

  /** Save the flow as it stands (a new draft, or the one made earlier). */
  async function saveDraft(st: HykaState): Promise<WaFlowDef> {
    const b = hykaBuild(st, ctx);
    if (!b) throw new Error('Tell me what the flow should do first.');
    if (b.problems.length) throw new Error(`The flow isn’t valid yet: ${b.problems.join('; ')}`);
    const made = flowRef.current;
    if (made) {
      const others = new Set(existingNames.filter((n) => n !== made.name));
      const name = b.built.flow.name === made.name ? made.name : freeName(b.built.flow.name, others);
      const r = await api.updateFlowDef(made._id, { ...b.built.flow, name });
      flowRef.current = r.data;
      return r.data;
    }
    const name = freeName(b.built.flow.name, new Set(existingNames));
    const r = await api.createFlowDef({ ...b.built.flow, name });
    flowRef.current = r.data;
    onChanged();
    return r.data;
  }

  async function publish(st: HykaState) {
    setBusy('Building your screens…');
    const t0 = Date.now();
    try {
      const flow = await saveDraft(st);
      if (live.current) setBusy('Publishing to WhatsApp…');
      const res = await api.publishFlowDef(flow._id);
      await sleep(Math.max(0, GENERATE_MS - (Date.now() - t0)));
      if (!live.current) return;
      onChanged();
      if (res.published === false) {
        const issues = (res.warnings?.length ? res.warnings : (res.validationErrors || []).map((e) => e.message || '')).filter(Boolean);
        bot({
          tone: 'error',
          text: `WhatsApp didn’t accept **${flow.name}** yet, so it’s saved as a draft.${res.publishError ? `\n${res.publishError}` : ''}`,
          issues,
          chips: [
            { id: 'act:retry', label: 'Try again', icon: 'refresh', primary: true },
            ...(staff ? [{ id: 'act:builder', label: 'Open in builder', icon: 'account_tree' }] : []),
            { id: 'act:close', label: 'Back to flows', icon: 'arrow_back' },
          ],
        });
        return;
      }
      bot({
        tone: 'ok',
        text: flowsActive
          ? `✅ **${flow.name}** is live on WhatsApp. Customers who message you now get it.`
          : `✅ **${flow.name}** is published on WhatsApp.\nFlows are switched off, so your Journeys still answer chats. Switch Flows on and this flow answers instead.`,
        chips: flowsActive
          ? [{ id: 'act:close', label: 'Done', icon: 'check', primary: true }, { id: 'act:new', label: 'Build another', icon: 'add' }]
          : [{ id: 'act:flows-on', label: 'Switch Flows on', icon: 'bolt', primary: true }, { id: 'act:close', label: 'Not now', icon: 'arrow_back' }],
      });
    } catch (e) {
      await sleep(Math.max(0, 900 - (Date.now() - t0)));
      if (!live.current) return;
      bot({
        tone: 'error',
        text: `I couldn’t publish it: ${e instanceof Error ? e.message : 'something went wrong'}.${flowRef.current ? ' It’s saved as a draft.' : ''}`,
        chips: [{ id: 'act:retry', label: 'Try again', icon: 'refresh', primary: true }, { id: 'act:close', label: 'Back to flows', icon: 'arrow_back' }],
      });
    } finally {
      if (live.current) setBusy('');
    }
  }

  async function action(id: string, label: string) {
    if (id === 'act:publish' || id === 'act:retry') {
      said(label);
      return publish(state);
    }
    if (id === 'act:close') return onClose();
    if (id === 'act:new') {
      flowRef.current = null;
      const fresh = hykaStart(ctx, state.seq, 'Let’s build another one.');
      setState(fresh.state);
      push(fresh.msgs);
      return undefined;
    }
    if (id === 'act:builder') {
      said(label);
      setBusy('Saving the draft…');
      try {
        const flow = await saveDraft(state);
        onOpenFlow?.(flow);
      } catch (e) {
        bot({ tone: 'error', text: e instanceof Error ? e.message : 'Could not save the flow.' });
      } finally {
        if (live.current) setBusy('');
      }
      return undefined;
    }
    if (id === 'act:flows-on') {
      said(label);
      try {
        await api.setFlowsActive(true);
        onFlowsActive?.(true);
        bot({ tone: 'ok', text: 'Flows are on. Your published flow now answers customers who message you.', chips: [{ id: 'act:close', label: 'Done', icon: 'check', primary: true }, { id: 'act:new', label: 'Build another', icon: 'add' }] });
      } catch {
        bot({ tone: 'error', text: 'I couldn’t switch Flows on. Use the “Flows” switch on the list instead.', chips: [{ id: 'act:close', label: 'Back to flows', icon: 'arrow_back' }] });
      }
      return undefined;
    }
    if (id.startsWith('act:goto:')) onNavigate?.(id.slice(9));
    return undefined;
  }

  function send(input: HykaInput, shown: string) {
    if (typing || busy) return;
    said(shown);
    setTyping(true);
    setTimeout(() => {
      if (!live.current) return;
      const r = hykaReply(state, ctx, input);
      setState(r.state);
      setTyping(false);
      push(r.msgs);
      if (r.action === 'publish') publish(r.state);
    }, THINK_MS);
  }

  function chip(c: HykaChip) {
    if (c.id.startsWith('act:')) action(c.id, c.label);
    else send({ chip: c.id }, c.label);
  }
  function submit() {
    const t = text.trim();
    if (!t) return;
    setText('');
    send({ text: t }, t);
    inputRef.current?.focus();
  }
  function finishPicks(m: HykaMsg) {
    const labels = (m.multi?.options || []).filter((o) => picks.includes(o.id)).map((o) => o.label);
    send({ picks }, labels.length ? labels.join(', ') : 'No menu, thanks');
  }

  const idle = !typing && !busy;
  return (
    <div className="hyka" data-testid="hyka-chat">
      <header className="hyka-head">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Back to flows" data-testid="hyka-back">
          <span className="material-icons">arrow_back</span>
        </button>
        <HykaMark size={34} />
        <div className="hyka-head-text">
          <div className="hyka-title">{HYKA_NAME}</div>
          <div className="hyka-sub">Builds and publishes your WhatsApp flow from a chat</div>
        </div>
      </header>

      <div className="hyka-log" aria-live="polite">
        {msgs.map((m) => {
          const current = m === last && idle;
          return (
            <div className={`hyka-row ${m.from}`} key={m.id} data-testid="hyka-msg" data-from={m.from}>
              {m.from === 'bot' && <HykaMark size={26} />}
              <div className="hyka-col">
                <div className={`hyka-bubble ${m.from}${m.tone ? ` ${m.tone}` : ''}`}>
                  {rich(m.text)}
                  {m.issues && m.issues.length > 0 && <ul className="hyka-issues">{m.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                </div>
                {m.summary && <Summary s={m.summary} onGo={onNavigate ? (p) => action(`act:goto:${p}`, '') : undefined} />}
                {current && m.multi && (
                  <div className="hyka-chips multi" data-testid="hyka-multi">
                    {m.multi.options.map((o) => {
                      const on = picks.includes(o.id);
                      const full = !on && picks.length >= (m.multi?.max || 8);
                      return (
                        <button type="button" key={o.id} className={`hyka-chip${on ? ' on' : ''}`} disabled={full}
                          onClick={() => setPicks((p) => (on ? p.filter((x) => x !== o.id) : [...p, o.id]))}
                          data-testid="hyka-chip" data-id={o.id} aria-pressed={on}>
                          <span className="material-icons">{on ? 'check_circle' : o.icon || 'add_circle_outline'}</span>{o.label}
                        </button>
                      );
                    })}
                    <button type="button" className="hyka-chip primary" onClick={() => finishPicks(m)} data-testid="hyka-multi-done">
                      <span className="material-icons">done</span> Done{picks.length ? ` (${picks.length})` : ''}
                    </button>
                  </div>
                )}
                {current && m.chips && m.chips.length > 0 && (
                  <div className="hyka-chips">
                    {m.chips.map((c) => (
                      <button type="button" key={c.id} className={`hyka-chip${c.primary ? ' primary' : ''}`} onClick={() => chip(c)} data-testid="hyka-chip" data-id={c.id}>
                        {c.icon && <span className="material-icons">{c.icon}</span>}{c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {typing && (
          <div className="hyka-row bot" data-testid="hyka-typing">
            <HykaMark size={26} />
            <div className="hyka-bubble bot hyka-dots"><span /><span /><span /></div>
          </div>
        )}
        {busy && <Generating status={busy} />}
        <div ref={endRef} />
      </div>

      <form className="hyka-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={`Message ${HYKA_NAME}…`}
          disabled={!!busy}
          autoFocus
          data-testid="hyka-input"
        />
        <button type="submit" className="hyka-send" disabled={!text.trim() || !idle} aria-label="Send" data-testid="hyka-send">
          <span className="material-icons">send</span>
        </button>
      </form>
    </div>
  );
}
