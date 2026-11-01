// =============================================================================
// CrmApp — the reusable WhatsApp-style CRM.
//
// Drop <CrmApp /> anywhere. Pass a `config` to point it at your backend, or
// rely on the Vite env defaults. Replicates the full feature set:
//   chat list · 24h session timer · pause/resume automation · delete chat ·
//   multimedia send/receive · emoji reactions · templates (list/preview/send/
//   create) · delivery & read ticks · live socket · desktop notifications.
// =============================================================================
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CrmApi } from '../api';
import { CrmSocket } from '../socket';
import { MockCrmApi, MockCrmSocket } from '../demo/mockApi';
import { defaultConfig, type CrmConfig } from '../config';
import type { Chat, ChatMessage, SandboxContacts, TemplateItem, WaFlowDef } from '../types';
import { authBodyWithCode, isAuthTemplate } from '../authTemplate';
import { playBeep, notify, previewOf, laterStatus, dayKey, dayLabel, chatDisplayName, isMetaChannelChat } from '../utils';
import { CountryFlag } from './CountryFlag';
import { ChatList } from './ChatList';
import { DefaultAvatar } from './DefaultAvatar';
import { useConfirm, useNotify } from './Dialogs';
import { useBackHandler } from '../useBackHandler';
import { usePlan } from '../PlanContext';
import { MessageItem } from './MessageItem';
import { Composer } from './Composer';
import { TemplateDrawer, fillVars, templateBodyText } from './TemplateDrawer';
import { QuickMessagePicker } from './QuickMessagePicker';
import { FlowDrawer } from './FlowDrawer';
import { Lightbox, type ViewMedia } from './Lightbox';
import { AttachmentPreview } from './AttachmentPreview';
import { ConnectWhatsAppOnboarding } from './ConnectWhatsAppOnboarding';
import { uiScale } from '../uiScale';
import './CrmApp.css';

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** An optimistic outbound copy that hasn't been confirmed by the server yet. */
const isTemp = (m: ChatMessage) => m._id.startsWith('tmp-');

/** Alternating placeholder bubbles shown while a thread loads. */
function MessageSkeleton() {
  const rows: { side: 'in' | 'out'; w: number }[] = [
    { side: 'in', w: 46 },
    { side: 'in', w: 30 },
    { side: 'out', w: 40 },
    { side: 'in', w: 54 },
    { side: 'out', w: 28 },
    { side: 'out', w: 48 },
    { side: 'in', w: 36 },
  ];
  return (
    <div className="msg-skeletons" aria-busy="true" aria-label="Loading messages">
      {rows.map((r, i) => (
        <div className={`msg ${r.side}`} key={i}>
          <span className={`sk sk-bubble ${r.side}`} style={{ width: `${r.w}%` }} />
        </div>
      ))}
    </div>
  );
}


interface Props {
  config?: Partial<CrmConfig>;
  /** Optional phone to auto-open once the chat list loads (deep link). */
  initialPhone?: string | null;
  /**
   * Open a thread on demand, from elsewhere in the shell (e.g. an order).
   *
   * Carries a nonce rather than just the phone because this view stays mounted
   * across tabs: opening the same customer twice in a row wouldn't change the
   * phone, so there'd be nothing for the effect to react to.
   */
  openRequest?: { phone: string; n: number } | null;
  /** Demo mode: use in-memory mock data instead of a backend. */
  demo?: boolean;
  /**
   * The signed-in tenant, from /api/auth/me.
   *
   * The server already addresses live events to one tenant's room, so this is
   * a second pair of eyes rather than the actual boundary: an event tagged
   * with a different business is ignored instead of beeping and being pushed
   * into the open thread.
   */
  businessId?: string;
  /**
   * Whether the chat page is on screen. The view stays mounted behind other
   * tabs, and a message arriving in the open chat while you're on Templates
   * hasn't been read — so it only counts as read while this is true.
   */
  visible?: boolean;
  /** How many chats have unread messages, for the badge on the Chats icon. */
  onUnreadChange?: (chatsWithUnread: number) => void;
  needsConnect?: boolean;
  businessName?: string;
  onConnectClick?: () => void;
  onOpenTemplatesPage?: () => void;
  onOpenTemplateCreate?: () => void;
}

export function CrmApp({
  config, initialPhone = null, openRequest = null, demo = false, businessId,
  visible = true, onUnreadChange, needsConnect = false, businessName: _businessName = '', onConnectClick,
  onOpenTemplatesPage,
  onOpenTemplateCreate,
}: Props) {
  const cfg = useMemo<CrmConfig>(() => ({ ...defaultConfig, ...config }), [config]);
  // Is someone actually looking at the open conversation right now?
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const isWatching = () => visibleRef.current && !document.hidden;
  const api = useMemo(() => (demo ? new MockCrmApi(cfg) : new CrmApi(cfg)), [cfg, demo]);
  const socket = useMemo(
    () => (demo ? new MockCrmSocket(cfg.apiBase) : new CrmSocket(cfg.apiBase, cfg.tokenKey)),
    [cfg, demo],
  );
  // Read inside the socket callbacks, which are registered once on mount and
  // would otherwise close over the first (undefined) value.
  const bizRef = useRef<string | undefined>(businessId);
  bizRef.current = businessId;
  /** Does this live event belong to the tenant we're signed in as? */
  const mine = (id?: string) => !id || !bizRef.current || id === bizRef.current;

  // The plans dialog, for a chat outside the plan (Free: after its first 10 contacts).
  const { openPlans } = usePlan();

  const [chats, setChats] = useState<Chat[]>([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const toast = useNotify();
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [activeName, setActiveName] = useState('');

  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState(false);

  const [paused, setPaused] = useState(false);
  const [pausing, setPausing] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const confirm = useConfirm();

  const [reactingId, setReactingId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [viewMedia, setViewMedia] = useState<ViewMedia | null>(null);
  const [typingPhone, setTypingPhone] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Messenger / Instagram: the composer's Quick messages / utility template picker.
  const [quickOpen, setQuickOpen] = useState(false);
  // Retry of a one-time code whose code isn't known: reopen "Send OTP" on it.
  const [otpPreset, setOtpPreset] = useState('');
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [tSending, setTSending] = useState(false);

  // Flow picker (send a published WhatsApp Flow into the chat).
  const [flowDrawerOpen, setFlowDrawerOpen] = useState(false);
  const [flows, setFlows] = useState<WaFlowDef[]>([]);
  const [flowsLoading, setFlowsLoading] = useState(false);
  const [fSending, setFSending] = useState(false);

  // 24h window state.
  const [windowExpiresAt, setWindowExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const windowOpen = windowExpiresAt > now;
  const msLeft = windowExpiresAt - now;

  const remainingSec = Math.max(0, Math.ceil(msLeft / 1000));
  const timerHours = Math.floor(remainingSec / 3600);
  const timerMinutes = Math.floor((remainingSec % 3600) / 60);
  const timerSeconds = remainingSec % 60;
  const timerDisplay =
    windowOpen
      ? timerHours > 0
        ? `${String(timerHours).padStart(2, '0')}:${String(timerMinutes).padStart(2, '0')}:${String(timerSeconds).padStart(2, '0')}`
        : `${String(timerMinutes).padStart(2, '0')}:${String(timerSeconds).padStart(2, '0')}`
      : '00:00:00';

  let timerColor = '#22ce6d';
  if (!windowOpen || remainingSec <= 0 || remainingSec <= 3600) {
    timerColor = '#ff4545';
  } else if (remainingSec <= 14400) {
    timerColor = '#ffd43b';
  }

  // Refs so socket handlers see the latest values without re-subscribing.
  const activePhoneRef = useRef<string | null>(null);
  activePhoneRef.current = activePhone;
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  // Ids already delivered over the socket this session, so a re-push of the
  // same message (an update) never beeps or notifies a second time.
  const seenIdsRef = useRef<Set<string>>(new Set());
  // Receipts that arrived before their message reached the screen (keyed by
  // metaMessageId), applied when the message shows up.
  const earlyStatusRef = useRef<Map<string, string>>(new Map());
  /** Bring a message's ticks up to date with anything received out of order. */
  const withEarlyStatus = (m: ChatMessage, prev?: ChatMessage): ChatMessage => {
    let status = laterStatus(prev?.status, m.status);
    const early = m.metaMessageId ? earlyStatusRef.current.get(m.metaMessageId) : undefined;
    if (early) {
      status = laterStatus(status, early);
      earlyStatusRef.current.delete(m.metaMessageId!);
    }
    return status === m.status ? m : { ...m, status };
  };
  const msgBoxRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      const box = msgBoxRef.current;
      if (box) box.scrollTop = box.scrollHeight;
    }, 60);
  }, []);

  // Debounced chat-list refresh: several messages land together (customer +
  // bot replies), and one reload after they settle reads the final state.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleChatsRefresh = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      loadChatsRef.current();
    }, 700);
  };
  const loadChatsRef = useRef<() => void>(() => {});

  const loadChats = useCallback(() => {
    api.getChats()
      .then((res) => {
        // The open chat reads as seen only while it's actually on screen.
        const active = isWatching() ? activePhoneRef.current : null;
        const data = (res.data || []).map((c) => (c.phone === active ? { ...c, unread: 0 } : c));
        setChats(data);
        // Keep the open chat's 24h window in step with the server's record.
        const open = data.find((c) => c.phone === activePhoneRef.current);
        const lastIn = open?.lastInboundAt && open.windowOpen ? new Date(open.lastInboundAt).getTime() : 0;
        if (lastIn && open?.windowOpen) {
          setWindowExpiresAt(lastIn + WINDOW_MS);
        } else if (open && !open.windowOpen) {
          setWindowExpiresAt(0);
        }
      })
      .finally(() => {
        setChatsLoading(false);
      });
  }, [api]);
  loadChatsRef.current = loadChats;

  const openChat = useCallback(
    (phone: string, fallbackName?: string) => {
      // Switching chats closes any open media preview / lightbox / reply / drawer.
      setPendingFiles([]);
      setViewMedia(null);
      setReplyingTo(null);
      setDrawerOpen(false);
      setQuickOpen(false);
      setFlowDrawerOpen(false);
      setReactingId(null);
      setActivePhone(phone);
      const chat = chatsRef.current.find((c) => c.phone === phone);
      setActiveName(chat?.name || fallbackName || (chat ? chatDisplayName(chat) : `+${phone}`));
      setPaused(!!chat?.botPaused);
      setChats((list) => list.map((c) => (c.phone === phone ? { ...c, unread: 0 } : c)));
      const lastInbound = chat?.lastInboundAt && chat.windowOpen ? new Date(chat.lastInboundAt).getTime() : 0;
      setWindowExpiresAt(lastInbound > 0 ? lastInbound + WINDOW_MS : 0);
      setNow(Date.now());
      // Clear the previous thread so its messages don't flash under the new
      // header, and show placeholders until this one arrives.
      setMessages([]);
      setMsgsLoading(true);
      api
        .getMessages(phone)
        .then((res) => {
          // The user may have switched again while this was in flight.
          if (activePhoneRef.current !== phone) return;
          const list = res.data || [];
          setMessages(list);
          scrollToBottom();

          // Calculate actual 24h window from actual inbound messages
          const lastInboundMsg = [...list].reverse().find((m) => m.direction === 'in');
          if (lastInboundMsg?.createdAt) {
            const inTime = new Date(lastInboundMsg.createdAt).getTime();
            if (!Number.isNaN(inTime) && inTime > 0 && Date.now() - inTime < WINDOW_MS) {
              setWindowExpiresAt(inTime + WINDOW_MS);
            } else {
              setWindowExpiresAt(0);
            }
          } else {
            // Zero inbound messages from this contact -> window is CLOSED!
            setWindowExpiresAt(0);
            setChats((prev) =>
              prev.map((c) => (c.phone === phone ? { ...c, windowOpen: false, windowMsLeft: 0, lastInboundAt: '' } : c)),
            );
          }
        })
        .catch(() => {})
        .finally(() => {
          if (activePhoneRef.current === phone) setMsgsLoading(false);
        });
    },
    [api, scrollToBottom],
  );

  const handleAddContact = useCallback(
    async (phone: string, name?: string) => {
      const clean = phone.replace(/\D/g, '');
      if (!clean) return;

      const contactName = (name || '').trim();
      setChats((list) => {
        const existing = list.find((c) => c.phone === clean);
        if (existing) {
          if (contactName && existing.name !== contactName) {
            return list.map((c) => (c.phone === clean ? { ...c, name: contactName, unread: 0 } : c));
          }
          return list.map((c) => (c.phone === clean ? { ...c, unread: 0 } : c));
        }
        const newChat: Chat = {
          phone: clean,
          name: contactName || `+${clean}`,
          channel: 'whatsapp',
          unread: 0,
          windowOpen: false,
          windowMsLeft: 0,
          lastMessageAt: new Date().toISOString(),
          lastInboundAt: '',
          lastMessageBody: '',
        };
        return [newChat, ...list];
      });

      openChat(clean, contactName);

      try {
        await api.createChat(clean, contactName);
      } catch (err) {
        console.warn('Could not persist new chat to backend', err);
      }
    },
    [openChat, api],
  );

  // ---- Initial load + socket subscriptions + 24h ticker ----
  useEffect(() => {
    // Preload empty state image for instant display
    const preloadImg = new Image();
    preloadImg.src = '/4.svg';

    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    } catch {
      /* ignore */
    }

    api
      .getChats()
      .then((res) => {
        setChats(res.data || []);
        if (initialPhone) openChat(initialPhone);
      })
      .catch(() => {})
      .finally(() => setChatsLoading(false));

    const offMsg = socket.onMessage((m) => {
      // Not ours: don't beep, don't notify, and above all don't append it to
      // the open thread. Two tenants can legitimately both be chatting with
      // the same phone number.
      if (!mine(m.businessId)) return;
      // The same message can arrive twice: e.g. a shared location is pushed
      // again once its address has been looked up. Replace it in place rather
      // than appending a duplicate, and don't beep/notify for it again.
      const isUpdate = seenIdsRef.current.has(m._id) || messagesRef.current.some((x) => x._id === m._id);
      seenIdsRef.current.add(m._id);
      if (isUpdate) {
        // Keep the ticks we already have: the re-push may carry an older status.
        setMessages((list) => list.map((x) => (x._id === m._id ? withEarlyStatus(m, x) : x)));
        return;
      }
      if (m.phone === activePhoneRef.current) {
        setMessages((list) => {
          if (list.some((x) => x._id === m._id)) return list;
          const fresh = withEarlyStatus(m);
          // Our own text echoed back: swap it in for the optimistic copy that
          // is already on screen instead of showing it twice.
          if (m.direction === 'out') {
            const i = list.findIndex(
              (x) => isTemp(x) && x.phone === m.phone && x.body === m.body && x.status !== 'failed',
            );
            if (i >= 0) {
              const next = [...list];
              next[i] = fresh;
              return next;
            }
          }
          return [...list, fresh];
        });
        scrollToBottom();
        // Only mark it read if the chat is really on screen; otherwise it waits
        // (and counts as unread) until the user comes back to it.
        if (m.direction === 'in' && isWatching()) api.markRead(m.phone).catch(() => {});
      }
      if (m.direction === 'in') {
        playBeep();
        const known = chatsRef.current.find((c) => c.phone === m.phone);
        const sender = known
          ? chatDisplayName(known)
          : m.name || (m.channel === 'messenger' ? 'Messenger user' : m.channel === 'instagram' ? 'Instagram user' : `+${m.phone}`);
        if (!isWatching() || m.phone !== activePhoneRef.current) {
          notify(sender, m.body?.trim() || 'New message');
        }
        // A message from the customer reopens the 24h window. The open chat's
        // timer and composer follow it straight away, not on the next refresh.
        if (m.phone === activePhoneRef.current) {
          const at = new Date(m.createdAt || Date.now()).getTime();
          setWindowExpiresAt((cur) => Math.max(cur, at + WINDOW_MS));
          setNow(Date.now());
        }
      }

      // The chat list's last line follows every message as it arrives (a bot
      // reply used to leave the customer's "hi" showing until a refresh).
      const seen = m.direction === 'in' && m.phone === activePhoneRef.current && isWatching();
      setChats((list) => {
        const i = list.findIndex((c) => c.phone === m.phone);
        if (i < 0) return list; // a new contact: the refresh below adds it
        const at = m.createdAt || new Date().toISOString();
        const c = list[i];
        const next: Chat = {
          ...c,
          lastMessageBody: previewOf(m),
          lastMessageAt: at,
          ...(m.direction === 'in'
            ? { lastInboundAt: at, unread: seen ? 0 : (c.unread || 0) + 1 }
            : {}),
        };
        // Newest customer message first, like the server's ordering.
        if (m.direction === 'in') return [next, ...list.slice(0, i), ...list.slice(i + 1)];
        const copy = [...list];
        copy[i] = next;
        return copy;
      });
      // Then reconcile with the server, once a burst of messages (customer
      // "hi" + the bot's replies) has settled.
      scheduleChatsRefresh();
    });

    const offStatus = socket.onStatus((u) => {
      if (!mine(u.businessId)) return;
      // The receipt can beat the message itself to the screen; hold on to it.
      if (!messagesRef.current.some((m) => m.metaMessageId === u.metaMessageId)) {
        const early = earlyStatusRef.current;
        early.set(u.metaMessageId, laterStatus(early.get(u.metaMessageId), u.status));
        if (early.size > 500) early.delete(early.keys().next().value!);
      }
      // Only ever move ticks forward (receipts can arrive out of order).
      setMessages((list) =>
        list.map((m) => {
          if (m.metaMessageId !== u.metaMessageId) return m;
          const status = laterStatus(m.status, u.status);
          // A failure keeps Meta's reason so the bubble can say why.
          return { ...m, status, ...(status === 'failed' && u.error ? { error: u.error } : {}) };
        }),
      );
    });

    const offReaction = socket.onReaction((u) => {
      if (!mine(u.businessId)) return;
      // Both sides come with the update, so the customer's reaction and ours
      // stay side by side (an older server only sends the latest one).
      setMessages((list) =>
        list.map((m) =>
          m.metaMessageId === u.metaMessageId
            ? {
                ...m,
                reaction: u.emoji,
                ...(u.reactionIn !== undefined || u.reactionOut !== undefined
                  ? { reactionIn: u.reactionIn || '', reactionOut: u.reactionOut || '' }
                  : {}),
              }
            : m,
        ),
      );
    });

    const offTyping = socket.onTyping((u) => {
      setTypingPhone((cur) => (u.typing ? u.phone : cur === u.phone ? null : cur));
      if (u.typing && u.phone === activePhoneRef.current) scrollToBottom();
    });

    const ticker = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      offMsg();
      offStatus();
      offReaction();
      offTyping();
      clearInterval(ticker);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coming back to the chat page (or to this browser tab) with a chat open:
  // what arrived in it meanwhile has now been seen.
  useEffect(() => {
    const catchUp = () => {
      const phone = activePhoneRef.current;
      if (!phone || !isWatching()) return;
      if (!chatsRef.current.some((c) => c.phone === phone && c.unread > 0)) return;
      setChats((list) => list.map((c) => (c.phone === phone ? { ...c, unread: 0 } : c)));
      api.markRead(phone).catch(() => {});
    };
    catchUp();
    document.addEventListener('visibilitychange', catchUp);
    return () => document.removeEventListener('visibilitychange', catchUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ---- Shared test number: "Test inbox · 4 / 10 contacts" ----
  // Only while the business hasn't connected its own number. Read once, then
  // kept live by the socket (someone joined, or the business connected), and
  // read again after a reconnect in case an update was missed.
  const [sandboxContacts, setSandboxContacts] = useState<SandboxContacts | null>(null);
  useEffect(() => {
    if (demo || !needsConnect) {
      setSandboxContacts(null);
      return undefined;
    }
    let live = true;
    const load = () => {
      api
        .getSandbox()
        .then((r) => live && setSandboxContacts(r.enabled && r.contacts ? r.contacts : null))
        .catch(() => {});
    };
    load();
    const offSandbox = socket.onSandbox((e) => {
      if (!live || !mine(e.businessId)) return;
      setSandboxContacts(e.enabled ? { linked: e.linked, limit: e.limit, full: e.linked >= e.limit } : null);
    });
    const offConnect = socket.onConnect(load);
    return () => {
      live = false;
      offSandbox();
      offConnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, needsConnect, api, socket]);

  // The Chats icon's badge: how many conversations have something unread.
  const unreadChats = chats.filter((c) => c.unread > 0).length;
  useEffect(() => {
    onUnreadChange?.(unreadChats);
  }, [unreadChats, onUnreadChange]);

  // Another part of the shell asked for a thread (e.g. "Open chat" on an
  // order). Keyed on the nonce so asking twice for the same customer works.
  useEffect(() => {
    if (openRequest?.phone) openChat(openRequest.phone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.n]);

  // ---- Actions ----
  function send() {
    const text = draft.trim();
    const phone = activePhone;
    if (!text || !phone) return;
    const replyTo = replyingTo
      ? {
          author: replyingTo.direction === 'in' ? activeName : 'You',
          preview: previewOf(replyingTo),
          id: replyingTo._id,
        }
      : undefined;
    setDraft('');
    setReplyingTo(null);
    deliverText(phone, text, replyTo);
  }

  /**
   * Show an outbound text straight away (clock icon), then post it. The socket
   * echo of the saved message replaces this copy; if the request fails the
   * copy stays, marked "Not delivered", and a toast explains why.
   */
  function deliverText(
    phone: string,
    text: string,
    replyTo?: { author: string; preview: string; id?: string },
  ) {
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const temp: ChatMessage = {
      _id: tempId,
      phone,
      direction: 'out',
      type: 'text',
      body: text,
      status: 'pending',
      createdAt: new Date().toISOString(),
      // The quote shows straight away; the saved copy carries the server's.
      ...(replyTo ? { raw: { replyTo } } : {}),
    };
    setMessages((list) => [...list, temp]);
    scrollToBottom();
    const setStatus = (status: string) =>
      setMessages((list) => list.map((x) => (x._id === tempId ? { ...x, status } : x)));
    api
      .sendMessage(phone, text, replyTo)
      .then(() => setStatus('sent')) // no-op if the socket echo already replaced it
      .catch((e: Error) => {
        setStatus('failed');
        toast('error', 'Message not delivered', e.message || 'The 24-hour window may be closed.');
      });
  }

  /** "Retry" on a failed text or template: drop the failed copy if it was ours, send again. */
  function retrySend(m: ChatMessage) {
    const phone = activePhone;
    if (!phone || !m.body) return;
    if (isTemp(m)) setMessages((list) => list.filter((x) => x._id !== m._id));
    if (m.type === 'template' && m.raw?.template?.name) {
      const tmpl = templates.find((t) => t.name === m.raw?.template?.name) || {
        name: m.raw.template.name,
        language: 'en_US',
        bodyText: m.body,
      };
      if (isAuthTemplate(tmpl)) {
        // A one-time code goes again with the same code; when it isn't known
        // (sent earlier), the agent picks it in "Send OTP".
        const code = m.raw.template.otpCode;
        if (code) sendTemplate(tmpl as TemplateItem, code);
        else {
          setOtpPreset(tmpl.name);
          setDrawerOpen(true);
        }
        return;
      }
      sendTemplate(tmpl as TemplateItem);
    } else {
      deliverText(phone, m.body, m.raw?.replyTo);
    }
  }

  // Send a recorded voice note.
  function sendVoice(file: File) {
    const phone = activePhone;
    if (!phone) return;
    api.sendMedia(phone, file, undefined, true).catch((e: Error) => {
      toast('error', 'Voice message failed', e.message || 'Could not send the voice note.');
    });
  }

  // Confirm-and-send all previewed attachments (each with its caption).
  async function sendPendingFiles(toSend: { file: File; caption: string }[]) {
    const phone = activePhone;
    if (!phone || !toSend.length) return;
    setUploading(true);
    try {
      for (const it of toSend) {
        // eslint-disable-next-line no-await-in-loop
        await api.sendMedia(phone, it.file, it.caption.trim() || undefined);
      }
      setUploading(false);
      setPendingFiles([]);
    } catch (e) {
      setUploading(false);
      toast('error', 'File not sent', e instanceof Error ? e.message : 'Could not send the file.');
    }
  }

  function togglePause() {
    const phone = activePhone;
    if (!phone) return;
    const next = !paused;
    setPausing(true);
    api
      .setPause(phone, next)
      .then((res) => {
        setPausing(false);
        setPaused(res.botPaused);
        setChats((list) =>
          list.map((c) => (c.phone === phone ? { ...c, botPaused: res.botPaused } : c)),
        );
      })
      .catch((e: Error) => {
        setPausing(false);
        toast('error', 'Failed', e.message || 'Could not update automation state.');
      });
  }

  async function deleteChat() {
    const phone = activePhone;
    if (!phone) return;
    const name = activeName;
    const ok = await confirm({
      title: 'Delete this chat?',
      message: `This permanently deletes all messages in this chat with ${name}, including shared photos, videos, and files. The contact will remain in your contacts list.`,
      confirmLabel: 'Delete chat',
    });
    if (!ok) return;
    setDeleting(true);
    api
      .deleteChat(phone)
      .then(() => {
        setDeleting(false);
        setChats((list) =>
          list.map((c) =>
            c.phone === phone
              ? {
                  ...c,
                  lastMessageBody: '',
                  lastMessageAt: undefined,
                  lastInboundAt: '',
                  unread: 0,
                  windowOpen: false,
                  windowMsLeft: 0,
                }
              : c
          )
        );
        setMessages([]);
        toast('success', 'Chat deleted', `Messages with ${name} were deleted. Contact remains in your contacts.`);
      })
      .catch((e: Error) => {
        setDeleting(false);
        toast('error', 'Delete failed', e.message || 'Could not delete the chat.');
      });
  }

  function react(m: ChatMessage, emoji: string) {
    const phone = activePhone;
    setReactingId(null);
    if (!phone || !m.metaMessageId) return;
    // Our side only; the customer's reaction (if any) stays.
    setMessages((list) =>
      list.map((x) =>
        x._id === m._id ? { ...x, reactionOut: emoji, reaction: emoji || x.reactionIn || '' } : x,
      ),
    );
    api.reactToMessage(phone, m.metaMessageId, emoji).catch((e: Error) => {
      toast('error', 'Reaction failed', e.message || 'Could not send the reaction.');
    });
  }

  function toggleReact(m: ChatMessage) {
    setReactingId((cur) => (cur === m._id ? null : m._id));
  }

  function toggleDrawer() {
    const next = !drawerOpen;
    setDrawerOpen(next);
    if (next) loadDrawerTemplates();
  }

  /** The panel's list: the business's templates, plus the shared test number's samples while not connected. */
  function loadDrawerTemplates() {
    return api
      .getTemplates({ includeShared: true })
      .then((res) => setTemplates(res.data || []))
      .catch(() => setTemplates([]));
  }

  /**
   * Send a template; `otpCode` is the code for an authentication template,
   * `bodyParams` the {{n}} values typed for a shared sample template.
   */
  function sendTemplate(t: TemplateItem, otpCode?: string, bodyParams?: string[]) {
    const phone = activePhone;
    if (!phone) return;
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const auth = isAuthTemplate(t) && !!otpCode;
    const sharedBody = t.shared ? fillVars(templateBodyText(t), bodyParams || []) : '';
    const body = auth ? authBodyWithCode(t, otpCode!) : sharedBody || t.bodyText || t.name;
    const temp: ChatMessage = {
      _id: tempId,
      phone,
      direction: 'out',
      type: 'template',
      body,
      status: 'pending',
      createdAt: new Date().toISOString(),
      raw: {
        template: {
          name: t.name,
          body,
          buttons: [],
          ...(auth ? { otpCode } : {}),
        },
      },
    };
    setMessages((list) => [...list, temp]);
    scrollToBottom();
    setTSending(true);
    setDrawerOpen(false);
    setOtpPreset('');

    api
      .sendTemplateMessage(
        phone,
        t.name,
        t.language || 'en_US',
        auth ? { otpCode } : bodyParams?.length ? { bodyParams } : undefined,
      )
      .then(() => {
        setTSending(false);
        setMessages((list) => list.map((x) => (x._id === tempId ? { ...x, status: 'sent' } : x)));
        if (auth) toast('success', 'Code sent', `The one-time code ${otpCode} was sent with “${t.name}”.`);
        else toast('success', 'Template sent', `"${t.name}" was sent successfully.`);
      })
      .catch((e: Error) => {
        setTSending(false);
        setMessages((list) => list.map((x) => (x._id === tempId ? { ...x, status: 'failed' } : x)));
        toast('error', 'Template failed', e.message || 'The template could not be sent.');
      });
  }

  function toggleFlowDrawer() {
    const next = !flowDrawerOpen;
    setFlowDrawerOpen(next);
    if (!next) return;
    setFlowsLoading(true);
    api
      .listFlows()
      .then((res) => setFlows(res.data || []))
      .catch(() => setFlows([]))
      .finally(() => setFlowsLoading(false));
  }

  function sendFlow(f: WaFlowDef) {
    const phone = activePhone;
    if (!phone) return;
    setFSending(true);
    api
      .sendFlow(phone, f._id)
      .then(() => {
        setFSending(false);
        setFlowDrawerOpen(false);
      })
      .catch((e: Error) => {
        setFSending(false);
        toast('error', 'Form not sent', e.message || 'Could not send the form.');
      });
  }

  function closeActiveChat() {
    setActivePhone(null);
    setDrawerOpen(false);
    setQuickOpen(false);
    setFlowDrawerOpen(false);
  }
  // Back with a conversation open closes it (back to the chat list), like the
  // arrow in the thread header. Drawers / previews inside close first.
  useBackHandler(!!activePhone, closeActiveChat);

  // Scroll to the quoted message and briefly highlight it (WhatsApp style).
  function jumpToMessage(id?: string) {
    if (!id) return;
    const box = msgBoxRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-msg-id="${id}"]`);
    if (!el) return;
    // Scroll only the message list. scrollIntoView() would also scroll every
    // ancestor (even overflow:hidden ones) and shift the whole CRM.
    // Rects are screen px, scrollTop / clientHeight are CSS px (they differ in the 90% view).
    const s = uiScale();
    const boxRect = box!.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    box!.scrollTo({
      top: box!.scrollTop + (elRect.top - boxRect.top) / s - (box!.clientHeight - elRect.height / s) / 2,
      behavior: 'smooth',
    });
    el.classList.remove('flash');
    // Force reflow so the animation restarts if clicked repeatedly.
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1400);
  }


  // Replies saved before the server built quotes still carry Meta's
  // `context.id`: quote the message it points to, when it's in this chat.
  const shownMessages = useMemo(() => {
    const byMetaId = new Map<string, ChatMessage>();
    for (const m of messages) if (m.metaMessageId) byMetaId.set(m.metaMessageId, m);
    return messages.map((m) => {
      if (m.direction !== 'in' || m.raw?.replyTo) return m;
      const ctxId = m.raw?.context?.id || m.raw?.meta?.context?.id;
      const quoted = ctxId ? byMetaId.get(ctxId) : undefined;
      if (!quoted) return m;
      return {
        ...m,
        raw: {
          ...m.raw,
          replyTo: { id: quoted._id, author: quoted.direction === 'out' ? 'You' : activeName, preview: previewOf(quoted) },
        },
      };
    });
  }, [messages, activeName]);

  const activeChat = activePhone ? chats.find((c) => c.phone === activePhone) || null : null;
  // Messenger / Instagram: replies only, no WhatsApp templates, Flows, catalog or payments.
  const metaChat = isMetaChannelChat(activeChat);

  return (
    <div className={`crm${activePhone ? ' has-active' : ''}`}>
      <ChatList
        chats={chats}
        activePhone={activePhone}
        typingPhone={typingPhone}
        loading={chatsLoading}
        onOpen={openChat}
        onAddContact={handleAddContact}
        sandboxContacts={needsConnect ? sandboxContacts : null}
        needsConnect={needsConnect}
        onConnectClick={onConnectClick}
      />

      <section className={`thread${!activePhone ? ' no-active-chat' : ' has-active-chat'}`}>
        {!activePhone ? (
          needsConnect ? (
            <ConnectWhatsAppOnboarding
              api={api}
              onConnectClick={onConnectClick}
              contacts={sandboxContacts}
              isFull={
                Boolean(
                  sandboxContacts?.full ||
                  (sandboxContacts?.linked !== undefined &&
                    sandboxContacts?.limit !== undefined &&
                    sandboxContacts.linked >= sandboxContacts.limit) ||
                  chats.length >= 10
                )
              }
            />
          ) : (
            <div className="no-chat">
              <img src="/4.svg" alt="" className="no-chat-img" loading="eager" decoding="async" />
              <p>Select a conversation to start messaging.</p>
            </div>
          )
        ) : (
          <>
            <header className="thread-head">
              <button className="back-btn" onClick={closeActiveChat} aria-label="Back to chats">
                <span className="material-icons">arrow_back</span>
              </button>
              <DefaultAvatar channel={activeChat?.channel || 'whatsapp'} photoUrl={activeChat?.avatarUrl} />
              <div className="th-info">
                <div className="th-name">{activeChat?.name || activeName}</div>
                <div className="th-sub">
                  {typingPhone === activePhone ? (
                    <span className="typing-text">typing…</span>
                  ) : metaChat ? (
                    // A PSID / IGSID isn't a phone number: say where the chat is instead.
                    <span className="th-channel" data-testid="th-channel">
                      {activeChat?.channel === 'instagram'
                        ? `Instagram${activeChat?.handle ? ` · @${activeChat.handle}` : ''}`
                        : 'Messenger'}
                    </span>
                  ) : (
                    <>
                      <CountryFlag phone={activePhone} size={18} className="flag" />+{activePhone}
                    </>
                  )}
                </div>
              </div>

              <div
                className="timer-box"
                id="timerBox"
                style={{ '--timer-color': timerColor } as React.CSSProperties}
                title={
                  windowOpen
                    ? `Session window open: ${timerDisplay} remaining`
                    : metaChat
                    ? '24-hour reply window closed — wait for the customer to write again'
                    : '24-hour session window closed — use a template'
                }
              >
                <div className="timer" id="timer">
                  {timerDisplay}
                </div>
              </div>

              {/* Bot / Manual for this chat: on Messenger / Instagram it switches that
                  channel's journey (Automation) on or off for this customer. */}
              {(
              <div
                data-testid="bot-toggle"
                className="bot-toggle-group"
                title={!paused ? 'Bot active (Auto) — click for Manual' : 'Manual mode — click for Bot'}
              >
                <span
                  className={`bot-toggle-label manual${paused ? ' active' : ''}`}
                  onClick={togglePause}
                >
                  Manual
                </span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={!paused}
                    disabled={pausing}
                    onChange={togglePause}
                  />
                  <div className="slider">
                    <div className="circle">
                      <svg
                        className="cross"
                        xmlSpace="preserve"
                        viewBox="0 0 365.696 365.696"
                        y="0"
                        x="0"
                        height="6"
                        width="6"
                        version="1.1"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <g>
                          <path
                            fill="currentColor"
                            d="M243.188 182.86 356.32 69.726c12.5-12.5 12.5-32.766 0-45.247L341.238 9.398c-12.504-12.503-32.77-12.503-45.25 0L182.86 122.528 69.727 9.374c-12.5-12.5-32.766-12.5-45.247 0L9.375 24.457c-12.5 12.504-12.5 32.77 0 45.25l113.152 113.152L9.398 295.99c-12.503 12.503-12.503 32.769 0 45.25L24.48 356.32c12.5 12.5 32.766 12.5 45.247 0l113.132-113.132L295.99 356.32c12.503 12.5 32.769 12.5 45.25 0l15.081-15.082c12.5-12.504 12.5-32.77 0-45.25zm0 0"
                          />
                        </g>
                      </svg>
                      <svg
                        className="checkmark"
                        xmlSpace="preserve"
                        viewBox="0 0 24 24"
                        y="0"
                        x="0"
                        height="10"
                        width="10"
                        version="1.1"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <g>
                          <path
                            fill="currentColor"
                            d="M9.707 19.121a.997.997 0 0 1-1.414 0l-5.646-5.647a1.5 1.5 0 0 1 0-2.121l.707-.707a1.5 1.5 0 0 1 2.121 0L9 14.171l9.525-9.525a1.5 1.5 0 0 1 2.121 0l.707.707a1.5 1.5 0 0 1 0 2.121z"
                          />
                        </g>
                      </svg>
                    </div>
                  </div>
                </label>
                <span
                  className={`bot-toggle-label bot${!paused ? ' active' : ''}`}
                  onClick={togglePause}
                >
                  Bot
                </span>
              </div>
              )}

              <button
                className="del-chat"
                onClick={deleteChat}
                disabled={deleting}
                title="Delete chat"
                aria-label="Delete chat"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3.5 5.5H16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M8 5.5V3.5H12V5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M5 5.5L5.8 16C5.86 16.84 6.56 17.5 7.4 17.5H12.6C13.44 17.5 14.14 16.84 14.2 16L15 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M8 8.5V14.5M12 8.5V14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </header>


            <div className="messages" ref={msgBoxRef}>
              {msgsLoading && messages.length === 0 && <MessageSkeleton />}
              {!msgsLoading && messages.length === 0 && (
                <div className="day-sep" role="status">
                  <span>No messages in this chat yet. Start the conversation below.</span>
                </div>
              )}
              {shownMessages.map((m, i) => {
                // WhatsApp-style day separator ("Today", "Yesterday", "Tuesday",
                // "20/9/2026") whenever the calendar day changes.
                const day = dayKey(m.createdAt);
                const newDay = !!day && day !== dayKey(shownMessages[i - 1]?.createdAt);
                return (
                  <Fragment key={m._id}>
                    {newDay && (
                      <div className="day-sep" role="separator">
                        <span>{dayLabel(m.createdAt)}</span>
                      </div>
                    )}
                    <MessageItem
                      message={m}
                      api={api}
                      reacting={reactingId === m._id}
                      onToggleReact={toggleReact}
                      onReact={react}
                      onCloseReact={() => setReactingId(null)}
                      onReply={(msg) => setReplyingTo(msg)}
                      onJumpTo={jumpToMessage}
                      onViewMedia={setViewMedia}
                      onRetry={m.type === 'text' ? retrySend : undefined}
                    />
                  </Fragment>
                );
              })}
              {typingPhone === activePhone && (
                <div className="msg in">
                  <div className="msg-col">
                    <div className="bubble typing-bubble">
                      <span className="td" />
                      <span className="td" />
                      <span className="td" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {activeChat?.locked ? (
              // Outside the plan (Free: after its first 10 contacts). Messages
              // from them are kept; replying needs an upgrade (the server refuses too).
              <div className="plan-chat-locked" data-testid="chat-plan-locked">
                <div>
                  <strong>Upgrade to reply to this contact</strong>
                  {isMetaChannelChat(activeChat)
                    ? `${activeChat.channel === 'instagram' ? 'Instagram' : 'Messenger'} chats are part of the Pro plan.`
                    : 'Your Free plan includes chats with 10 contacts. Their messages are saved for when you upgrade.'}
                </div>
                <button
                  type="button"
                  className="pl-btn"
                  onClick={() => openPlans(isMetaChannelChat(activeChat)
                    ? { tier: 'pro', reason: 'Instagram and Messenger chats are included from the Pro plan.' }
                    : { tier: 'basic', reason: 'The Free plan includes chats with 10 contacts. Basic and up have no limit.' })}
                >
                  <span className="material-icons" aria-hidden="true">workspace_premium</span>
                  See plans
                </button>
              </div>
            ) : (
            <Composer
              draft={draft}
              windowOpen={windowOpen}
              sending={false /* text sends are optimistic; the composer never blocks */}
              uploading={uploading}
              replyTo={
                replyingTo
                  ? {
                      author: replyingTo.direction === 'in' ? activeName : 'You',
                      preview: previewOf(replyingTo),
                    }
                  : null
              }
              onDraftChange={setDraft}
              onSend={send}
              onPickFiles={setPendingFiles}
              onSendVoice={sendVoice}
              onOpenTemplates={toggleDrawer}
              onOpenFlows={toggleFlowDrawer}
              onCancelReply={() => setReplyingTo(null)}
              channel={metaChat ? activeChat?.channel || '' : 'whatsapp'}
              onOpenQuickMessages={metaChat && !demo ? () => setQuickOpen((v) => !v) : undefined}
            />
            )}

            {metaChat && quickOpen && activePhone && (activeChat?.channel === 'messenger' || activeChat?.channel === 'instagram') && (
              <QuickMessagePicker
                api={api}
                phone={activePhone}
                channel={activeChat.channel}
                windowOpen={windowOpen}
                contactName={activeChat?.name || ''}
                onClose={() => setQuickOpen(false)}
                onOpenTemplatesPage={onOpenTemplatesPage}
              />
            )}

            {/* Templates and Flows are WhatsApp-only. */}
            {!metaChat && flowDrawerOpen && (
              <FlowDrawer
                flows={flows}
                loading={flowsLoading}
                sending={fSending}
                onClose={() => setFlowDrawerOpen(false)}
                onSend={sendFlow}
              />
            )}

            {!metaChat && drawerOpen && (
              <TemplateDrawer
                api={api}
                templates={templates}
                tSending={tSending}
                onClose={() => {
                  setDrawerOpen(false);
                  setOtpPreset('');
                }}
                onSend={sendTemplate}
                initialOtpTemplate={otpPreset || undefined}
                contactName={/\p{L}/u.test(activeChat?.name || '') ? (activeChat?.name || '').trim() : ''}
                onCreated={() => loadDrawerTemplates()}
                onOpenTemplatesPage={onOpenTemplatesPage}
                onOpenTemplateCreate={onOpenTemplateCreate}
              />
            )}

            {pendingFiles.length > 0 && (
              <AttachmentPreview
                files={pendingFiles}
                sending={uploading}
                onCancel={() => setPendingFiles([])}
                onSend={sendPendingFiles}
              />
            )}
          </>
        )}
      </section>

      {viewMedia && <Lightbox media={viewMedia} onClose={() => setViewMedia(null)} />}
    </div>
  );
}
