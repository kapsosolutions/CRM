// -----------------------------------------------------------------------------
// Live CRM feed over Socket.IO. Mirrors the backend eventBus events:
//   crm:message   — inbound/outbound message
//   crm:status    — delivery/read receipt (ticks)
//   crm:reaction  — emoji reaction
//   crm:notification / crm:notification-count — header bell + drawer
//   crm:sandbox   — test-inbox contact counter (shared number)
//   crm:service-quota — this month's free service messages (profile sidebar)
//   crm:messaging-limit — Meta's daily messaging limit and its use (sidebar, Campaigns)
//   crm:call      — WhatsApp voice calls (ringing, answered, ended…)
//
// The connection authenticates itself with the same bearer token the HTTP
// client uses. The server reads it during the handshake and puts the socket in
// that tenant's room; without it the socket connects but receives nothing.
// -----------------------------------------------------------------------------
import { io, type Socket } from 'socket.io-client';
import type { AppNotification, CallEvent, ChatMessage, MessageError, MessagingLimitUsage, ServiceQuota } from './types';

export interface StatusUpdate {
  metaMessageId: string;
  status: string;
  /** Meta's reason, on a `failed` receipt. */
  error?: MessageError;
  /** Present on real events; used to double-check tenant scoping. */
  businessId?: string;
}
export interface ReactionUpdate {
  metaMessageId: string;
  /** The latest reaction. */
  emoji: string;
  /** Both sides' reactions after this change (absent from older servers). */
  reactionIn?: string;
  reactionOut?: string;
  businessId?: string;
}
export interface TypingUpdate {
  phone: string;
  typing: boolean;
}
/** A new or updated notification, with the tenant's unread count. */
export interface NotificationEvent {
  notification: AppNotification;
  unread: number;
}
/** The shared test number's contact counter changed (`enabled:false` once connected). */
export interface SandboxContactsEvent {
  enabled: boolean;
  linked: number;
  limit: number;
  full: boolean;
  businessId?: string;
}

export class CrmSocket {
  private socket: Socket | null = null;

  /**
   * @param apiBase backend base URL
   * @param tokenKey localStorage key holding the bearer token. Optional so the
   *        demo socket and older callers keep working; without it the feed is
   *        simply empty rather than someone else's.
   */
  constructor(private apiBase: string, private tokenKey?: string) {}

  private token(): string {
    if (!this.tokenKey) return '';
    try {
      return localStorage.getItem(this.tokenKey) || '';
    } catch {
      return '';
    }
  }

  private connect(): Socket {
    if (!this.socket) {
      // An empty base means "this same origin" (the dev server proxies it).
      const opts = {
        transports: ['websocket', 'polling'],
        // Callback form, so a reconnect re-reads the token instead of replaying
        // whatever was in storage when the page first loaded.
        auth: (cb: (data: { token: string }) => void) => cb({ token: this.token() }),
      };
      this.socket = this.apiBase ? io(this.apiBase, opts) : io(opts);
    }
    return this.socket;
  }

  onMessage(cb: (m: ChatMessage) => void): () => void {
    const s = this.connect();
    s.on('crm:message', cb);
    return () => s.off('crm:message', cb);
  }

  onStatus(cb: (u: StatusUpdate) => void): () => void {
    const s = this.connect();
    s.on('crm:status', cb);
    return () => s.off('crm:status', cb);
  }

  onReaction(cb: (u: ReactionUpdate) => void): () => void {
    const s = this.connect();
    s.on('crm:reaction', cb);
    return () => s.off('crm:reaction', cb);
  }

  onTyping(cb: (u: TypingUpdate) => void): () => void {
    const s = this.connect();
    s.on('crm:typing', cb);
    return () => s.off('crm:typing', cb);
  }

  onNotification(cb: (e: NotificationEvent) => void): () => void {
    const s = this.connect();
    s.on('crm:notification', cb);
    return () => s.off('crm:notification', cb);
  }

  /** The unread count changed (something was marked read, here or in another tab). */
  onNotificationCount(cb: (e: { unread: number }) => void): () => void {
    const s = this.connect();
    s.on('crm:notification-count', cb);
    return () => s.off('crm:notification-count', cb);
  }

  /** Someone joined or left this business's test inbox on the shared number. */
  onSandbox(cb: (e: SandboxContactsEvent) => void): () => void {
    const s = this.connect();
    s.on('crm:sandbox', cb);
    return () => s.off('crm:sandbox', cb);
  }

  /** This month's free service messages changed (a reply reached the phone). */
  onServiceQuota(cb: (q: ServiceQuota) => void): () => void {
    const s = this.connect();
    s.on('crm:service-quota', cb);
    return () => s.off('crm:service-quota', cb);
  }

  /** A template went out (or failed): the daily messaging limit's use changed. */
  onMessagingLimit(cb: (q: MessagingLimitUsage) => void): () => void {
    const s = this.connect();
    s.on('crm:messaging-limit', cb);
    return () => s.off('crm:messaging-limit', cb);
  }

  /** A WhatsApp call changed (ringing, answered, picked up, ended, permission). */
  onCall(cb: (e: CallEvent) => void): () => void {
    const s = this.connect();
    s.on('crm:call', cb);
    return () => s.off('crm:call', cb);
  }

  /** Called on every (re)connect, so missed events can be caught up. */
  onConnect(cb: () => void): () => void {
    const s = this.connect();
    s.on('connect', cb);
    return () => s.off('connect', cb);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
