// A single chat message bubble. Handles:
//  - media (image / video / audio / document) with a download button
//  - rich interactive messages (header image/text + body + footer + buttons/CTA)
//    rendered as ONE unified card (WhatsApp "rich message" style)
//  - plain text
//  - delivery/read ticks + emoji reaction chip + the reaction picker trigger
import { AppIcon, DownloadIcon } from './AppIcons';
import { FormAnswer } from './FormAnswer';
import { memo, useState } from 'react';
import type { CrmApi } from '../api';
import type { ChatMessage, EventRecord, PollRecord } from '../types';
import {
  outboundOf,
  mediaOf,
  mediaCaption,
  timeHHmm,
  btnIcon,
  hasActions,
  money,
  mapsLink,
  downloadFile,
  formOf,
  orderOf,
  reactionsOf,
  ownReactionOf,
  jumboEmojiCount,
} from '../utils';
import { ReactionPicker } from './ReactionPicker';
import { ReactionDetails, type ReactionPerson } from './ReactionDetails';
import { LocationMap } from './LocationMap';

export function MsgReplySvg({ width = 18, height = 18 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8.5 5L3 9.5L8.5 14V11.5H11C14.0376 11.5 16.5 13.9624 16.5 17C17.5 12.5 14.5 8.5 10.5 8.5H8.5V5Z" stroke="#000000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function MsgEmojiSvg({ width = 18, height = 18 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" stroke="#000000" strokeWidth="1.5"/>
      <circle cx="7.5" cy="8" r="0.9" fill="#000000"/>
      <circle cx="12.5" cy="8" r="0.9" fill="#000000"/>
      <path d="M6.5 11.5C7.3 13.2 8.5 14 10 14C11.5 14 12.7 13.2 13.5 11.5" stroke="#000000" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function CatalogActionSvg({ className = 'tc-wa-act-icon tc-wa-catalog-icon', width = 16, height = 14 }: { className?: string; width?: number; height?: number }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox="0 0 16 14" fill="none" aria-label="Catalog">
      <path fillRule="evenodd" clipRule="evenodd" d="M15.2823 5.28027V5.57615C15.2823 6.2422 14.6043 7.15761 13.7679 7.15761C12.9844 7.15761 12.3477 6.30672 12.2695 5.69965C12.1905 6.30672 11.5539 7.15761 10.7707 7.15761C9.98669 7.15761 9.35041 6.30672 9.27184 5.69965C9.19328 6.30672 8.55659 7.15761 7.773 7.15761C6.98901 7.15761 6.35273 6.30672 6.27417 5.69965C6.19601 6.30672 5.55891 7.15761 4.77533 7.15761C3.99174 7.15761 3.35546 6.30672 3.2769 5.69965C3.19833 6.30672 2.56124 7.15761 1.77806 7.15761C0.941689 7.15761 0.263672 6.2422 0.263672 5.57615V5.28027H15.2823Z" fill="#353735"></path>
      <path d="M0.616211 8.09643V11.8511C0.616211 12.6935 1.29913 13.3764 2.14154 13.3764H9.65088C10.4933 13.3764 11.1762 12.6935 11.1762 11.8511V8.09643C11.1762 7.77243 10.9136 7.50977 10.5895 7.50977C10.2655 7.50977 10.0029 7.77243 10.0029 8.09643V11.8511C10.0029 12.0455 9.84528 12.2031 9.65088 12.2031H2.14154C1.94714 12.2031 1.78954 12.0455 1.78954 11.8511V8.09643C1.78954 7.77243 1.52688 7.50977 1.20288 7.50977C0.878871 7.50977 0.616211 7.77243 0.616211 8.09643Z" fill="#353735"></path>
      <path d="M0.908737 1.08736L0.0646314 3.90336C-0.177253 4.71031 0.280819 5.56055 1.08776 5.80244C1.22985 5.84503 1.3774 5.86667 1.52573 5.86667H14.0218C14.8642 5.86667 15.5471 5.18375 15.5471 4.34133C15.5471 4.193 15.5255 4.04545 15.4829 3.90336L14.6388 1.08736C14.4454 0.442005 13.8514 0 13.1777 0H2.36984C1.74103 0 1.18173 0.385035 0.952672 0.961073L0.908737 1.08736ZM2.03266 1.42426C2.0773 1.27533 2.21437 1.17333 2.36984 1.17333H13.1777C13.3332 1.17333 13.4702 1.27533 13.5149 1.42426L14.359 4.24026C14.3688 4.27305 14.3738 4.3071 14.3738 4.34133C14.3738 4.53574 14.2162 4.69333 14.0218 4.69333H1.52573C1.4915 4.69333 1.45745 4.68834 1.42466 4.67851C1.23845 4.62269 1.13274 4.42648 1.18856 4.24026L2.03266 1.42426Z" fill="#353735"></path>
      <path fillRule="evenodd" clipRule="evenodd" d="M13.8777 7.53516C14.1887 7.53516 14.4409 7.78731 14.4409 8.09836V12.7917C14.4409 13.1027 14.1887 13.3549 13.8777 13.3549C13.5666 13.3549 13.3145 13.1027 13.3145 12.7917V8.09836C13.3145 7.78731 13.5666 7.53516 13.8777 7.53516Z" fill="#353735"></path>
    </svg>
  );
}

/** WhatsApp's "sending" ring over a photo / video that is still uploading. */
function UploadSpinner() {
  return (
    <span className="media-uploading" role="status" aria-label="Sending" data-testid="media-uploading">
      <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
        <circle cx="24" cy="24" r="22" fill="rgba(11, 20, 26, 0.45)" />
        <circle className="media-uploading-arc" cx="24" cy="24" r="15" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeDasharray="70 100" />
      </svg>
    </span>
  );
}

export function MessageStatusTick({ status }: { status: string }) {
  if (status === 'read') {
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="tick-svg tick-read" aria-label="Read">
        <path d="M1.5 10.5L5.5 14.5L12 7.5" stroke="#53bdeb" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M8 10.5L12 14.5L18.5 7.5" stroke="#53bdeb" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  if (status === 'delivered') {
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="tick-svg tick-delivered" aria-label="Delivered">
        <path d="M1.5 10.5L5.5 14.5L12 7.5" stroke="#667781" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M8 10.5L12 14.5L18.5 7.5" stroke="#667781" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  // 'sent' or default single tick
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="tick-svg tick-sent" aria-label="Sent">
      <path d="M1.5 10.5L5.5 14.5L12 7.5" stroke="#667781" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/** Parse links and WhatsApp markdown (*bold*, _italic_, ~strike~, `code`) in message text. */
function formatMessageText(text: string): React.ReactNode {
  if (!text) return null;
  const tokenRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|www\.[^\s<]+[^<.,:;"')\]\s]|\*[^*\n]+?\*|_[^_\n]+?_|~[^~\n]+?~|`[^`\n]+?`)/g;
  const parts = text.split(tokenRegex);
  if (parts.length === 1 && !parts[0].match(tokenRegex)) {
    return text;
  }
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.match(/^(https?:\/\/|www\.)/i)) {
      const href = part.toLowerCase().startsWith('http') ? part : `https://${part}`;
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="msg-link"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      const inner = part.slice(1, -1);
      if (!inner.startsWith(' ') && !inner.endsWith(' ')) {
        return <strong key={i} className="msg-bold">{inner}</strong>;
      }
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
      const inner = part.slice(1, -1);
      if (!inner.startsWith(' ') && !inner.endsWith(' ')) {
        return <em key={i} className="msg-italic">{inner}</em>;
      }
    }
    if (part.startsWith('~') && part.endsWith('~') && part.length > 2) {
      const inner = part.slice(1, -1);
      if (!inner.startsWith(' ') && !inner.endsWith(' ')) {
        return <del key={i} className="msg-strike">{inner}</del>;
      }
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const inner = part.slice(1, -1);
      return <code key={i} className="msg-code">{inner}</code>;
    }
    return part;
  });
}

const formatLinks = formatMessageText;

/** A poll sent from the chat, with the customer's answer (it's a 1:1 chat). */
function PollCard({ poll }: { poll: PollRecord }) {
  const votes = new Set(poll.votes || []);
  const answered = votes.size > 0;
  return (
    <div className="poll-card">
      <div className="poll-q">{poll.question}</div>
      <div className="poll-hint">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
          <path d="M4 18c0-.55.2-1.02.59-1.41.39-.4.86-.59 1.41-.59h3c.55 0 1.02.2 1.41.59.4.39.59.86.59 1.41 0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59H6c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41Zm0-6c0-.55.2-1.02.59-1.41.39-.4.86-.59 1.41-.59h12c.55 0 1.02.2 1.41.59.4.39.59.86.59 1.41 0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59H6c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41Zm0-6c0-.55.2-1.02.59-1.41C4.98 4.19 5.45 4 6 4h7c.55 0 1.02.2 1.41.59.4.39.59.86.59 1.41 0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59H6c-.55 0-1.02-.2-1.41-.59C4.19 7.02 4 6.55 4 6Z" />
        </svg>
        {poll.multiple ? 'Select one or more' : 'Select one'}
      </div>
      <ul className="poll-options">
        {poll.options.map((o, i) => {
          const on = votes.has(i);
          return (
            <li key={i} className={`poll-opt${on ? ' on' : ''}`} data-testid="poll-opt">
              <span className={`poll-mark${poll.multiple ? ' sq' : ''}`} aria-hidden="true">
                {on && (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 11-11-1.4-1.4z" /></svg>
                )}
              </span>
              <span className="poll-opt-main">
                <span className="poll-opt-row">
                  <span className="poll-opt-text">{o}</span>
                  <span className="poll-opt-n">{on ? 1 : 0}</span>
                </span>
                <span className="poll-bar"><span style={{ width: on ? '100%' : '0%' }} /></span>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="poll-foot" data-testid="poll-status">
        {answered
          ? `Answered${poll.answeredAt ? ` · ${timeHHmm(poll.answeredAt)}` : ''}`
          : 'Waiting for their answer'}
      </div>
    </div>
  );
}

/** An event sent from the chat: what, when, where, and its calendar / call links. */
function EventCard({ ev }: { ev: EventRecord }) {
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: ev.timeZone || undefined,
  });
  const start = new Date(ev.start);
  const dayKeyOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: ev.timeZone || undefined });
  const endText = !ev.end ? ''
    : dayKeyOf(ev.end) === dayKeyOf(ev.start)
      ? new Date(ev.end).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: ev.timeZone || undefined })
      : fmt(ev.end);
  return (
    <div className="event-card">
      <div className="event-head">
        <span className="event-date" aria-hidden="true">
          <span className="event-mon">{start.toLocaleString('en-IN', { month: 'short', timeZone: ev.timeZone || undefined })}</span>
          <span className="event-day">{start.toLocaleString('en-IN', { day: 'numeric', timeZone: ev.timeZone || undefined })}</span>
        </span>
        <div className="event-main">
          <div className="event-name">{ev.name}</div>
          <div className="event-when" data-testid="event-when">{fmt(ev.start)}{endText ? ` – ${endText}` : ''}</div>
          {ev.location && (
            <div className="event-where">
              <span className="material-icons" aria-hidden="true">place</span>
              {ev.location}
            </div>
          )}
        </div>
      </div>
      {ev.description && <div className="event-desc">{ev.description}</div>}
      <div className="event-links">
        {ev.calendarUrl && (
          <a href={ev.calendarUrl} target="_blank" rel="noopener noreferrer" className="event-link">
            <span className="material-icons" aria-hidden="true">event</span>
            Add to calendar
          </a>
        )}
        {ev.callUrl && (
          <a href={ev.callUrl} target="_blank" rel="noopener noreferrer" className="event-link">
            <span className="material-icons" aria-hidden="true">call</span>
            WhatsApp call link
          </a>
        )}
      </div>
    </div>
  );
}

/** A call entry (type 'call') or a call permission answer (type 'call_permission'). */
function CallLine({ m }: { m: ChatMessage }) {
  if (m.type === 'call_permission') {
    const yes = m.raw?.callPermission?.response !== 'reject';
    return (
      <div className="call-row" data-msg-id={m._id} data-testid="call-permission-line">
        <div className={`call-chip perm${yes ? '' : ' no'}`}>
          <span className="call-ico"><span className="material-icons">{yes ? 'phone_enabled' : 'phone_disabled'}</span></span>
          <span className="call-text">
            <span className="call-title">{m.body || (yes ? 'Allowed calls' : 'Declined calls')}</span>
            <span className="call-sub">{timeHHmm(m.createdAt)}</span>
          </span>
        </div>
      </div>
    );
  }
  const c = m.raw?.call;
  const state = c?.state || 'ended';
  const inbound = (c?.direction || m.direction) === 'in';
  const icon = state === 'missed' ? 'phone_missed'
    : state === 'declined' || state === 'failed' || state === 'no_answer' ? 'phone_disabled'
      : state === 'ringing' || state === 'answered' ? 'phone_in_talk'
        : inbound ? 'call_received' : 'call_made';
  const title = m.body || 'Voice call';
  return (
    <div className="call-row" data-msg-id={m._id} data-testid="call-line">
      <div className={`call-chip ${state}`} title={c?.error?.message || undefined}>
        <span className="call-ico"><span className="material-icons">{icon}</span></span>
        <span className="call-text">
          <span className="call-title">{title}</span>
          <span className="call-sub">WhatsApp voice call · {timeHHmm(m.createdAt)}</span>
        </span>
      </div>
    </div>
  );
}

interface Props {
  message: ChatMessage;
  api: CrmApi;
  reacting: boolean;
  onToggleReact: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, emoji: string) => void;
  onCloseReact: () => void;
  onReply: (m: ChatMessage) => void;
  onJumpTo: (id?: string) => void;
  onViewMedia: (media: { url: string; pdf: boolean; name?: string }) => void;
  /** Re-send a message that failed to go out (only offered when provided). */
  onRetry?: (m: ChatMessage) => void;
  /** Who is who in the reactions panel: the customer, and the business ("You"). */
  people?: { customer: ReactionPerson; you: ReactionPerson };
}

// Memoised: a bubble redraws only when its own message (or the reaction
// picker on it) changes, not when the rest of the chat re-renders.
export const MessageItem = memo(function MessageItem({
  message: m,
  api,
  reacting,
  onToggleReact,
  onReact,
  onCloseReact,
  onReply,
  onJumpTo,
  onViewMedia,
  onRetry,
  people,
}: Props) {
  // The reactions panel ("2 reactions"), anchored to the chip that opened it.
  const [whoAnchor, setWhoAnchor] = useState<HTMLElement | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  // A video shows its first frame with a play button until it's started.
  const [videoOn, setVideoOn] = useState(false);
  const [videoSecs, setVideoSecs] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const md = mediaOf(m);
  const d = outboundOf(m);
  const order = orderOf(m);
  const payment = m.raw?.payment || null;
  const location = m.raw?.location || null;
  const form = formOf(m);
  const caption = mediaCaption(m);
  const failed = m.direction === 'out' && m.status === 'failed';
  // A file still uploading from this browser: shown from the local copy.
  const uploadingMedia = m.status === 'pending' && !!m.raw?.localUpload;
  const tpl = d ? m.raw?.template || null : null;

  // A rich card = an interactive message with a media/text header, or any buttons/CTA.
  const isRich =
    !md &&
    !order &&
    !payment &&
    !location &&
    !form &&
    !!d &&
    // A sent template always renders as the card the customer saw.
    (!!tpl || !!d.headerImageUrl || !!d.headerText || !!d.headerDocName || hasActions(d));

  const quote = m.raw?.replyTo;
  const quoteBlock = quote ? (
    <button
      type="button"
      className="reply-quote"
      onClick={() => onJumpTo(quote.id)}
      title="View replied message"
    >
      <div className="rq-author">{quote.author}</div>
      <div className="rq-text">{quote.preview}</div>
    </button>
  ) : null;

  // Reactions, as WhatsApp shows them: each emoji once, then the count when
  // both the customer and the business reacted ("😂 ❤️ 2").
  const reactions = reactionsOf(m);
  const reactionChip = reactions.length ? (
    <button
      type="button"
      className="reaction-chip"
      onClick={(e) => setWhoAnchor(whoAnchor ? null : e.currentTarget)}
      aria-label={`${reactions.length} reaction${reactions.length === 1 ? '' : 's'}: see who reacted`}
      title={reactions.map((r) => (r.by === 'you' ? `You: ${r.emoji}` : r.by === 'customer' ? `Customer: ${r.emoji}` : r.emoji)).join(' · ')}
      data-testid="reaction-chip"
    >
      {[...new Set(reactions.map((r) => r.emoji))].join(' ')}
      {reactions.length > 1 && <span className="reaction-count">{reactions.length}</span>}
    </button>
  ) : null;

  // Only emoji (1–3) and nothing else: shown large without a bubble, like WhatsApp.
  const plainText = d && d.body ? d.body : m.body;
  const jumbo = !md && !quote && !isRich ? jumboEmojiCount(plainText) : 0;
  // A photo or video without a caption: it fills the bubble and the time and
  // ticks sit on it, bottom-right (WhatsApp style). With a caption, the
  // caption and time go under it as before.
  const mediaOnly = !!md && !mediaFailed && !quote && !caption && (md.type === 'image' || md.type === 'video');

  const metaRow = (
    <span className="meta">
      {timeHHmm(m.createdAt)}
      {m.direction === 'out' &&
        (m.status === 'pending' ? (
          <span className="material-icons ticks pending" aria-label="Sending">
            schedule
          </span>
        ) : failed ? (
          <span className="ticks failed" title="Failed">!</span>
        ) : (
          <span className={`ticks${m.status === 'read' ? ' read' : ''}`}>
            <MessageStatusTick status={m.status} />
          </span>
        ))}
    </span>
  );

  // A WhatsApp call, or the customer's answer to "Allow calls?": a centred
  // line in the thread, like WhatsApp's call entries.
  if (m.type === 'call' || m.type === 'call_permission') {
    return <CallLine m={m} />;
  }

  return (
    <div
      className={`msg ${m.direction === 'out' ? 'out' : 'in'}${m.status === 'pending' ? ' pending' : ''}${failed ? ' failed' : ''}`}
      data-msg-id={m._id}
    >
      <div className="msg-col">
        {m.raw?.poll ? (
          <div className="bubble poll-bubble" data-testid="poll-card">
            {quoteBlock}
            <PollCard poll={m.raw.poll} />
            {metaRow}
            {reactionChip}
          </div>
        ) : m.raw?.event ? (
          <div className="bubble event-bubble" data-testid="event-card">
            {quoteBlock}
            <EventCard ev={m.raw.event} />
            {metaRow}
            {reactionChip}
          </div>
        ) : location ? (
          <div className="bubble loc-bubble">
            <a
              className="loc-map"
              href={mapsLink(location.latitude, location.longitude)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in Google Maps"
            >
              {location.mapUrl ? (
                <img className="loc-map-img" src={location.mapUrl} alt="Map of the shared location" loading="lazy" />
              ) : (
                <LocationMap lat={Number(location.latitude)} lng={Number(location.longitude)} />
              )}
            </a>
            {(() => {
              // WhatsApp labels a pin with its place. A saved place carries its
              // own name/address; a dropped pin gets the looked-up address.
              const resolved = location.resolvedAddress || '';
              const title = location.name || resolved.split(',')[0] || 'Shared location';
              const sub = location.name
                ? location.address || ''
                : resolved.split(',').slice(1).join(',').trim();
              return (
                <div className="loc-info">
                  <span className="material-icons">location_on</span>
                  <div className="loc-text">
                    <div className="loc-name">{title}</div>
                    {sub && <div className="loc-addr">{sub}</div>}
                  </div>
                </div>
              );
            })()}
            {metaRow}
            {reactionChip}
          </div>
        ) : payment ? (
          <div className="pay-wrap">
            {/* Order summary block */}
            <div className="pay-summary">
              <div className="pay-order-id">Order #{payment.orderId}</div>
              {payment.items.map((it, i) => (
                <div className="pay-item" key={i}>
                  {it.image ? (
                    <img className="pi-img" src={it.image} alt="" loading="lazy" />
                  ) : (
                    <div className="pi-img placeholder" />
                  )}
                  <div className="pi-main">
                    <div className="pi-name">{it.name}</div>
                    <div className="pi-qty">Quantity {it.qty}</div>
                  </div>
                </div>
              ))}
              <div className="pay-total">
                <span>Total</span>
                <span>{money(payment.total, payment.currency)}</span>
              </div>
            </div>

            {/* WhatsApp Pay block */}
            <div className="pay-card">
              <div className="pay-head">
                <span className="material-icons">receipt_long</span>
                <div className="pay-title">Order #{payment.orderId}</div>
              </div>
              <div className="pay-body">{payment.body}</div>
              <div className="pay-foot-row">
                <span className="pay-foot">{payment.footer || 'Powered by WhatsApp Pay'}</span>
                {metaRow}
              </div>
              {payment.status === 'paid' ? (
                <div className="pay-buttons">
                  <span className="pay-btn paid">
                    <span className="material-icons">check_circle</span> Paid
                  </span>
                </div>
              ) : payment.status === 'failed' ? (
                <div className="pay-buttons">
                  <span className="pay-btn failed">Payment not completed</span>
                </div>
              ) : (
                <div className="pay-buttons">
                  <span className="pay-btn">Review and pay</span>
                  <span className="pay-btn">Pay now</span>
                </div>
              )}
            </div>

            {reactionChip}
          </div>
        ) : order ? (
          <div className="bubble order-bubble">
            <div className="order-head">
              <span className="material-icons">receipt_long</span>
              Order · {order.items.length} item{order.items.length !== 1 ? 's' : ''}
            </div>
            <div className="order-items">
              {order.items.map((it, i) => (
                <div className="order-item" key={i}>
                  {it.image ? (
                    <img className="oi-img" src={it.image} alt="" loading="lazy" />
                  ) : (
                    <div className="oi-img placeholder" />
                  )}
                  <div className="oi-main">
                    <div className="oi-name">
                      {it.name}
                      {it.variantLabel ? ` · ${it.variantLabel}` : ''}
                    </div>
                    <div className="oi-qty">
                      {it.qty} × {money(it.price, it.currency)}
                    </div>
                  </div>
                  <div className="oi-total">{money(it.lineTotal, it.currency)}</div>
                </div>
              ))}
            </div>
            <div className="order-total">
              <span>Total</span>
              <span>{money(order.total, order.currency)}</span>
            </div>
            {order.note && <div className="order-note">{order.note}</div>}
            {metaRow}
            {reactionChip}
          </div>
        ) : form ? (
          <div className="bubble form-bubble">
            <div className="form-head">
              <span className="material-icons">assignment_turned_in</span>
              <span className="form-title">{form.flowName || 'Form submitted'}</span>
            </div>
            <table className="form-table">
              <tbody>
                {form.rows.map((r) => (
                  <tr key={r.key} data-type={r.type || 'text'}>
                    <th scope="row">{r.label}</th>
                    <td><FormAnswer row={r} onView={onViewMedia} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {metaRow}
            {reactionChip}
          </div>
        ) : isRich && d ? (
          <div className="rich-card">
            {d.headerDocName ? (
              <button
                type="button"
                className="rich-doc"
                onClick={() =>
                  d.headerDocUrl &&
                  onViewMedia({ url: d.headerDocUrl, pdf: true, name: d.headerDocName })
                }
              >
                <span className="rich-doc-icon">PDF</span>
                <div className="rich-doc-text">
                  <div className="rich-doc-name">{d.headerDocName}</div>
                  <div className="rich-doc-sub">{d.headerDocSize || 'Document'}</div>
                </div>
              </button>
            ) : d.headerImageUrl ? (
              <img
                className="rich-media clickable"
                src={d.headerImageUrl}
                alt=""
                loading="lazy"
                onClick={() => onViewMedia({ url: d.headerImageUrl!, pdf: false })}
              />
            ) : d.headerVideoUrl ? (
              <video className="rich-media" src={d.headerVideoUrl} controls preload="metadata" />
            ) : null}

            {d.headerText && <div className="rich-header-text">{d.headerText}</div>}
            {tpl?.lto && (
              <div className="rich-offer">
                <span className="material-icons rich-offer-ic">redeem</span>
                <div className="rich-offer-main">
                  <div className="rich-offer-title">{tpl.lto.text}</div>
                  {tpl.lto.expiresAtMs ? (
                    <div className="rich-offer-ends">
                      Ends{' '}
                      {new Date(tpl.lto.expiresAtMs).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                      })}
                    </div>
                  ) : null}
                  {tpl.lto.code && <div className="rich-offer-code">{tpl.lto.code}</div>}
                </div>
              </div>
            )}
            {d.body && <div className="rich-body">{formatLinks(d.body)}</div>}
            {d.footer && <div className="rich-foot">{d.footer}</div>}
            <div className="rich-meta">{metaRow}</div>

            {hasActions(d) && (
              <div className="rich-buttons">
                {(d.buttons || []).map((b, i) => {
                  if (b.kind === 'call') {
                    return (
                      <a className="rich-btn" key={i} href={`tel:${b.url || b.text}`}>
                        <AppIcon name={btnIcon(b.kind)} /> {b.text}
                      </a>
                    );
                  }
                  if (b.kind === 'cta' && b.url) {
                    return (
                      <a
                        className="rich-btn"
                        key={i}
                        href={b.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span className="material-icons">open_in_new</span> {b.text}
                      </a>
                    );
                  }
                  const isCatalog = b.kind === 'catalog' || b.kind === 'mpm' || /catalog|items?/i.test(b.text);
                  if (isCatalog) {
                    return (
                      <span className="rich-btn catalog" key={i}>
                        <CatalogActionSvg /> {b.text}
                      </span>
                    );
                  }
                  return (
                    <span className="rich-btn" key={i}>
                      <AppIcon name={btnIcon(b.kind)} /> {b.text}
                    </span>
                  );
                })}
                {d.cta && (
                  <a
                    className="rich-btn"
                    href={d.cta.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="material-icons">open_in_new</span> {d.cta.text}
                  </a>
                )}
              </div>
            )}

            {reactionChip}
          </div>
        ) : (
          <div
            className={`bubble${jumbo ? ` jumbo n${jumbo}` : md && !mediaFailed ? (mediaOnly ? ` media-only${videoOn ? ' media-playing' : ''}` : md.type === 'image' || md.type === 'video' ? ' media-caption' : '') : ' inline-meta'}${reactions.length ? ' has-reaction' : ''}`}
            data-testid={mediaOnly ? 'media-only-bubble' : undefined}
          >
            {quoteBlock}
            {jumbo ? (
              <span className="text jumbo-text" data-testid="jumbo-emoji">{plainText.trim()}</span>
            ) : md && !mediaFailed ? (
              <>
                {renderMedia()}
                {caption && <span className="text">{formatLinks(caption)}</span>}
              </>
            ) : (
              // Plain text: the time sits at the bottom-right of the last line
              // (WhatsApp style). The spacer reserves room for it, so it only
              // drops to its own line when the last line is too full.
              <span className="text">
                {formatLinks(plainText)}
                <span className="meta-spacer" aria-hidden="true" />
              </span>
            )}
            {metaRow}
            {reactionChip}
          </div>
        )}

        {/* Carousel template: the swipeable cards under the message, as in WhatsApp. */}
        {tpl?.cards && tpl.cards.length > 0 && (
          <div className="msg-cards" aria-label="Carousel cards">
            {tpl.cards.map((c, i) => (
              <div className="msg-card" key={i}>
                {c.mediaUrl ? (
                  c.mediaFormat === 'video' ? (
                    <video className="msg-card-media" src={c.mediaUrl} controls preload="metadata" />
                  ) : (
                    <img
                      className="msg-card-media clickable"
                      src={c.mediaUrl}
                      alt=""
                      loading="lazy"
                      onClick={() => onViewMedia({ url: c.mediaUrl, pdf: false })}
                    />
                  )
                ) : (
                  <div className="msg-card-media ph">
                    <span className="material-icons">image</span>
                  </div>
                )}
                {c.body && <div className="msg-card-body">{c.body}</div>}
                {c.buttons.length > 0 && (
                  <div className="msg-card-btns">
                    {c.buttons.map((b, j) =>
                      b.kind === 'cta' && b.url ? (
                        <a className="msg-card-btn" key={j} href={b.url} target="_blank" rel="noopener noreferrer">
                          <span className="material-icons">open_in_new</span> {b.text}
                        </a>
                      ) : b.kind === 'catalog' || b.kind === 'mpm' || /catalog|items?/i.test(b.text) ? (
                        <span className="msg-card-btn catalog" key={j}>
                          <CatalogActionSvg /> {b.text}
                        </span>
                      ) : (
                        <span className="msg-card-btn" key={j}>
                          <AppIcon name={btnIcon(b.kind)} /> {b.text}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {failed && (
          <div
            className="msg-failed"
            title={m.error ? [m.error.code ? `Error ${m.error.code}` : '', m.error.message, m.error.details].filter(Boolean).join(' · ') : undefined}
          >
            <span className="material-icons">error</span>
            Not delivered
            {m.error && (m.error.title || m.error.message) && (
              <span className="msg-failed-reason"> · {m.error.title || m.error.message}</span>
            )}
            {onRetry && (
              <button
                type="button"
                className={`msg-retry-btn${retrying ? ' spinning' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setRetrying(true);
                  setTimeout(() => setRetrying(false), 600);
                  onRetry(m);
                }}
                title="Retry sending"
                aria-label="Retry sending"
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M16.2 8A6.5 6.5 0 0 0 5 5.1L3.5 6.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3.5 3.5V6.8H6.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3.8 12A6.5 6.5 0 0 0 15 14.9L16.5 13.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M16.5 16.5V13.2H13.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        )}

        {m.metaMessageId && (
          <div className="msg-tools">
            <button className="tool-btn" onClick={() => onReply(m)} title="Reply">
              <MsgReplySvg width={18} height={18} />
            </button>
            <button className="tool-btn" onClick={() => onToggleReact(m)} title="React">
              <MsgEmojiSvg width={18} height={18} />
            </button>
          </div>
        )}

        {whoAnchor && reactions.length > 0 && (
          <ReactionDetails
            anchor={whoAnchor}
            reactions={reactions}
            customer={people?.customer || { name: m.name || `+${m.phone}` }}
            you={people?.you || { name: 'You' }}
            side={m.direction === 'out' ? 'out' : 'in'}
            onRemove={() => onReact(m, '')}
            onClose={() => setWhoAnchor(null)}
          />
        )}

        {reacting && (
          <ReactionPicker
            direction={m.direction}
            hasReaction={!!ownReactionOf(m)}
            onPick={(e) => onReact(m, e)}
            onClose={onCloseReact}
          />
        )}
      </div>
    </div>
  );

  function renderMedia() {
    if (!md || mediaFailed) return null;
    const dl = api.downloadUrl(md.url, md.filename);
    // A file sent from this browser keeps showing its local copy (no reload flash).
    const shownUrl = m.raw?.localPreview || md.url;
    switch (md.type) {
      case 'image':
        return (
          <div className="media-wrap">
            <img
              className="bubble-media clickable"
              src={shownUrl}
              alt=""
              loading="lazy"
              onError={() => setMediaFailed(true)}
              onClick={() => onViewMedia({ url: shownUrl, pdf: false })}
            />
            {uploadingMedia && <UploadSpinner />}
          </div>
        );
      case 'video':
        return (
          <div className="media-wrap">
            <video
              className="bubble-media"
              // #t=0.1: the first frame as the preview, before it's played.
              src={videoOn ? shownUrl : `${shownUrl}#t=0.1`}
              preload="metadata"
              playsInline
              controls={videoOn}
              autoPlay={videoOn}
              onLoadedMetadata={(e) => setVideoSecs(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
              onError={() => setMediaFailed(true)}
            />
            {uploadingMedia && <UploadSpinner />}
            {!videoOn && !uploadingMedia && (
              <>
                <button type="button" className="vid-play" onClick={() => setVideoOn(true)} aria-label="Play video" data-testid="video-play">
                  <span className="material-icons">play_arrow</span>
                </button>
                {videoSecs > 0 && (
                  <span className="vid-dur">
                    <span className="material-icons">videocam</span>
                    {`${Math.floor(videoSecs / 60)}:${String(Math.floor(videoSecs % 60)).padStart(2, '0')}`}
                  </span>
                )}
              </>
            )}
            <button
              className="dl-btn"
              onClick={() => downloadFile(dl, md.filename)}
              title="Download"
            >
              <DownloadIcon />
            </button>
          </div>
        );
      case 'audio':
        return (
          <div className={`audio-wrap${m.raw?.voicemail ? ' voicemail' : ''}`}>
            {m.raw?.voicemail && (
              <span className="vm-label" data-testid="voicemail-label">
                <span className="material-icons" aria-hidden="true">voicemail</span>
                Voicemail
              </span>
            )}
            <span className={`audio-kind material-icons${md.voice ? ' voice' : ''}`}>
              {md.voice ? 'mic' : 'headphones'}
            </span>
            <audio className="bubble-audio" src={shownUrl} controls onError={() => setMediaFailed(true)} />
            <button
              className="dl-btn inline"
              onClick={() => downloadFile(dl, md.filename)}
              title="Download"
            >
              <DownloadIcon />
            </button>
          </div>
        );
      default: {
        const name = md.filename || 'Document';
        const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || 'file').toUpperCase();
        const isPdf = ext === 'PDF';
        const faceInner = (
          <>
            <span className={`doc-icon ${isPdf ? 'pdf' : ''}`}>{ext.slice(0, 4)}</span>
            <div className="doc-meta">
              <div className="doc-name">{name}</div>
              <div className="doc-sub">{ext} document</div>
            </div>
          </>
        );
        return (
          <div className="doc-card">
            {isPdf ? (
              <button
                type="button"
                className="doc-face"
                onClick={() => onViewMedia({ url: md.url, pdf: true, name })}
              >
                {faceInner}
              </button>
            ) : (
              <a className="doc-face" href={dl} target="_blank" rel="noopener noreferrer">
                {faceInner}
              </a>
            )}
            <button className="doc-dl" onClick={() => downloadFile(dl, name)} title="Download">
              <DownloadIcon />
            </button>
          </div>
        );
      }
    }
  }
});
