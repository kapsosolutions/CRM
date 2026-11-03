// Visual flow builder (node-to-node, drag & drop) built on React Flow.
// Rich WhatsApp blocks: media header + body + reply buttons (each button has
// its own output port for branching), CTA URL, Call, Ask location, List menu
// (each row branches), and an approved-Template block.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  MarkerType,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useUpdateNodeInternals,
  ReactFlowProvider,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type OnNodesChange,
  type OnEdgesChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { Dispatch, SetStateAction } from 'react';
import type { CrmApi } from '../api';
import type { BusinessProfile, TemplateItem, Journey } from '../types';
import type { VerticalConfig } from '../verticals';
import { FlowBuilderPage } from './FlowBuilderPage';
import { MediaCtx, useLeaveCleanup, useMedia, useMediaApi } from './uploadCtx';
import { useConfirm, useFlash } from './Dialogs';
import { useBackHandler } from '../useBackHandler';
import { BladeSpinner } from './BladeSpinner';
import { COMING_SOON } from '../features';
import { ComingSoonPanel, SoonPill } from './ComingSoon';
import { FullscreenButton, IN_HANDLE, inSideFor, organizeLayout, useCanvasFullscreen, type LayoutPort } from './canvasTools';

type Kind =
  | 'start'
  | 'message'
  | 'reply'
  | 'cta'
  | 'call'
  | 'location'
  | 'list'
  | 'template'
  | 'quick'
  | 'carousel'
  | 'end'
  | 'restart';

type HeaderType = 'none' | 'image' | 'video' | 'audio' | 'pdf';

/** Which chats a journey answers. */
export type JourneyChannel = 'whatsapp' | 'instagram' | 'messenger';

interface CardButton {
  title: string;
  /** A link opens it; empty = a reply button that branches (its own port). */
  url: string;
}
interface CardData {
  imageUrl: string;
  title: string;
  subtitle: string;
  buttons: CardButton[];
}

interface WaData {
  kind: Kind;
  text?: string;
  header?: HeaderType;
  headerMediaUrl?: string;
  headerFileName?: string;
  buttons?: string[];
  listTitle?: string;
  options?: string[];
  ctaText?: string;
  ctaUrl?: string;
  callText?: string;
  callPhone?: string;
  templateName?: string;
  /** Instagram / Messenger card or carousel. */
  cards?: CardData[];
}

/** The journey's channel, for the blocks (header types, limits, wording). */
const ChannelCtx = createContext<JourneyChannel>('whatsapp');
const CHANNEL_NAME: Record<JourneyChannel, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' };
const CHANNEL_ICON: Record<JourneyChannel, string> = { whatsapp: '/whatsapp.svg', instagram: '/channel-instagram.svg', messenger: '/channel-messenger.svg' };
const EDGE_COLOR: Record<JourneyChannel, string> = { whatsapp: '#25d366', instagram: '#e1306c', messenger: '#0084ff' };
// Meta's Send API limits for Instagram / Messenger buttons and chips.
const META_BUTTON_TITLE = 20;
const META_QUICK_REPLIES = 13;
const META_CARDS = 10;
const META_CARD_BUTTONS = 3;
const newCard = (): CardData => ({ imageUrl: '', title: '', subtitle: '', buttons: [{ title: 'Choose', url: '' }] });

const KINDS: Record<Kind, { title: string; icon: string; color: string }> = {
  start: { title: 'Start', icon: 'play_arrow', color: '#107c3f' },
  message: { title: 'Send message', icon: 'chat', color: '#0096de' },
  reply: { title: 'Reply buttons', icon: 'smart_button', color: '#8b5cf6' },
  cta: { title: 'CTA URL', icon: 'open_in_new', color: '#0d9488' },
  call: { title: 'Call button', icon: 'call', color: '#f59e0b' },
  location: { title: 'Ask location', icon: 'location_on', color: '#ea4335' },
  list: { title: 'List menu', icon: 'list', color: '#6366f1' },
  template: { title: 'Template', icon: 'description', color: '#107c3f' },
  quick: { title: 'Quick replies', icon: 'bubble_chart', color: '#ec4899' },
  carousel: { title: 'Cards', icon: 'view_carousel', color: '#0ea5e9' },
  end: { title: 'End', icon: 'stop', color: '#ea4335' },
  // Like the Flows builder's "Start over": back to Start, as if the customer said "hi".
  restart: { title: 'Start again', icon: 'restart_alt', color: '#25d366' },
};

const HEADER_KINDS = new Set<Kind>(['message', 'reply', 'cta', 'call']);
const BODY_KINDS = new Set<Kind>(['message', 'reply', 'cta', 'call', 'location', 'list', 'quick', 'carousel']);
// A block's outputs (its ports on the right) come from outputsOf(): one for a
// plain block, one per button / option for the branching ones, none for End
// and Start again.

const HEADER_ICON: Record<HeaderType, string> = {
  none: 'block',
  image: 'image',
  video: 'videocam',
  audio: 'mic',
  pdf: 'picture_as_pdf',
};
const HEADER_LABEL: Record<HeaderType, string> = { none: 'No media', image: 'Image', video: 'Video', audio: 'Audio', pdf: 'File' };
/** Media a block can carry: WhatsApp headers, or Instagram / Messenger attachments (sent before the text). */
const headerTypesFor = (channel: JourneyChannel, kind: Kind): HeaderType[] =>
  channel === 'whatsapp' ? ['none', 'image', 'video', 'pdf'] : kind === 'message' ? ['none', 'image', 'video', 'audio', 'pdf'] : ['none', 'image', 'video', 'pdf'];

const TemplatesCtx = createContext<TemplateItem[]>([]);

function tmplBtnIcon(type: string): string {
  return type === 'URL' ? 'open_in_new' : type === 'PHONE_NUMBER' ? 'call' : 'reply';
}

function makeData(kind: Kind, count = 1, header: HeaderType = 'none'): WaData {
  switch (kind) {
    case 'quick':
      return { kind, text: '', options: ['Option 1', 'Option 2'] };
    case 'carousel':
      return { kind, text: '', cards: Array.from({ length: count }, newCard) };
    case 'reply':
      return {
        kind,
        header: 'none',
        text: '',
        buttons: Array.from({ length: count }, (_, i) => `Button ${i + 1}`),
      };
    case 'list':
      return { kind, text: '', listTitle: 'Menu', options: ['Option 1', 'Option 2'] };
    case 'cta':
      return { kind, header: 'none', text: '', ctaText: 'Visit website', ctaUrl: '' };
    case 'call':
      return { kind, header: 'none', text: '', callText: 'Call us', callPhone: '' };
    case 'location':
      return { kind, text: 'Please share your delivery location.' };
    case 'template':
      return { kind, templateName: '' };
    case 'message':
      return { kind, header, text: '' };
    default:
      return { kind };
  }
}

const ACCEPT: Record<HeaderType, string> = {
  none: '',
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  pdf: 'application/pdf',
};

/** A block's settings, shown in the pop-up when the block is clicked (BlockEditor). */
function NodeFields({ id, data }: { id: string; data: WaData }) {
  const rf = useReactFlow();
  const templates = useContext(TemplatesCtx);
  const channel = useContext(ChannelCtx);
  const meta = channel !== 'whatsapp';
  const titleMax = meta ? META_BUTTON_TITLE : undefined;
  const { upload, discard } = useMedia();
  const fileRef = useRef<HTMLInputElement>(null);
  const cardFileRef = useRef<HTMLInputElement>(null);
  const cardTarget = useRef(-1);
  const k = KINDS[data.kind];
  const patch = (p: Partial<WaData>) =>
    rf.setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n)));

  // Switch header type and, for media types, immediately open the file picker.
  // Clearing the header reclaims the file if it was uploaded this session.
  const pickHeader = (h: HeaderType) => {
    if (h === 'none') discard(data.headerMediaUrl);
    patch({ header: h, ...(h === 'none' ? { headerMediaUrl: '', headerFileName: '' } : {}) });
    if (h !== 'none') setTimeout(() => fileRef.current?.click(), 0);
  };
  const onHeaderFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const previous = data.headerMediaUrl;
    patch({ headerMediaUrl: URL.createObjectURL(f), headerFileName: f.name }); // instant preview
    upload(f)
      .then((url) => {
        patch({ headerMediaUrl: url });
        discard(previous); // replaced → reclaim the old upload
      })
      .catch(() => {});
  };
  const setButton = (i: number, v: string) =>
    patch({ buttons: (data.buttons || []).map((b, idx) => (idx === i ? v : b)) });
  // Buttons whose title repeats an earlier one (WhatsApp refuses those).
  const dupButtons = new Set<number>();
  (data.buttons || []).forEach((b, i, all) => {
    const t = String(b || '').trim().toLowerCase();
    if (t && all.slice(0, i).some((x) => String(x || '').trim().toLowerCase() === t)) dupButtons.add(i);
  });
  const setOption = (i: number, v: string) =>
    patch({ options: (data.options || []).map((o, idx) => (idx === i ? v : o)) });
  const addOption = () => {
    const opts = data.options || [];
    if (opts.length >= 10) return;
    patch({ options: [...opts, `Option ${opts.length + 1}`] });
  };
  const removeOption = (i: number) =>
    patch({ options: (data.options || []).filter((_, idx) => idx !== i) });
  const optionMax = data.kind === 'quick' ? META_QUICK_REPLIES : 10;
  const addQuick = () => {
    const opts = data.options || [];
    if (opts.length >= optionMax) return;
    patch({ options: [...opts, `Option ${opts.length + 1}`] });
  };

  // Cards (Instagram / Messenger): edit one card, add / remove cards and buttons.
  const cards = data.cards || [];
  const setCard = (i: number, p: Partial<CardData>) => patch({ cards: cards.map((c, idx) => (idx === i ? { ...c, ...p } : c)) });
  const setCardButton = (i: number, j: number, p: Partial<CardButton>) =>
    setCard(i, { buttons: cards[i].buttons.map((b, idx) => (idx === j ? { ...b, ...p } : b)) });
  const pickCardImage = (i: number) => {
    cardTarget.current = i;
    setTimeout(() => cardFileRef.current?.click(), 0);
  };
  const onCardFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    const i = cardTarget.current;
    if (!f || i < 0) return;
    const previous = (rf.getNode(id)?.data as WaData | undefined)?.cards?.[i]?.imageUrl || '';
    const setImage = (url: string) =>
      rf.setNodes((nds) => nds.map((n) => {
        if (n.id !== id) return n;
        const list = ((n.data as WaData).cards || []).map((c, idx) => (idx === i ? { ...c, imageUrl: url } : c));
        return { ...n, data: { ...n.data, cards: list } };
      }));
    setImage(URL.createObjectURL(f));
    upload(f)
      .then((url) => {
        setImage(url);
        discard(previous);
      })
      .catch(() => {});
  };
  const removeCard = (i: number) => {
    discard(cards[i]?.imageUrl);
    patch({ cards: cards.filter((_, idx) => idx !== i) });
    // Its reply ports go with it; later cards' ports keep their old index, so drop their edges too.
    rf.setEdges((es) => es.filter((e) => !(e.source === id && /^card-(\d+)-/.test(e.sourceHandle || '') && Number(/^card-(\d+)-/.exec(e.sourceHandle || '')![1]) >= i)));
  };

  return (
    <div className="fl-node jn-fields" data-kind={data.kind} style={{ ['--k' as string]: k.color }}>
      {data.kind === 'start' && (
        <div className="fl-restart jn-start-note" data-testid="fl-start-note">
          <span className="material-icons">bolt</span>
          <div>
            The journey starts here when a customer messages you (a new chat, or any message while no block is waiting for a tap).
            Connect it to your first message.
          </div>
        </div>
      )}
      {data.kind === 'end' && (
        <div className="fl-restart jn-start-note">
          <span className="material-icons">stop_circle</span>
          <div>Ends the journey. The customer&apos;s next message starts it again from Start.</div>
        </div>
      )}

      {HEADER_KINDS.has(data.kind) && (
        <div className="fl-header">
          <div className="fl-header-tabs">
            {headerTypesFor(channel, data.kind).map((h) => (
              <button
                key={h}
                className={`fl-htab${(data.header || 'none') === h ? ' active' : ''}`}
                onClick={() => pickHeader(h)}
                title={HEADER_LABEL[h]}
                data-testid={`fl-htab-${h}`}
              >
                <span className="material-icons">{HEADER_ICON[h]}</span>
              </button>
            ))}
          </div>
          {data.header && data.header !== 'none' && (
            <div className="fl-header-tile" onClick={() => fileRef.current?.click()} title="Upload / replace">
              {data.headerMediaUrl ? (
                data.header === 'image' ? (
                  <img src={data.headerMediaUrl} alt="" />
                ) : data.header === 'video' ? (
                  <video src={data.headerMediaUrl} />
                ) : data.header === 'audio' ? (
                  <div className="fl-pdf-chip">
                    <span className="material-icons">mic</span>
                    <span className="fl-pdf-name">{data.headerFileName || 'audio'}</span>
                  </div>
                ) : (
                  <div className="fl-pdf-chip">
                    <span className="material-icons">picture_as_pdf</span>
                    <span className="fl-pdf-name">{data.headerFileName || 'document.pdf'}</span>
                  </div>
                )
              ) : (
                <div className="fl-upload-hint">
                  <span className="material-icons">upload</span>
                  <span>Upload {data.header === 'pdf' ? (meta ? 'file' : 'pdf') : data.header}</span>
                </div>
              )}
            </div>
          )}
          <input ref={fileRef} type="file" hidden accept={ACCEPT[data.header || 'none']} onChange={onHeaderFile} />
        </div>
      )}

      {/* Sends nothing itself: it loops back to Start, so it has an input and no output. */}
      {data.kind === 'restart' && (
        <div className="fl-restart" data-testid="fl-restart">
          <span className="material-icons">replay</span>
          <div>
            Goes back to <strong>Start</strong> and runs the journey again, exactly like the customer typing &quot;hi&quot;.
          </div>
        </div>
      )}

      {BODY_KINDS.has(data.kind) && (
        <textarea
          className="fl-node-text"
          value={data.text || ''}
          placeholder={data.kind === 'location' ? 'Prompt text…' : data.kind === 'carousel' ? 'Text before the cards (optional)…' : 'Type the message… use {{name}} to greet them'}
          onChange={(e) => patch({ text: e.target.value })}
          rows={2}
        />
      )}
      {BODY_KINDS.has(data.kind) && /\{\{/.test(data.text || '') && (
        <div className="fl-node-tokens">
          <span className="material-icons">bolt</span>
          <span>
            Live values: <code>{'{{name}}'}</code> ({meta ? `their ${CHANNEL_NAME[channel]} name` : 'their form name, else WhatsApp name'}) ·{' '}
            <code>{'{{business_name}}'}</code> · <code>{'{{today}}'}</code>
          </span>
        </div>
      )}

      {data.kind === 'reply' && (
        <div className="fl-rows">
          {(data.buttons || []).map((b, i) => (
            <div className={`fl-row reply${dupButtons.has(i) ? ' dup' : ''}`} key={i}>
              <span className="material-icons fl-row-ic">reply</span>
              <input
                value={b}
                onChange={(e) => setButton(i, e.target.value)}
                placeholder="Button"
                maxLength={titleMax}
                aria-invalid={dupButtons.has(i) || undefined}
                title={dupButtons.has(i) ? 'Another button has this title: give each button its own' : undefined}
              />
            </div>
          ))}
          {dupButtons.size > 0 && (
            <div className="fl-dup-note" data-testid="fl-dup-note">
              <span className="material-icons">error_outline</span>
              Give each button its own title: WhatsApp doesn’t accept two buttons with the same one.
            </div>
          )}
        </div>
      )}

      {data.kind === 'list' && (
        <div className="fl-rows">
          <input
            className="fl-list-title"
            value={data.listTitle || ''}
            onChange={(e) => patch({ listTitle: e.target.value })}
            placeholder="List button label"
          />
          {(data.options || []).map((o, i) => (
            <div className="fl-row" key={i}>
              <span className="fl-row-num">{i + 1}</span>
              <input value={o} onChange={(e) => setOption(i, e.target.value)} placeholder="Option" />
              <button className="fl-row-del" onClick={() => removeOption(i)} title="Remove">
                <span className="material-icons">close</span>
              </button>
            </div>
          ))}
          {(data.options || []).length < 10 && (
            <button className="fl-add-opt" onClick={addOption}>
              <span className="material-icons">add</span> Add option
            </button>
          )}
        </div>
      )}

      {data.kind === 'quick' && (
        <div className="fl-rows" data-testid="fl-quick-rows">
          {(data.options || []).map((o, i) => (
            <div className="fl-row quick" key={i}>
              <span className="material-icons fl-row-ic">chat_bubble_outline</span>
              <input value={o} onChange={(e) => setOption(i, e.target.value)} placeholder="Quick reply" maxLength={META_BUTTON_TITLE} />
              <button className="fl-row-del" onClick={() => removeOption(i)} title="Remove">
                <span className="material-icons">close</span>
              </button>
            </div>
          ))}
          {(data.options || []).length < optionMax && (
            <button className="fl-add-opt" onClick={addQuick} data-testid="fl-quick-add">
              <span className="material-icons">add</span> Add quick reply
            </button>
          )}
        </div>
      )}

      {data.kind === 'carousel' && (
        <div className="fl-cards" data-testid="fl-cards">
          {cards.map((c, i) => (
            <div className="fl-card" key={i} data-testid={`fl-card-${i}`}>
              <div className="fl-card-head">
                <span>Card {i + 1}</span>
                {cards.length > 1 && (
                  <button className="fl-row-del" onClick={() => removeCard(i)} title="Remove card">
                    <span className="material-icons">close</span>
                  </button>
                )}
              </div>
              <div className="fl-header-tile fl-card-img" onClick={() => pickCardImage(i)} title="Upload / replace image">
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt="" />
                ) : (
                  <div className="fl-upload-hint">
                    <span className="material-icons">upload</span>
                    <span>Card image (optional)</span>
                  </div>
                )}
              </div>
              <input className="fl-card-in" value={c.title} onChange={(e) => setCard(i, { title: e.target.value })} placeholder="Title" maxLength={80} />
              <input className="fl-card-in" value={c.subtitle} onChange={(e) => setCard(i, { subtitle: e.target.value })} placeholder="Short text (optional)" maxLength={80} />
              {c.buttons.map((b, j) => (
                <div className="fl-row card-btn" key={j}>
                  <span className="material-icons fl-row-ic">{b.url ? 'open_in_new' : 'reply'}</span>
                  <div className="fl-card-btn-fields">
                    <input value={b.title} onChange={(e) => setCardButton(i, j, { title: e.target.value })} placeholder="Button" maxLength={META_BUTTON_TITLE} />
                    <input value={b.url} onChange={(e) => setCardButton(i, j, { url: e.target.value })} placeholder="https://… (empty = reply)" />
                  </div>
                  <button className="fl-row-del" onClick={() => setCard(i, { buttons: c.buttons.filter((_, idx) => idx !== j) })} title="Remove button">
                    <span className="material-icons">close</span>
                  </button>
                </div>
              ))}
              {c.buttons.length < META_CARD_BUTTONS && (
                <button className="fl-add-opt" onClick={() => setCard(i, { buttons: [...c.buttons, { title: `Button ${c.buttons.length + 1}`, url: '' }] })}>
                  <span className="material-icons">add</span> Add button
                </button>
              )}
            </div>
          ))}
          {cards.length < META_CARDS && (
            <button className="fl-add-opt" onClick={() => patch({ cards: [...cards, newCard()] })} data-testid="fl-card-add">
              <span className="material-icons">add</span> Add card ({cards.length}/{META_CARDS})
            </button>
          )}
          <input ref={cardFileRef} type="file" hidden accept="image/png,image/jpeg" onChange={onCardFile} />
        </div>
      )}

      {data.kind === 'location' && (
        <>
          <div className="fl-loc-btn">
            <span className="material-icons">location_on</span> Send location
          </div>
          <div className="fl-rows">
            <div className="fl-row branch yes">
              <span className="material-icons fl-row-ic ok">check_circle</span>
              <span className="fl-branch-label">Valid: the customer shared a location</span>
            </div>
            <div className="fl-row branch no">
              <span className="material-icons fl-row-ic bad">cancel</span>
              <span className="fl-branch-label">Not valid: they typed something else</span>
            </div>
          </div>
        </>
      )}

      {data.kind === 'cta' && (
        <div className="fl-fields">
          <input value={data.ctaText || ''} onChange={(e) => patch({ ctaText: e.target.value })} placeholder="Button text" maxLength={titleMax} />
          <input value={data.ctaUrl || ''} onChange={(e) => patch({ ctaUrl: e.target.value })} placeholder="https://…" />
        </div>
      )}

      {data.kind === 'call' && (
        <div className="fl-fields">
          <input value={data.callText || ''} onChange={(e) => patch({ callText: e.target.value })} placeholder="Button text" maxLength={titleMax} />
          <input value={data.callPhone || ''} onChange={(e) => patch({ callPhone: e.target.value })} placeholder="+91 98765 43210" />
        </div>
      )}

      {data.kind === 'template' &&
        (() => {
          const tpl = templates.find((t) => t.name === data.templateName);
          const comps = tpl?.components || [];
          const body = comps.find((c) => c.type === 'BODY')?.text || '';
          const footer = comps.find((c) => c.type === 'FOOTER')?.text || '';
          const header = comps.find((c) => c.type === 'HEADER');
          const tbtns = comps.find((c) => c.type === 'BUTTONS')?.buttons || [];
          return (
            <>
              <select
                className="fl-select"
                value={data.templateName || ''}
                onChange={(e) => patch({ templateName: e.target.value })}
              >
                <option value="">Choose approved template…</option>
                {templates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>

              {tpl && (
                <div className="fl-tpl-preview">
                  {header?.format === 'IMAGE' &&
                    (tpl.headerMediaUrl ? (
                      <img className="fl-tpl-media" src={tpl.headerMediaUrl} alt="" />
                    ) : (
                      <div className="fl-tpl-mediaph">
                        <span className="material-icons">image</span>
                      </div>
                    ))}
                  {header?.format === 'TEXT' && header.text && (
                    <div className="fl-tpl-htext">{header.text}</div>
                  )}
                  <div className="fl-tpl-body">{body}</div>
                  {footer && <div className="fl-tpl-footer">{footer}</div>}
                </div>
              )}

              {tbtns.length > 0 && (
                <div className="fl-tbtns">
                  {tbtns.map((b, i) =>
                    b.type === 'QUICK_REPLY' ? (
                      // Reply buttons continue the flow → each gets an output port.
                      <div className="fl-tbtn" key={i}>
                        <span className="material-icons">reply</span>
                        <span>{b.text}</span>
                      </div>
                    ) : (
                      // URL / call buttons are terminal (open link / dial) → no port.
                      <div className="fl-tbtn" key={i}>
                        <span className="material-icons">{tmplBtnIcon(b.type)}</span>
                        <span>{b.text}</span>
                      </div>
                    ),
                  )}
                </div>
              )}
            </>
          );
        })()}
      {OUTPUT_HINT[data.kind] && <p className="jn-out-hint">{OUTPUT_HINT[data.kind]}</p>}
    </div>
  );
}

/** Where a block's connections come out, said in its pop-up. */
const OUTPUT_HINT: Partial<Record<Kind, string>> = {
  reply: 'Each button gets its own output on the block: connect it to what happens when the customer taps it.',
  list: 'Each option gets its own output on the block.',
  quick: 'Each quick reply gets its own output on the block.',
  location: 'The block has two outputs: Valid (a location was shared) and Not valid (anything else).',
  carousel: 'Reply buttons (without a link) get their own outputs; “Next” continues after the cards.',
  template: 'Quick-reply buttons of the template get their own outputs; “Next” continues right away.',
};

// ---------------------------------------------------------------------------
// The block on the canvas (n8n style): icon, name and a one-line summary;
// branching blocks list their labelled outputs on the right, each with its
// own port. Clicking it opens BlockEditor. A free output shows a "+" that adds
// the next block already connected.
// ---------------------------------------------------------------------------
interface Output {
  /** React Flow handle id ('' = the default output). */
  id: string;
  label: string;
  bad?: boolean;
}

/** The outputs a block has, in order. */
function outputsOf(data: WaData, templates: TemplateItem[]): Output[] {
  switch (data.kind) {
    case 'reply': {
      const seen = new Set<string>();
      return (data.buttons || []).map((b, i) => {
        const t = String(b || '').trim().toLowerCase();
        const dup = !!t && seen.has(t);
        seen.add(t);
        return { id: `btn-${i}`, label: b || `Button ${i + 1}`, bad: dup || !t };
      });
    }
    case 'list':
    case 'quick':
      return (data.options || []).map((o, i) => ({ id: `opt-${i}`, label: o || `Option ${i + 1}`, bad: !String(o || '').trim() }));
    case 'location':
      return [{ id: 'loc-yes', label: 'Valid' }, { id: 'loc-no', label: 'Not valid' }];
    case 'carousel': {
      const out: Output[] = [];
      (data.cards || []).forEach((c, i) => c.buttons.forEach((b, j) => {
        if (!b.url) out.push({ id: `card-${i}-${j}`, label: `${(data.cards || []).length > 1 ? `Card ${i + 1} · ` : ''}${b.title || 'Button'}` });
      }));
      return out.length ? [...out, { id: '', label: 'Next' }] : [{ id: '', label: '' }];
    }
    case 'template': {
      const tpl = templates.find((t) => t.name === data.templateName);
      const btns = (tpl?.components || []).find((c) => c.type === 'BUTTONS')?.buttons || [];
      const out: Output[] = [];
      btns.forEach((b, i) => {
        if (b.type === 'QUICK_REPLY') out.push({ id: `tbtn-${i}`, label: b.text || `Button ${i + 1}` });
      });
      return out.length ? [...out, { id: '', label: 'Next' }] : [{ id: '', label: '' }];
    }
    case 'end':
    case 'restart':
      return [];
    default:
      return [{ id: '', label: '' }];
  }
}

// The first line of a text, as plain words (no pasted markup).
const firstLine = (s?: string) =>
  String(s || '').replace(/<[^>]*>?/g, ' ').split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The block's one-line summary under its name. */
function summaryOf(data: WaData, channel: JourneyChannel): string {
  const media = data.header && data.header !== 'none' ? `${HEADER_LABEL[data.header]}${data.headerMediaUrl ? '' : ' (not uploaded)'}` : '';
  const text = firstLine(data.text);
  switch (data.kind) {
    case 'start': return `When a customer messages you on ${CHANNEL_NAME[channel]}`;
    case 'message': return [media, text].filter(Boolean).join(' · ') || 'Empty message';
    // Branching blocks: what kind of question, not its text (that's in the pop-up);
    // the answers are the labelled outputs underneath.
    case 'reply': return `${media ? `${media} · ` : ''}${count((data.buttons || []).length, 'button', 'buttons')}`;
    case 'cta': return [data.ctaText || 'Button', data.ctaUrl || 'link not set'].join(' → ');
    case 'call': return [data.callText || 'Call', data.callPhone || 'number not set'].join(' · ');
    case 'location': return 'Asks for a location';
    case 'list': return `${data.listTitle || 'Menu'} · ${count((data.options || []).length, 'option', 'options')}`;
    case 'template': return data.templateName || 'Template not chosen';
    case 'quick': return count((data.options || []).length, 'quick reply', 'quick replies');
    case 'carousel': return count((data.cards || []).length, 'card', 'cards');
    case 'end': return 'Ends the journey';
    case 'restart': return 'Back to Start';
    default: return '';
  }
}

/** What would stop the block from sending (shown as a "!" on it). */
function problemOf(data: WaData, outputs: Output[]): string {
  const text = String(data.text || '').trim();
  switch (data.kind) {
    case 'message': return !text && !(data.header && data.header !== 'none' && data.headerMediaUrl) ? 'Add a message or a file' : '';
    case 'reply':
      if (!text) return 'Add the message text';
      return outputs.some((o) => o.bad) ? 'Each button needs its own title' : '';
    case 'quick': return !text ? 'Add the message text' : outputs.some((o) => o.bad) ? 'Every quick reply needs a title' : '';
    case 'list': return !text ? 'Add the message text' : outputs.some((o) => o.bad) ? 'Every option needs a title' : '';
    case 'cta': return !String(data.ctaUrl || '').trim() ? 'Add the link' : '';
    case 'call': return !String(data.callPhone || '').trim() ? 'Add the phone number' : '';
    case 'template': return !data.templateName ? 'Choose a template' : '';
    default: return '';
  }
}

/** The canvas gives the blocks what they need beyond their own data. */
interface CanvasApi {
  /** `${nodeId}|${handleId}` of every output already connected. */
  connected: Set<string>;
  /** `${nodeId}|top` / `${nodeId}|bottom`: a connection enters the block there. */
  inUsed: Set<string>;
  addFrom: (nodeId: string, handle: string) => void;
}
const CanvasCtx = createContext<CanvasApi>({ connected: new Set(), inUsed: new Set(), addFrom: () => {} });

/** A block's outputs for the layout and the input sides, with where each comes out (as WaNode draws them). */
function waLayoutPorts(n: Node<WaData> | undefined, templates: TemplateItem[], connected: Set<string>): LayoutPort[] {
  if (!n?.data) return [];
  const outputs = outputsOf(n.data, templates);
  const branches = outputs.filter((o) => o.label && o.id);
  const next = outputs.find((o) => !o.id);
  const single = !next && branches.length === 1;
  return [
    ...(next ? [{ id: '', side: 'right' as const }] : []),
    ...branches.map((o) => ({ id: o.id, side: single ? ('right' as const) : ('bottom' as const) })),
  ].map((p) => ({ ...p, free: !connected.has(`${n.id}|${p.id}`) }));
}

/**
 * One output of a block. Connected: a port on the block's edge. Free: a dot on
 * the edge, a short line and a "+" that *is* the port, so the "+" can be
 * clicked (pick the next block) or dragged onto a block to connect it.
 */
function OutPort({ nodeId, handle, side }: { nodeId: string; handle: string; side: 'right' | 'bottom' }) {
  const { connected, addFrom } = useContext(CanvasCtx);
  const position = side === 'right' ? Position.Right : Position.Bottom;
  const id = handle || undefined;
  if (connected.has(`${nodeId}|${handle}`)) {
    return <Handle type="source" id={id} position={position} className={`jn-handle out ${side}`} />;
  }
  return (
    <>
      <span className={`jn-dot ${side}`} aria-hidden="true" />
      <span className={`jn-stub ${side}`}>
        <span className="jn-stub-line" />
        <Handle
          type="source"
          id={id}
          position={position}
          className="jn-plus"
          title="Click to add the next block, or drag onto a block to connect it"
          onClick={(e) => {
            e.stopPropagation();
            addFrom(nodeId, handle);
          }}
          data-testid="jn-plus"
        >
          <span className="material-icons" aria-hidden="true">add</span>
        </Handle>
      </span>
    </>
  );
}

function WaNode({ id, data, selected }: NodeProps<WaData>) {
  const templates = useContext(TemplatesCtx);
  const channel = useContext(ChannelCtx);
  const k = KINDS[data.kind];
  const outputs = outputsOf(data, templates);
  // Branches (buttons, options, Valid / Not valid) come out of the bottom edge,
  // labelled, like n8n's sub-connections; the plain "next" stays on the right.
  const allBranches = outputs.filter((o) => o.label && o.id);
  const next = outputs.find((o) => !o.id);
  // A single answer (one reply button…) and nothing else: it comes out of the
  // right side, labelled there, like a plain "next". Several go along the bottom.
  const side = !next && allBranches.length === 1 ? allBranches[0] : null;
  const branches = side ? [] : allBranches;
  const problem = problemOf(data, outputs);
  const isStart = data.kind === 'start';
  // A port turns from "+" into a dot when connected (and back): React Flow
  // must measure the block's ports again, or the line starts from the old spot.
  const { connected, inUsed } = useContext(CanvasCtx);
  const portsKey = outputs.map((o) => `${o.id}:${connected.has(`${id}|${o.id}`) ? 1 : 0}`).join(',');
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateInternals(id);
  }, [portsKey, id, updateInternals]);
  return (
    <div
      className={`jn-node kind-${data.kind}${selected ? ' selected' : ''}${problem ? ' warn' : ''}${branches.length ? ' has-ports' : ''}`}
      style={{ ['--k' as string]: k.color, ...(branches.length ? { minWidth: Math.max(210, branches.length * 92 + 24) } : {}) }}
      data-testid="jn-node"
      data-kind={data.kind}
      title="Click to edit"
    >
      {/* The left input first: a connection without a named input uses it. */}
      {!isStart && <Handle type="target" position={Position.Left} className="jn-handle in" />}
      {/* Used when the block sits under (or over) the one leading to it. */}
      {!isStart && <Handle type="target" id={IN_HANDLE.top!} position={Position.Top} className={`jn-handle in top${inUsed.has(`${id}|top`) ? ' used' : ''}`} />}
      {!isStart && !branches.length && (
        <Handle type="target" id={IN_HANDLE.bottom!} position={Position.Bottom} className={`jn-handle in bottom${inUsed.has(`${id}|bottom`) ? ' used' : ''}`} />
      )}
      {isStart && <span className="jn-bolt material-icons" aria-hidden="true">bolt</span>}
      <div className="jn-main">
        <span className="jn-ic"><span className="material-icons">{k.icon}</span></span>
        <div className="jn-txt">
          <div className="jn-title">{k.title}</div>
          <div className="jn-sub" data-testid="jn-sub">{summaryOf(data, channel)}</div>
        </div>
        {problem && (
          <span className="jn-warn material-icons" title={problem} aria-label={problem} data-testid="jn-warn">error</span>
        )}
      </div>
      {next && <OutPort nodeId={id} handle="" side="right" />}
      {side && (
        <span className={`jn-side${side.bad ? ' bad' : ''}`} data-testid="jn-out" data-handle={side.id}>
          <OutPort nodeId={id} handle={side.id} side="right" />
          <span className="jn-out-label">{side.label}</span>
        </span>
      )}
      {branches.length > 0 && (
        <div className="jn-ports">
          {branches.map((o) => (
            <div className={`jn-port${o.bad ? ' bad' : ''}`} key={o.id} data-testid="jn-out" data-handle={o.id}>
              <OutPort nodeId={id} handle={o.id} side="bottom" />
              <span className="jn-out-label">{o.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { wa: WaNode };

const initialNodes: Node<WaData>[] = [
  { id: 'start', type: 'wa', position: { x: 60, y: 180 }, data: { kind: 'start' } },
  {
    id: 'welcome',
    type: 'wa',
    position: { x: 320, y: 120 },
    data: { kind: 'message', header: 'image', text: 'Hi 👋 Welcome! How can we help?' },
  },
];
const initialEdges: Edge[] = [
  { id: 'e-start-welcome', source: 'start', target: 'welcome', animated: true },
];
/** Instagram / Messenger starter: Start → a welcome text (no media to upload first). */
const seedNodesFor = (channel: JourneyChannel): Node<WaData>[] => (channel === 'whatsapp'
  ? initialNodes
  : [
    initialNodes[0],
    { ...initialNodes[1], data: { kind: 'message', header: 'none', text: 'Hi 👋 Welcome! How can we help?' } },
  ]);

let idCounter = 100;

type PaletteItem = { kind: Kind; count?: number; header?: HeaderType; label: string; icon?: string };
const WHATSAPP_PALETTE: PaletteItem[] = [
  { kind: 'message', label: 'Message' },
  { kind: 'reply', count: 1, label: '1 reply button' },
  { kind: 'reply', count: 2, label: '2 reply buttons' },
  { kind: 'reply', count: 3, label: '3 reply buttons' },
  { kind: 'cta', label: 'CTA URL' },
  { kind: 'call', label: 'Call button' },
  { kind: 'location', label: 'Ask location' },
  { kind: 'list', label: 'List menu' },
  { kind: 'template', label: 'Template' },
  { kind: 'restart', label: 'Start again' },
  { kind: 'end', label: 'End' },
];
// What Meta's Send API can send on Instagram / Messenger: the same message
// types as a CRM chat (text, photo, video, audio, file) plus buttons, quick
// replies and cards. No list menus, location requests or templates there.
const metaPalette = (channel: 'instagram' | 'messenger'): PaletteItem[] => [
  { kind: 'message', label: 'Text' },
  { kind: 'message', header: 'image', label: 'Image', icon: 'image' },
  { kind: 'message', header: 'video', label: 'Video', icon: 'videocam' },
  { kind: 'message', header: 'audio', label: 'Audio', icon: 'mic' },
  { kind: 'message', header: 'pdf', label: 'File', icon: 'attach_file' },
  { kind: 'reply', count: 1, label: '1 reply button' },
  { kind: 'reply', count: 2, label: '2 reply buttons' },
  { kind: 'reply', count: 3, label: '3 reply buttons' },
  { kind: 'quick', label: 'Quick replies' },
  { kind: 'cta', label: 'Link button' },
  ...(channel === 'messenger' ? [{ kind: 'call' as Kind, label: 'Call button' }] : []),
  { kind: 'carousel', count: 1, label: 'Card', icon: 'crop_landscape' },
  { kind: 'carousel', count: 2, label: 'Carousel' },
  { kind: 'restart', label: 'Start again' },
  { kind: 'end', label: 'End' },
];
/**
 * Where the journey begins. Every journey comes with one (it has no ✕); it's
 * offered here only to put it back if it was removed (e.g. with Backspace).
 */
const START_ITEM: PaletteItem = { kind: 'start', label: 'Start' };
const paletteFor = (channel: JourneyChannel, hasStart: boolean): PaletteItem[] => [
  ...(hasStart ? [] : [START_ITEM]),
  ...(channel === 'whatsapp' ? WHATSAPP_PALETTE : metaPalette(channel)),
];

interface FlowCanvasProps {
  nodes: Node<WaData>[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  setNodes: Dispatch<SetStateAction<Node<WaData>[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
}

/** n8n-style connections: solid curves with an arrow, the channel colour when selected. */
const EDGE_GREY = '#9aa3ad';
const edgeLook = (e: Edge, stroke: string): Edge => ({
  ...e,
  type: 'default',
  animated: false,
  style: { stroke: e.selected ? stroke : EDGE_GREY, strokeWidth: e.selected ? 2.6 : 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: e.selected ? stroke : EDGE_GREY, width: 16, height: 16 },
});

/** One kind of block per choice in the "+" menu (the palette, without Start). */
function nextId(nds: Node<WaData>[]): string {
  let id = `n${idCounter++}`;
  while (nds.some((n) => n.id === id)) id = `n${idCounter++}`;
  return id;
}

/** "Organize": the journey laid out left to right (see organizeLayout). */
function organizeJourney(nodes: Node<WaData>[], edges: Edge[], templates: TemplateItem[]): Node<WaData>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const connected = new Set(edges.map((e) => `${e.source}|${e.sourceHandle || ''}`));
  const pos = organizeLayout(
    nodes.map((n) => ({ id: n.id, width: n.width || 220, height: n.height || 60 })),
    edges,
    (id) => waLayoutPorts(byId.get(id), templates, connected),
    nodes.find((n) => n.data?.kind === 'start')?.id,
  );
  return nodes.map((n) => ({ ...n, position: pos.get(n.id) || n.position }));
}

/** The pop-up a block opens in: its settings, Delete and Done. */
function BlockEditor({ node, onClose, onDelete }: { node: Node<WaData>; onClose: () => void; onDelete: () => void }) {
  const k = KINDS[node.data.kind];
  const channel = useContext(ChannelCtx);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="jn-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="jn-editor-backdrop">
      <div className="jn-modal" role="dialog" aria-modal="true" aria-label={`${k.title} block`} data-testid="jn-editor" style={{ ['--k' as string]: k.color }}>
        <header className="jn-modal-head">
          <span className="jn-ic"><span className="material-icons">{k.icon}</span></span>
          <div className="jn-modal-titles">
            <h3>{k.title}</h3>
            <p>{summaryOf(node.data, channel)}</p>
          </div>
          <button type="button" className="jn-modal-x" onClick={onClose} aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </header>
        <div className="jn-modal-body">
          <NodeFields id={node.id} data={node.data} />
        </div>
        <footer className="jn-modal-foot">
          {node.data.kind !== 'start' && (
            <button type="button" className="k-btn ghost sm danger" onClick={onDelete} data-testid="jn-editor-delete">
              <span className="material-icons">delete_outline</span> Delete block
            </button>
          )}
          <span className="jn-modal-note">Changes apply straight away. Save the journey when you’re done.</span>
          <button type="button" className="k-btn sm" onClick={onClose} data-testid="jn-editor-done">Done</button>
        </footer>
      </div>
    </div>
  );
}

/** "+" on a free output: choose the next block; it's added to the right, connected. */
function AddMenu({ palette, onPick, onClose }: { palette: PaletteItem[]; onPick: (p: PaletteItem) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="jn-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="jn-modal jn-add" role="dialog" aria-modal="true" aria-label="Add the next block" data-testid="jn-add-menu">
        <header className="jn-modal-head">
          <div className="jn-modal-titles">
            <h3>Add the next block</h3>
            <p>It’s placed to the right and connected.</p>
          </div>
          <button type="button" className="jn-modal-x" onClick={onClose} aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </header>
        <div className="jn-add-grid">
          {palette.filter((p) => p.kind !== 'start').map((p) => {
            const k = KINDS[p.kind];
            return (
              <button type="button" key={p.label} className="jn-add-item" onClick={() => onPick(p)} style={{ ['--k' as string]: k.color }} data-testid={`jn-add-${p.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
                <span className="jn-ic"><span className="material-icons">{p.icon || k.icon}</span></span>
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FlowCanvas({ nodes, edges, onNodesChange, onEdgesChange, setNodes, setEdges }: FlowCanvasProps) {
  const rf = useReactFlow();
  const channel = useContext(ChannelCtx);
  const stroke = EDGE_COLOR[channel];
  const hasStart = nodes.some((n) => n.data?.kind === 'start');
  const palette = paletteFor(channel, hasStart);
  const templates = useContext(TemplatesCtx);
  const { discard } = useMedia();
  // The block whose pop-up is open, and the free output a "+" was clicked on.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingFrom, setAddingFrom] = useState<{ nodeId: string; handle: string } | null>(null);
  const editingNode = editingId ? nodes.find((n) => n.id === editingId) || null : null;

  const onConnect = useCallback(
    // One connection per output: a new one from the same port replaces the old.
    (c: Connection) =>
      setEdges((eds) =>
        addEdge(
          // Which side it was dropped on isn't stored: the side is redrawn
          // from where the blocks are.
          { ...c, targetHandle: null, animated: false, style: { stroke: EDGE_GREY, strokeWidth: 2 } },
          eds.filter((e) => !(e.source === c.source && (e.sourceHandle || null) === (c.sourceHandle || null))),
        ),
      ),
    [setEdges],
  );

  const connected = useMemo(() => new Set(edges.map((e) => `${e.source}|${e.sourceHandle || ''}`)), [edges]);
  // Each connection enters its block from the side facing where it comes
  // from: the left, or the top / bottom when the block sits under / over it.
  // Worked out from the live positions, so it follows a block being dragged.
  const shownEdges = useMemo(() => {
    const rect = new Map(nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y, w: n.width || 0, h: n.height || 0 }]));
    const bottomOuts = new Map(nodes.map((n) => [n.id, waLayoutPorts(n, templates, connected).some((p) => p.side === 'bottom')]));
    return edges.map((e) => {
      const side = inSideFor(rect.get(e.source) || null, rect.get(e.target) || null, !!bottomOuts.get(e.target));
      return { ...edgeLook(e, stroke), targetHandle: IN_HANDLE[side] };
    });
  }, [edges, nodes, stroke, templates, connected]);
  // Which input sides are in use, as one string so the blocks only re-render
  // when one changes (not on every frame of a drag).
  const inUsedKey = shownEdges.filter((e) => e.targetHandle).map((e) => `${e.target}|${e.targetHandle === IN_HANDLE.top ? 'top' : 'bottom'}`).sort().join(',');
  const inUsed = useMemo(() => new Set(inUsedKey ? inUsedKey.split(',') : []), [inUsedKey]);
  const canvasApi = useMemo<CanvasApi>(
    () => ({ connected, inUsed, addFrom: (nodeId, handle) => setAddingFrom({ nodeId, handle }) }),
    [connected, inUsed],
  );
  const { full, toggle: toggleFull } = useCanvasFullscreen(() => {
    setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 0.9, duration: 250 }), 120);
  });

  function addAfter(p: PaletteItem) {
    const from = addingFrom;
    setAddingFrom(null);
    if (!from) return;
    const src = rf.getNode(from.nodeId);
    if (!src) return;
    // The plain "next": to the right. A branch (a bottom port): below and to
    // the right, one row per branch, so the branches fan out.
    const all = outputsOf(src.data as WaData, templates);
    const outs = all.filter((o) => o.id);
    const idx = outs.findIndex((o) => o.id === from.handle);
    const width = src.width || 240;
    // A lone answer comes out of the side, like a plain "next".
    const onSide = outs.length === 1 && all.length === 1;
    const position = from.handle && idx >= 0 && !onSide
      ? { x: src.position.x + width + 90, y: src.position.y + (src.height || 60) + 70 + idx * 110 }
      : { x: src.position.x + width + 110, y: src.position.y };
    let newId = '';
    setNodes((nds) => {
      newId = nextId(nds);
      return [...nds, { id: newId, type: 'wa', position, data: makeData(p.kind, p.count, p.header) }];
    });
    setEdges((eds) => [
      ...eds,
      { id: `e-${from.nodeId}-${from.handle || 'out'}-${newId}`, source: from.nodeId, sourceHandle: from.handle || null, target: newId, animated: false, style: { stroke: EDGE_GREY, strokeWidth: 2 } },
    ]);
    // Straight into the new block's settings.
    setTimeout(() => setEditingId(newId), 0);
  }

  function deleteNode(id: string) {
    const n = rf.getNode(id);
    const d = n?.data as WaData | undefined;
    discard(d?.headerMediaUrl);
    (d?.cards || []).forEach((c) => discard(c.imageUrl));
    setNodes((nds) => nds.filter((x) => x.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setEditingId(null);
  }

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/reactflow');
      if (!raw) return;
      const { kind, count, header } = JSON.parse(raw) as { kind: Kind; count?: number; header?: HeaderType };
      const position = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setNodes((nds) => {
        // One Start per journey.
        if (kind === 'start' && nds.some((n) => n.data?.kind === 'start')) return nds;
        // Ids already on the canvas (a saved journey) are never reused.
        const id = nextId(nds);
        return [...nds, { id, type: 'wa', position, data: makeData(kind, count, header) }];
      });
    },
    [rf, setNodes],
  );

  function onPaletteDragStart(e: React.DragEvent, p: PaletteItem) {
    e.dataTransfer.setData('application/reactflow', JSON.stringify({ kind: p.kind, count: p.count, header: p.header }));
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div className={`flows-body${full ? ' canvas-full' : ''}`} data-testid="canvas-wrap">
      <aside className="flow-palette" data-testid="flow-palette" data-channel={channel}>
        <div className="fp-title">{CHANNEL_NAME[channel]} blocks</div>
        <p className="fp-hint">Drag a block onto the canvas, then connect the ports.</p>
        {palette.map((p) => {
          const k = KINDS[p.kind];
          return (
            <div
              key={p.label}
              className="pal-item"
              draggable
              title={
                p.kind === 'start'
                  ? 'This journey has no Start: drop one and connect it to your first message'
                  : p.kind === 'restart'
                    ? 'Goes back to Start and runs the journey again, like the customer typing "hi"'
                    : undefined
              }
              onDragStart={(e) => onPaletteDragStart(e, p)}
              data-testid={`pal-${p.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
            >
              <span className="material-icons" style={{ color: k.color }}>
                {p.icon || k.icon}
              </span>
              {p.label}
            </div>
          );
        })}
      </aside>

      <div className="flow-canvas jn-canvas" onDrop={onDrop} onDragOver={onDragOver}>
        <button
          type="button"
          className="jn-tidy"
          onClick={() => {
            setNodes((nds) => organizeJourney(nds, edges, templates));
            setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 0.9, duration: 300 }), 50);
          }}
          title="Arrange the blocks left to right in the order the journey runs, each branch in its own row"
          data-testid="jn-organize"
        >
          <span className="material-icons">account_tree</span> Organize
        </button>
        <CanvasCtx.Provider value={canvasApi}>
          <ReactFlow
            nodes={nodes}
            edges={shownEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setEditingId(n.id)}
            // While a pop-up is open, Backspace edits text, it never deletes the block.
            deleteKeyCode={editingId || addingFrom ? null : ['Backspace', 'Delete']}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 0.9 }}
            minZoom={0.3}
            defaultEdgeOptions={{ type: 'default', animated: false }}
            connectionLineStyle={{ stroke: EDGE_GREY, strokeWidth: 2 }}
            // A click on a "+" opens "Add the next block"; connecting is by dragging.
            connectOnClick={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.6} color="#c9c2b6" />
            <Controls>
              <FullscreenButton full={full} onClick={toggleFull} />
            </Controls>
            <MiniMap pannable zoomable nodeColor={(n) => KINDS[(n.data as WaData)?.kind || 'message']?.color || stroke} />
          </ReactFlow>
        </CanvasCtx.Provider>
      </div>
      {editingNode && <BlockEditor node={editingNode} onClose={() => setEditingId(null)} onDelete={() => deleteNode(editingNode.id)} />}
      {addingFrom && <AddMenu palette={palette} onPick={addAfter} onClose={() => setAddingFrom(null)} />}
    </div>
  );
}

// Full-page journey editor: node canvas + a name and Save. Nodes/edges live
// here (controlled) so they can be persisted.
function JourneyEditor({
  api,
  templates,
  journey,
  channel = 'whatsapp',
  connection,
  onBack,
  onSaved,
  registerDirty,
  onNavigate,
}: {
  api: CrmApi;
  templates: TemplateItem[];
  journey: Journey | null;
  /** The chats this journey answers. */
  channel?: JourneyChannel;
  /** Instagram / Messenger: the connection's state ('' while loading or for WhatsApp). */
  connection?: '' | 'connected' | 'disconnected' | 'none';
  /** Omitted when the editor *is* the page and there's nowhere to go back to. */
  onBack?: () => void;
  onSaved: (msg: string, saved?: Journey) => void;
  /** Register an "are there unsaved changes?" probe with the shell. */
  registerDirty?: (fn: (() => boolean) | null) => void;
  onNavigate?: (view: any) => void;
}) {
  // Only when opened as a sub-page (it has a back arrow); as a tab's main
  // view, Back is the shell's (return to Chats, asking if unsaved).
  useBackHandler(!!onBack, () => onBack?.());
  // A saved draft opens in place of the published journey (customers keep
  // getting the published one until Publish).
  const draft = journey?.draft && Array.isArray(journey.draft.nodes) && journey.draft.nodes.length ? journey.draft : null;
  const source = draft || journey;
  const seedNodes = (source?.nodes?.length ? (source.nodes as Node<WaData>[]) : seedNodesFor(channel));
  const seedEdges = (source?.nodes?.length ? ((source.edges || []) as Edge[]) : initialEdges);
  const [name, setName] = useState(source?.name || (channel === 'whatsapp' ? 'My Journey' : `My ${CHANNEL_NAME[channel]} journey`));
  const [nodes, setNodes, onNodesChange] = useNodesState<WaData>(seedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(seedEdges);
  const [savedId, setSavedId] = useState(journey?._id || '');
  const [saving, setSaving] = useState<'' | 'draft' | 'publish' | 'discard'>('');
  // On the server: unpublished changes, and whether anything is live yet.
  const [hasDraft, setHasDraft] = useState(!!draft);
  const [hasPublished, setHasPublished] = useState(!!journey?.nodes?.length);
  // The live version, for "Discard draft".
  const published = useRef({ name: journey?.name || '', nodes: (journey?.nodes || []) as Node<WaData>[], edges: (journey?.edges || []) as Edge[] });
  const confirm = useConfirm();
  // The journey always runs (no Bot on / off here any more). Whether Flows
  // take over WhatsApp is the Flows tab's switch; a single chat can still be
  // set to Manual in Chats.
  const [error, setError] = useState<{ message: string; problems: string[] } | null>(null);
  // Media uploaded in this session and then replaced or removed. Deleted only
  // at save (or on leaving), and only if nothing points at it any more, so an
  // undo can bring a replaced photo back. Already-saved media is cleaned up
  // server-side.
  const replaced = useRef(new Set<string>());
  const media = useMediaApi(
    (f) => api.uploadMedia(f, 'journeys'),
    async (url) => {
      replaced.current.add(url);
    },
  );
  // In use: the saved version AND the published one. While a draft is being
  // edited, a photo the draft dropped can still be what customers get.
  const inUse = (saved: string) => `${saved}\n${JSON.stringify(published.current)}`;
  const reclaim = (stillUsed: string) => {
    const used = inUse(stillUsed);
    for (const url of [...replaced.current]) {
      if (used.includes(url)) continue;
      replaced.current.delete(url);
      api.deleteMedia(url).catch(() => {});
    }
  };

  // A snapshot of only what the business actually authored, so "unsaved
  // changes" means what they'd expect. React Flow writes `selected`,
  // `dragging` and measured sizes back onto its nodes, and reorders them for
  // z-index — comparing the raw arrays would call a single click a change.
  const snapshot = () => snapshotOf(name, nodes, edges);
  const snapshotOf = (name: string, nodes: Node<WaData>[], edges: Edge[]) =>
    JSON.stringify({
      name: name.trim(),
      nodes: [...nodes]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((n) => ({
          id: n.id,
          type: n.type,
          x: Math.round(n.position?.x ?? 0),
          y: Math.round(n.position?.y ?? 0),
          data: n.data,
        })),
      edges: [...edges]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
          label: typeof e.label === 'string' ? e.label : null,
        })),
    });
  const baseline = useRef('');
  useEffect(() => {
    baseline.current = snapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A journey that was never saved is always "dirty", even untouched: the
  // editor seeds a starter graph (Start → a welcome message), and comparing
  // that seed against its own baseline made the header read "Saved" when
  // nothing had ever been written to the backend — so the Save button never
  // appeared and the journey silently never persisted.
  const edited = snapshot() !== baseline.current;
  const dirty = !savedId || edited;

  // Kept in a ref and refreshed every render so the guard below always reads
  // the current state rather than a stale closure. The leave guard only cares
  // about real edits: an untouched starter journey loses nothing by leaving —
  // the same starter is seeded next time — so it mustn't ask "Discard changes?"
  // of someone who has only looked at the page.
  const isDirty = useRef<() => boolean>(() => false);
  isDirty.current = () => edited;

  // Let the shell intercept navigation away while there's unsaved work.
  useEffect(() => {
    registerDirty?.(() => isDirty.current());
    return () => registerDirty?.(null);
  }, [registerDirty]);

  // Closing the tab or hitting refresh loses the canvas just as surely.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty.current()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
  // Leaving the editor: replaced uploads the saved journey doesn't use go,
  // and so do files uploaded here that were never saved (Discard, Back).
  useEffect(() => () => reclaim(baseline.current), []); // eslint-disable-line react-hooks/exhaustive-deps
  useLeaveCleanup(media, () => inUse(baseline.current), (url) => { api.deleteMedia(url).catch(() => {}); });

  // ---- Undo / redo (like the Flows builder) ----
  // Each change is a step: typing is grouped until a short pause, and a drag
  // counts once, when it ends. Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) outside text boxes.
  const snap = snapshot();
  const [hist, setHist] = useState<{ stack: string[]; idx: number }>(() => ({ stack: [snap], idx: 0 }));
  const histTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingNow = nodes.some((n) => n.dragging);
  const record = (s: string) =>
    setHist((h) => {
      if (h.stack[h.idx] === s) return h;
      const stack = [...h.stack.slice(0, h.idx + 1), s].slice(-80);
      return { stack, idx: stack.length - 1 };
    });
  useEffect(() => {
    if (draggingNow) return undefined;
    histTimer.current = setTimeout(() => record(snap), 350);
    return () => {
      if (histTimer.current) clearTimeout(histTimer.current);
    };
  }, [snap, draggingNow]); // eslint-disable-line react-hooks/exhaustive-deps
  const stroke = EDGE_COLOR[channel];
  function applySnap(str: string) {
    const o = JSON.parse(str) as {
      name: string;
      nodes: { id: string; type?: string; x: number; y: number; data: WaData }[];
      edges: { id: string; source: string; target: string; sourceHandle: string | null; targetHandle: string | null; label: string | null }[];
    };
    setName(o.name || '');
    setNodes(o.nodes.map((n) => ({ id: n.id, type: n.type || 'wa', position: { x: n.x, y: n.y }, data: n.data })));
    setEdges(o.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      ...(e.label ? { label: e.label } : {}),
      animated: true,
      style: { stroke, strokeWidth: 2 },
    })));
  }
  // A change not recorded yet (still typing) counts as the newest step.
  const pendingStep = hist.stack[hist.idx] !== snap;
  const canUndo = hist.idx > 0 || pendingStep;
  const canRedo = !pendingStep && hist.idx < hist.stack.length - 1;
  function undo() {
    if (histTimer.current) clearTimeout(histTimer.current);
    let { stack, idx } = hist;
    if (pendingStep) {
      stack = [...stack.slice(0, idx + 1), snap];
      idx = stack.length - 1;
    }
    if (idx <= 0) return;
    idx -= 1;
    applySnap(stack[idx]);
    setHist({ stack, idx });
  }
  function redo() {
    if (!canRedo) return;
    const idx = hist.idx + 1;
    applySnap(hist.stack[idx]);
    setHist((h) => ({ ...h, idx }));
  }
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      // Text boxes keep their own undo.
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      // Only while the journey is on screen (not under a dialog).
      if (document.querySelector('.disc-backdrop, .demo-backdrop, [role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * "Save draft" keeps the changes without touching what customers get;
   * "Publish" makes them live and clears the draft.
   */
  async function save(mode: 'draft' | 'publish') {
    setSaving(mode);
    setError(null);
    const title = name.trim() || 'Untitled journey';
    // `active` is always true now: journeys run unless Flows take over.
    const body: Partial<Journey> = mode === 'publish'
      ? { name: title, nodes, edges, active: true, draft: null }
      : { draft: { name: title, nodes, edges } };
    if (!savedId) {
      body.channel = channel;
      if (mode === 'draft') body.name = title;
    }
    try {
      const res = savedId ? await api.updateJourney(savedId, body) : await api.createJourney(body);
      setSavedId(res.data._id);
      // Saving is what clears "unsaved changes".
      baseline.current = snapshot();
      reclaim(baseline.current);
      if (mode === 'publish') {
        published.current = { name: title, nodes, edges };
        setHasPublished(true);
        setHasDraft(false);
        onSaved('Journey published. It now answers your customers.', res.data);
      } else {
        setHasDraft(true);
        onSaved(
          hasPublished ? 'Draft saved. Customers still get the published journey until you publish.' : 'Draft saved. It doesn’t reply to customers until you publish it.',
          res.data,
        );
      }
    } catch (e) {
      // Instagram / Messenger: the server lists what Meta wouldn't accept, block by block.
      const problems = ((e as { data?: { problems?: { message: string }[] } }).data?.problems || []).map((p) => p.message);
      setError({ message: (e as Error).message || 'The journey could not be saved.', problems: [...new Set(problems)].slice(0, 6) });
    } finally {
      setSaving('');
    }
  }

  /** Drop the draft (saved and unsaved changes) and go back to the published journey. */
  async function discardDraft() {
    if (!savedId || !hasPublished) return;
    const ok = await confirm({
      title: 'Discard the draft?',
      message: 'Your draft changes are deleted and the editor goes back to the published journey. Customers aren’t affected.',
      confirmLabel: 'Discard draft',
      tone: 'danger',
    });
    if (!ok) return;
    setSaving('discard');
    setError(null);
    try {
      const res = hasDraft ? await api.updateJourney(savedId, { draft: null }) : null;
      const p = published.current;
      const pub = snapshotOf(p.name, p.nodes, p.edges);
      applySnap(pub);
      baseline.current = pub;
      // Undo can't bring back the dropped draft (its photos may be deleted).
      if (histTimer.current) clearTimeout(histTimer.current);
      setHist({ stack: [pub], idx: 0 });
      reclaim(pub);
      setHasDraft(false);
      onSaved('Draft discarded. The editor shows the published journey.', res?.data);
    } catch (e) {
      setError({ message: (e as Error).message || 'The draft could not be discarded.', problems: [] });
    } finally {
      setSaving('');
    }
  }

  return (
    <div className="page journey-editor">
      <header className="page-head">
        {onBack && (
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <span className="material-icons">arrow_back</span>
          </button>
        )}
        <input className="flow-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Journey name" />
        <div className="flow-head-actions">
          <button className="k-btn ghost sm icon-only" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo" data-testid="jr-undo">
            <span className="material-icons">undo</span>
          </button>
          <button className="k-btn ghost sm icon-only" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo" data-testid="jr-redo">
            <span className="material-icons">redo</span>
          </button>
          {/* Nothing to save is worth saying out loud — it's the difference
              between "my work is stored" and "I forgot to press the button". */}
          {!dirty && hasDraft && (
            <span className="jr-saved draft" title="Your changes are saved as a draft. Customers get the published journey." data-testid="jr-draft-saved">
              <span className="material-icons">edit_note</span> Draft saved
            </span>
          )}
          {!dirty && !hasDraft && (
            <span className="jr-saved" title="Customers get this journey" data-testid="jr-published">
              <span className="material-icons">cloud_done</span> Published
            </span>
          )}
          {hasDraft && hasPublished && (
            <button className="k-btn ghost sm" onClick={discardDraft} disabled={!!saving} data-testid="jr-discard-draft" title="Go back to the published journey">
              <span className="material-icons">delete_outline</span> {saving === 'discard' ? 'Discarding…' : 'Discard draft'}
            </button>
          )}
          {dirty && (
            <button className="k-btn ghost sm" onClick={() => save('draft')} disabled={!!saving} data-testid="jr-save-draft" title="Save without changing what customers get">
              <span className="material-icons">edit_note</span> {saving === 'draft' ? 'Saving…' : 'Save draft'}
            </button>
          )}
          {(dirty || hasDraft) && (
            <button className="k-btn sm" onClick={() => save('publish')} disabled={!!saving} data-testid="jr-publish" title="Make this journey live for your customers">
              <span className="material-icons">publish</span> {saving === 'publish' ? 'Publishing…' : 'Publish'}
            </button>
          )}
        </div>
      </header>
      {(hasDraft || !hasPublished) && (
        <p className="jr-note draft" data-testid="jr-draft-note">
          <span className="material-icons">edit_note</span>
          <span>
            {hasPublished
              ? <>You’re editing a <b>draft</b>. Customers still get the published journey until you press <b>Publish</b>.</>
              : <>This journey isn’t published yet, so it doesn’t reply to customers. Press <b>Publish</b> when it’s ready{hasDraft ? '' : <>, or <b>Save draft</b> to finish it later</>}.</>}
          </span>
        </p>
      )}
      {channel !== 'whatsapp' && (connection === 'none' || connection === 'disconnected') && (
        <p className="jr-note warn" data-testid="jr-conn-note">
          <span className="material-icons">link_off</span>
          <span>
            {connection === 'none' ? `${CHANNEL_NAME[channel]} isn’t connected yet.` : `${CHANNEL_NAME[channel]} was disconnected at Meta.`} You can build the
            journey now; it starts answering {CHANNEL_NAME[channel]} chats once it’s connected on Channel Status.
          </span>
          {onNavigate && <button type="button" className="k-btn ghost sm" onClick={() => onNavigate('channel-status')}>Channel Status</button>}
        </p>
      )}
      {channel !== 'whatsapp' && (
        <p className="jr-note" data-testid="jr-window-note">
          <span className="material-icons">schedule</span>
          <span>
            Answers {CHANNEL_NAME[channel]} messages as they arrive (Meta allows replies within 24 hours of the customer’s message).
            A chat set to <b>Manual</b> in Chats is left to your team.
          </span>
        </p>
      )}
      {(() => {
        // The journey begins at its Start block: without one, or with Start
        // not wired to anything, nothing gets sent.
        const start = nodes.find((n) => n.data?.kind === 'start');
        if (start && edges.some((e) => e.source === start.id)) return null;
        return (
          <p className="jr-note warn" data-testid="jr-no-start">
            <span className="material-icons">play_arrow</span>
            <span>
              {start
                ? <>Connect the <b>Start</b> block to your first message: until then this journey doesn’t reply.</>
                : <>This journey has no <b>Start</b> block, so it doesn’t reply. Drag <b>Start</b> from the top of the blocks list and connect it to your first message.</>}
            </span>
          </p>
        );
      })()}
      {error && (
        <div className="jr-note err" role="alert" data-testid="jr-save-error">
          <span className="material-icons">error_outline</span>
          <div>
            <b>{error.message}</b>
            {error.problems.length > 1 && <ul>{error.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
        </div>
      )}
      <div className="page-body flows-page-body">
        <MediaCtx.Provider value={media}>
          <TemplatesCtx.Provider value={templates}>
            <ChannelCtx.Provider value={channel}>
              <ReactFlowProvider>
                <FlowCanvas
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  setNodes={setNodes}
                  setEdges={setEdges}
                />
              </ReactFlowProvider>
            </ChannelCtx.Provider>
          </TemplatesCtx.Provider>
        </MediaCtx.Provider>
      </div>
    </div>
  );
}

/**
 * Journeys: the canvas, straight away.
 *
 * This used to be a list with a + button, which meant two clicks and an empty
 * screen before a business could build anything. A tenant has one chatbot, so
 * the editor *is* the page: it loads the saved journey, or starts from the
 * seed layout if there isn't one yet, and saving updates that same journey.
 *
 * If several journeys exist from before this change, the most recent one is
 * the one edited — the others stay in the database untouched.
 */
const JOURNEY_CHANNELS: JourneyChannel[] = ['whatsapp', 'instagram', 'messenger'];
const JOURNEY_TAB_KEY = 'crm_journey_channel';
const channelOfJourney = (j: Journey): JourneyChannel => (j.channel === 'instagram' || j.channel === 'messenger' ? j.channel : 'whatsapp');

/**
 * One journey per channel, picked with the tabs on top (WhatsApp, Instagram,
 * Messenger). Each channel has its own blocks; a saved journey always answers
 * its chats (unless Flows take over WhatsApp, or a chat is set to Manual).
 */
function JourneyManager({
  api,
  templates,
  registerDirty,
  onNavigate,
}: {
  api: CrmApi;
  templates: TemplateItem[];
  registerDirty?: (fn: (() => boolean) | null) => void;
  onNavigate?: (view: any) => void;
}) {
  // The newest journey of each channel (older ones stay in the database untouched).
  const [byChannel, setByChannel] = useState<Partial<Record<JourneyChannel, Journey>> | null>(null);
  const [channel, setChannelState] = useState<JourneyChannel>(() => {
    try {
      const v = localStorage.getItem(JOURNEY_TAB_KEY) as JourneyChannel | null;
      return v && JOURNEY_CHANNELS.includes(v) ? v : 'whatsapp';
    } catch {
      return 'whatsapp';
    }
  });
  const [pending, setPending] = useState<JourneyChannel | null>(null);
  // '' = still checking. Instagram / Messenger stay locked until connected.
  const [conns, setConns] = useState<Record<'instagram' | 'messenger', '' | 'connected' | 'disconnected' | 'none'>>({ instagram: '', messenger: '' });
  // 'soon': waiting for Meta's approval (features.ts), whatever the connection.
  const lockOf = (c: JourneyChannel) => (c === 'whatsapp' ? '' : COMING_SOON[c] ? 'soon' : conns[c] === 'connected' ? '' : conns[c] || 'checking');
  const flash = useFlash();

  useEffect(() => {
    api
      .listJourneys()
      .then((r) => {
        const out: Partial<Record<JourneyChannel, Journey>> = {};
        for (const j of r.data || []) {
          const ch = channelOfJourney(j);
          if (!out[ch]) out[ch] = j; // the list is newest first
        }
        setByChannel(out);
      })
      .catch(() => setByChannel({}));
    api
      .getMetaChannels()
      .then((r) => {
        const st = (c: { status?: string } | null | undefined) => (!c ? 'none' : c.status === 'connected' ? 'connected' : 'disconnected');
        setConns({ instagram: st(r.connections?.instagram), messenger: st(r.connections?.messenger) });
      })
      // Couldn't check: treated as not connected (locked), like Channel Status would show it.
      .catch(() => setConns({ instagram: 'none', messenger: 'none' }));
  }, [api]);

  // Switching channel unmounts the editor: ask first when it has unsaved work.
  const childDirty = useRef<() => boolean>(() => false);
  const registerChildDirty = useCallback(
    (fn: (() => boolean) | null) => {
      childDirty.current = fn || (() => false);
      registerDirty?.(fn);
    },
    [registerDirty],
  );
  const setChannel = (c: JourneyChannel) => {
    setChannelState(c);
    try {
      localStorage.setItem(JOURNEY_TAB_KEY, c);
    } catch {
      /* ignore */
    }
  };
  function pick(c: JourneyChannel) {
    if (c === channel) return;
    if (childDirty.current()) setPending(c);
    else setChannel(c);
  }

  const tabs = (
    <div className="jr-channels" role="tablist" aria-label="Channel" data-testid="jr-channels">
      {JOURNEY_CHANNELS.map((c) => {
        const lock = lockOf(c);
        return (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={channel === c}
            className={`jr-channel ${c}${channel === c ? ' on' : ''}${lock && lock !== 'checking' ? ' locked' : ''}`}
            onClick={() => pick(c)}
            title={lock === 'soon' ? `${CHANNEL_NAME[c]} automation is coming soon` : lock === 'none' ? `Connect ${CHANNEL_NAME[c]} on Channel Status to build its automation` : lock === 'disconnected' ? `${CHANNEL_NAME[c]} was disconnected: reconnect it to build its automation` : undefined}
            data-testid={`jr-channel-${c}`}
            data-locked={lock && lock !== 'checking' ? 'true' : undefined}
            data-soon={lock === 'soon' ? 'true' : undefined}
          >
            <img src={CHANNEL_ICON[c]} alt="" />
            {CHANNEL_NAME[c]}
            {lock === 'soon' ? (
              <SoonPill />
            ) : lock && lock !== 'checking' ? (
              <span className="material-icons jr-channel-lock" aria-label="Locked">lock</span>
            ) : byChannel && (
              <span
                className={`jr-channel-dot${byChannel[c]?.nodes?.length ? ' on' : ''}`}
                title={byChannel[c]?.nodes?.length ? 'Journey published: it answers these chats' : byChannel[c] ? 'Draft only: not published yet' : 'No journey saved yet'}
              />
            )}
          </button>
        );
      })}
    </div>
  );

  if (!byChannel) {
    return (
      <div className="page">
        {tabs}
        <div className="page-body">
          <BladeSpinner center={true} containerHeight={300} />
        </div>
      </div>
    );
  }

  const lock = lockOf(channel);
  if (lock === 'checking') {
    return (
      <div className="page">
        {tabs}
        <div className="page-body">
          <BladeSpinner center={true} containerHeight={300} />
        </div>
      </div>
    );
  }
  if (lock === 'soon' && channel !== 'whatsapp') {
    return (
      <>
        {tabs}
        <ComingSoonPanel feature={channel} compact />
      </>
    );
  }
  if (lock) {
    const name = CHANNEL_NAME[channel];
    return (
      <>
        {tabs}
        <div className="jr-locked" data-testid="jr-locked">
          <img src={CHANNEL_ICON[channel]} alt="" />
          <span className="material-icons jr-locked-ic" aria-hidden="true">lock</span>
          <h3>{lock === 'disconnected' ? `${name} was disconnected` : `Connect ${name} to build its automation`}</h3>
          <p>
            {lock === 'disconnected'
              ? `Meta removed the CRM’s access to your ${name === 'Instagram' ? 'Instagram account' : 'Facebook Page'}. Reconnect it on Channel Status, then build and switch on the ${name} bot here.`
              : `The ${name} bot answers your ${name} chats with the blocks you build here. Connect your ${name === 'Instagram' ? 'Instagram professional account' : 'Facebook Page'} on Channel Status first.`}
          </p>
          {onNavigate && (
            <button type="button" className="k-btn" onClick={() => onNavigate(`channel-status:${channel}`)} data-testid="jr-locked-connect">
              <span className="material-icons" aria-hidden="true">link</span> {lock === 'disconnected' ? `Reconnect ${name}` : `Connect ${name}`}
            </button>
          )}
        </div>
      </>
    );
  }

  const journey = byChannel[channel] || null;
  return (
    <>
      {tabs}
      {/* Keyed on the channel and loaded id so the editor seeds itself once, from
          real data, rather than mounting empty and being re-seeded by a prop change. */}
      <JourneyEditor
        key={`${channel}:${journey?._id || 'new'}`}
        api={api}
        templates={templates}
        journey={journey}
        channel={channel}
        connection={channel === 'whatsapp' ? '' : conns[channel]}
        onSaved={(msg, saved) => {
          flash(msg);
          if (saved) setByChannel((m) => ({ ...(m || {}), [channel]: { ...saved, channel } }));
        }}
        registerDirty={registerChildDirty}
        onNavigate={onNavigate}
      />
      {pending && (
        <div className="disc-backdrop" onClick={() => setPending(null)}>
          <div className="disc-box" onClick={(e) => e.stopPropagation()} data-testid="jr-discard">
            <div className="disc-title">Discard changes?</div>
            <p className="disc-text">You have unsaved changes in the {CHANNEL_NAME[channel]} journey. Switching now loses them.</p>
            <div className="disc-actions">
              <button className="disc-cancel" onClick={() => setPending(null)}>Keep editing</button>
              <button
                className="disc-discard danger"
                onClick={() => {
                  childDirty.current = () => false;
                  registerDirty?.(null);
                  setChannel(pending);
                  setPending(null);
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function FlowsPage({
  api,
  canUseFlows = false,
  registerDirty,
  vertical,
  business: _business,
  demo: _demo,
  onNavigate,
}: {
  api: CrmApi;
  canUseFlows?: boolean;
  registerDirty?: (fn: (() => boolean) | null) => void;
  vertical?: VerticalConfig;
  business?: BusinessProfile;
  demo?: boolean;
  onNavigate?: (view: any) => void;
}) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  // 'flows' = native WhatsApp Flow builder, 'journeys' = chatbot node builder.
  // Journeys is the default: it's the one every business uses.
  const [tab, setTab] = useState<'flows' | 'journeys'>('journeys');
  // A pending switch, held while we ask about unsaved work.
  const [pendingTab, setPendingTab] = useState<'flows' | 'journeys' | null>(null);

  /**
   * Both builders live under this one page, so switching between them never
   * reached the shell's navigation guard — the shell only sees a *page* change.
   * The same question has to be asked here.
   */
  const childDirty = useRef<() => boolean>(() => false);
  const registerChildDirty = useCallback(
    (fn: (() => boolean) | null) => {
      childDirty.current = fn || (() => false);
      // Keep the shell informed too, so leaving the page entirely still asks.
      registerDirty?.(fn);
    },
    [registerDirty],
  );
  function switchTab(next: 'flows' | 'journeys') {
    if (next === tab) return;
    if (childDirty.current()) setPendingTab(next);
    else setTab(next);
  }
  useEffect(() => {
    api
      .getTemplates()
      .then((res) => setTemplates((res.data || []).filter((t) => t.status === 'APPROVED')))
      .catch(() => setTemplates([]));
  }, [api]);

  // Without the Flow builder there's nothing to switch between, so the tab bar
  // and its wrapper header go away entirely and Journeys owns the page.

  if (!canUseFlows) {
    return (
      <div className="page">
        {/* The top bar already says "Automation". */}
        <JourneyManager api={api} templates={templates} registerDirty={registerDirty} onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="flow-tabs">
          <button className={`flow-tab${tab === 'journeys' ? ' on' : ''}`} onClick={() => switchTab('journeys')}>
            <span className="material-icons">hub</span> Journeys
          </button>
          <button className={`flow-tab${tab === 'flows' ? ' on' : ''}`} onClick={() => switchTab('flows')}>
            <span className="material-icons">account_tree</span> Flows
          </button>
        </div>
      </header>
      {tab === 'flows' ? (
        <div className="page-body">
          <FlowBuilderPage api={api} registerDirty={registerChildDirty} vertical={vertical} />
        </div>
      ) : (
        <JourneyManager api={api} templates={templates} registerDirty={registerChildDirty} onNavigate={onNavigate} />
      )}

      {pendingTab && (
        <div className="disc-backdrop" onClick={() => setPendingTab(null)}>
          <div className="disc-box" onClick={(e) => e.stopPropagation()}>
            <div className="disc-title">Discard changes?</div>
            <p className="disc-text">
              You have unsaved changes here. Switching now loses them.
            </p>
            <div className="disc-actions">
              <button className="disc-cancel" onClick={() => setPendingTab(null)}>
                Keep editing
              </button>
              <button
                className="disc-discard danger"
                onClick={() => {
                  // The outgoing builder unmounts, so its probe must go with it
                  // or the shell would keep asking about work that's gone.
                  childDirty.current = () => false;
                  registerDirty?.(null);
                  setTab(pendingTab);
                  setPendingTab(null);
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
