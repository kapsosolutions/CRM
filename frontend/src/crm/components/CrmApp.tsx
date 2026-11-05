// =============================================================================
// CrmApp — the reusable WhatsApp-style CRM.
//
// Drop <CrmApp /> anywhere. Pass a `config` to point it at your backend, or
// rely on the Vite env defaults. Replicates the full feature set:
//   chat list · 24h session timer · pause/resume automation · delete chat ·
//   multimedia send/receive · emoji reactions · templates (list/preview/send/
//   create) · delivery & read ticks · live socket · desktop notifications.
// =============================================================================
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CrmApi } from '../api';
import { CrmSocket } from '../socket';
import { MockCrmApi, MockCrmSocket } from '../demo/mockApi';
import { defaultConfig, type CrmConfig } from '../config';
import type { Chat, ChatMessage, SandboxContacts, TemplateItem, WaFlowDef, PollInput, EventInput, MuteFor } from '../types';
import { authBodyWithCode, isAuthTemplate } from '../authTemplate';
import { notify, previewOf, laterStatus, dayKey, dayLabel, chatDisplayName, isMetaChannelChat } from '../utils';
import { loadPrefs, playSound, wants } from '../notifyPrefs';
import { setWatchingChat } from '../push';
import { CountryFlag } from './CountryFlag';
import { ChatList } from './ChatList';
import { DefaultAvatar } from './DefaultAvatar';
import { useConfirm, useNotify } from './Dialogs';
import { useBackHandler } from '../useBackHandler';
import { usePlan } from '../PlanContext';
import { MessageItem } from './MessageItem';
import { Composer } from './Composer';
import { SessionTimer, useWindowOpen } from './SessionTimer';
import { TemplateDrawer, fillVars, templateBodyText } from './TemplateDrawer';
import { QuickMessagePicker } from './QuickMessagePicker';
import { FlowDrawer } from './FlowDrawer';
import { Lightbox, type ViewMedia } from './Lightbox';
import { AttachmentPreview } from './AttachmentPreview';
import { CallIcon, VideocamIcon } from './AppIcons';
import { ConnectWhatsAppOnboarding, prepareOnboarding } from './ConnectWhatsAppOnboarding';
import { uiScale } from '../uiScale';
import { useCalls } from './CallCenter';
import ChatHeaderMenu, { isMutedNow, mutedLabel, type ChatMenuBusy } from './ChatHeaderMenu';
import { SoonPill } from './ComingSoon';
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
  /** The account details have arrived, so `needsConnect` is settled. */
  accountKnown?: boolean;
  businessName?: string;
  /** The business's profile photo, for "You" in the reactions panel. */
  businessAvatar?: string;
  onConnectClick?: () => void;
  onOpenTemplatesPage?: () => void;
  onOpenTemplateCreate?: () => void;
}

export function CrmApp({
  config, initialPhone = null, openRequest = null, demo = false, businessId,
  visible = true, onUnreadChange, needsConnect = false, accountKnown = true, businessName = '', businessAvatar = '', onConnectClick,
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
  // WhatsApp voice calls (the shell's CallProvider; absent outside the shell).
  const calls = useCalls();

  const [chats, setChats] = useState<Chat[]>([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const toast = useNotify();
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [activeName, setActiveName] = useState('');

  const [draft, setDraft] = useState('');
  // Files behind media bubbles that are still uploading (or failed, for
  // Retry), by the bubble's temporary id.
  const localFilesRef = useRef(new Map<string, { file: File; caption?: string; voice?: boolean; url: string }>());
  // Once a bubble is gone (replaced by the saved message, or another chat
  // opened), its local copy is let go.
  useEffect(() => {
    const inUse = new Set<string>();
    for (const m of messages) {
      inUse.add(m._id);
      if (m.raw?.localPreview) inUse.add(m.raw.localPreview);
    }
    for (const [id, local] of localFilesRef.current) {
      // Still a bubble, or the saved message still draws this local copy.
      if (inUse.has(id) || inUse.has(local.url)) continue;
      URL.revokeObjectURL(local.url);
      localFilesRef.current.delete(id);
    }
  }, [messages]);

  const [paused, setPaused] = useState(false);
  const [pausing, setPausing] = useState(false);

  // The ⋮ menu's action in flight (Mute, Favourite, Block, Clear, Delete).
  const [menuBusy, setMenuBusy] = useState<ChatMenuBusy>(null);
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
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [tSending, setTSending] = useState(false);

  // Flow picker (send a published WhatsApp Flow into the chat).
  const [flowDrawerOpen, setFlowDrawerOpen] = useState(false);
  const [flows, setFlows] = useState<WaFlowDef[]>([]);
  const [flowsLoading, setFlowsLoading] = useState(false);
  const [fSending, setFSending] = useState(false);

  // 24h window state.
  const [windowExpiresAt, setWindowExpiresAt] = useState(0);
  // The countdown text ticks inside <SessionTimer>; this only flips when the
  // window closes, so the chat doesn't re-render every second.
  const windowOpen = useWindowOpen(windowExpiresAt);

  // Refs so socket handlers see the latest values without re-subscribing.
  const activePhoneRef = useRef<string | null>(null);
  activePhoneRef.current = activePhone;
  // The chat being read (open, on screen): its messages don't pop up on the
  // desktop. Every other message, page or app in front does.
  useEffect(() => {
    if (demo) return undefined;
    const report = () => setWatchingChat(visible && !document.hidden ? activePhone : null);
    report();
    document.addEventListener('visibilitychange', report);
    return () => {
      document.removeEventListener('visibilitychange', report);
      setWatchingChat(null);
    };
  }, [activePhone, visible, demo]);
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

  // ---- Paging: a chat opens on its newest PAGE messages; older pages load
  // as the agent nears the top, before they get there, so it scrolls on
  // without waiting. The message on screen stays put when a page is added. ----
  const PAGE = 50;
  // About how long the browser's smooth scroll to a quoted message takes.
  const JUMP_SCROLL_MS = 900;
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const hasOlderRef = useRef(false);
  hasOlderRef.current = hasOlder;
  const olderInFlight = useRef<Promise<void> | null>(null);
  // The message that was at the top and where it was (CSS px from the box
  // top), so the view is put back exactly once the older page is drawn.
  const anchorRef = useRef<{ id: string; top: number } | null>(null);
  // Until when a quote jump's smooth scroll is running (ms timestamp).
  const jumpScrollUntil = useRef(0);
  const loadOlder = useCallback((): Promise<void> => {
    if (olderInFlight.current) return olderInFlight.current;
    const phone = activePhoneRef.current;
    const oldest = messagesRef.current.find((m) => m.createdAt && !isTemp(m));
    if (!phone || !hasOlderRef.current || !oldest) return Promise.resolve();
    setLoadingOlder(true);
    const run = api
      .getMessages(phone, { limit: PAGE, before: oldest })
      .then((res) => {
        if (activePhoneRef.current !== phone) return;
        const page = res.data || [];
        // Where the oldest message is now, just before the page goes in: the
        // reader may have kept scrolling while it loaded, and that's the
        // position to keep (measuring at request time put the view back).
        const box = msgBoxRef.current;
        const el = box?.querySelector<HTMLElement>(`[data-msg-id="${oldest._id}"]`);
        if (box && el) {
          const s = uiScale();
          anchorRef.current = { id: oldest._id, top: (el.getBoundingClientRect().top - box.getBoundingClientRect().top) / s };
        }
        setMessages((list) => {
          const have = new Set(list.map((m) => m._id));
          return [...page.filter((m) => !have.has(m._id)), ...list];
        });
        setHasOlder(!!res.hasMore && page.length > 0);
      })
      .catch(() => {
        anchorRef.current = null;
      })
      .finally(() => {
        olderInFlight.current = null;
        if (activePhoneRef.current === phone) setLoadingOlder(false);
      });
    olderInFlight.current = run;
    return run;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  // Put the anchored message back where it was, before the browser paints.
  useLayoutEffect(() => {
    const a = anchorRef.current;
    const box = msgBoxRef.current;
    if (!a || !box) return;
    const el = box.querySelector<HTMLElement>(`[data-msg-id="${a.id}"]`);
    if (!el) return;
    anchorRef.current = null;
    const s = uiScale();
    const now = (el.getBoundingClientRect().top - box.getBoundingClientRect().top) / s;
    box.scrollTop += now - a.top;
  }, [messages]);
  // Near the top (within ~1.5 screens): fetch the next older page. Also when
  // a page doesn't fill the box, so there's something to scroll.
  const maybeLoadOlder = useCallback(() => {
    const box = msgBoxRef.current;
    if (!box || !hasOlderRef.current || olderInFlight.current) return;
    // A quote jump is scrolling: an older page now would put the view back
    // (anchor) and cut the smooth scroll short of the quoted message.
    if (Date.now() < jumpScrollUntil.current) return;
    if (box.scrollTop < Math.max(400, box.clientHeight * 1.5) || box.scrollHeight <= box.clientHeight + 40) loadOlder();
  }, [loadOlder]);
  useEffect(() => {
    const box = msgBoxRef.current;
    if (!box) return undefined;
    const onScroll = () => maybeLoadOlder();
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => box.removeEventListener('scroll', onScroll);
  }, [maybeLoadOlder, activePhone]);
  // A page that came in short of filling the box: look again once it's drawn.
  useEffect(() => {
    if (!hasOlder || loadingOlder) return undefined;
    const t = setTimeout(maybeLoadOlder, 150);
    return () => clearTimeout(t);
  }, [hasOlder, loadingOlder, messages.length, maybeLoadOlder]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      const box = msgBoxRef.current;
      if (box) box.scrollTop = box.scrollHeight;
    }, 60);
  }, []);

  // ---- "Scroll to the latest" arrow: shown while the reader is up in the
  // history; counts customer messages that arrive meanwhile. ----
  const [showJump, setShowJump] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const nearBottomRef = useRef(true);
  useEffect(() => {
    const box = msgBoxRef.current;
    setShowJump(false);
    setUnseen(0);
    nearBottomRef.current = true;
    if (!box) return undefined;
    const onScroll = () => {
      const gap = box.scrollHeight - box.scrollTop - box.clientHeight;
      const near = gap < 160;
      nearBottomRef.current = near;
      setShowJump(gap > 300);
      if (near) setUnseen(0);
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => box.removeEventListener('scroll', onScroll);
  }, [activePhone]);
  const jumpToLatest = useCallback(() => {
    const box = msgBoxRef.current;
    if (!box) return;
    setUnseen(0);
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  }, []);
  /** A new message in the open chat: follow it if at the bottom, else count it on the arrow. */
  const followNew = useCallback((m: ChatMessage) => {
    if (m.direction === 'out' || nearBottomRef.current) {
      scrollToBottom();
      return;
    }
    setUnseen((n) => n + 1);
  }, [scrollToBottom]);

  // Photos and videos get their height only once they load, after the chat
  // has scrolled to the newest message. If the reader was at the bottom, keep
  // them there as the media grows the list.
  useEffect(() => {
    const box = msgBoxRef.current;
    if (!box) return undefined;
    let atBottom = true;
    const onScroll = () => {
      atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    };
    let lastHeight = box.scrollHeight;
    const grew = new ResizeObserver(() => {
      const h = box.scrollHeight;
      // Not while a quote jump scrolls up: the older pages it just loaded grow
      // the list too, and pinning to the bottom would cancel the jump.
      if (h > lastHeight && atBottom && Date.now() >= jumpScrollUntil.current) box.scrollTop = h;
      lastHeight = h;
    });
    // The list's content box: observe every bubble row as it's added.
    const watchAll = () => box.querySelectorAll(':scope > *').forEach((el) => grew.observe(el));
    const added = new MutationObserver(watchAll);
    watchAll();
    added.observe(box, { childList: true });
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      grew.disconnect();
      added.disconnect();
      box.removeEventListener('scroll', onScroll);
    };
  }, [activePhone]);

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
      // Clear the previous thread so its messages don't flash under the new
      // header, and show placeholders until this one arrives.
      setMessages([]);
      setHasOlder(false);
      anchorRef.current = null;
      olderInFlight.current = null;
      setLoadingOlder(false);
      setMsgsLoading(true);
      api
        .getMessages(phone, { limit: PAGE })
        .then((res) => {
          // The user may have switched again while this was in flight.
          if (activePhoneRef.current !== phone) return;
          const list = res.data || [];
          setMessages(list);
          setHasOlder(!!res.hasMore);
          scrollToBottom();

          // The 24h window: the later of the customer's last message in this
          // page and the time the server keeps for the chat. The server's can
          // be later with no inbound row to show for it: the customer picking
          // up one of our calls opens the window too (the call row is ours,
          // "out"). Taking only the row made the timer jump back after load.
          const lastInboundMsg = [...list].reverse().find((m) => m.direction === 'in');
          const ms = (iso?: string | null) => {
            const t = iso ? new Date(iso).getTime() : 0;
            return Number.isNaN(t) ? 0 : t;
          };
          const latestIn = Math.max(ms(lastInboundMsg?.createdAt), ms(res.lastInboundAt));
          const lastInboundAt = latestIn > 0 ? new Date(latestIn).toISOString() : '';
          if (lastInboundAt) {
            const inTime = latestIn;
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
        setMessages((list) =>
          list.map((x) => {
            if (x._id !== m._id) return x;
            const next = withEarlyStatus(m, x);
            // A file sent from here keeps its bubble and local copy.
            return x.raw?.localKey
              ? { ...next, raw: { ...next.raw, localPreview: x.raw.localPreview, localKey: x.raw.localKey } }
              : next;
          }),
        );
        // A call row moves on (ringing → missed / 2:14): the chat list line follows.
        if (m.type === 'call') {
          setChats((list) => list.map((c) => (c.phone === m.phone ? { ...c, lastMessageBody: previewOf(m) } : c)));
          // The customer picking up our call opens the 24h window on the
          // server: re-read the chat record so the open timer follows.
          scheduleChatsRefresh();
        }
        return;
      }
      if (m.phone === activePhoneRef.current) {
        setMessages((list) => {
          if (list.some((x) => x._id === m._id)) return list;
          const fresh = withEarlyStatus(m);
          // Our own text echoed back: swap it in for the optimistic copy that
          // is already on screen instead of showing it twice.
          if (m.direction === 'out') {
            // A file we sent: the oldest of its kind still uploading (they
            // go one at a time). Text: the copy with the same words.
            const mediaType = m.raw?.outbound?.mediaType;
            const i = list.findIndex(
              (x) =>
                isTemp(x) &&
                x.phone === m.phone &&
                x.status !== 'failed' &&
                (mediaType
                  ? !!x.raw?.localUpload && x.raw?.outbound?.mediaType === mediaType
                  : !x.raw?.localUpload && x.body === m.body),
            );
            if (i >= 0) {
              const next = [...list];
              const temp = list[i];
              // A file we sent: keep the same bubble and keep drawing the
              // local copy, so the photo doesn't blank while the saved one loads.
              next[i] = temp.raw?.localUpload
                ? { ...fresh, raw: { ...fresh.raw, localPreview: temp.raw.outbound?.mediaUrl, localKey: temp._id } }
                : fresh;
              return next;
            }
            return [...list, fresh];
          }
          // A customer message is filed at the time they sent it, which can be
          // before a message that reached us first (Meta doesn't keep the
          // order): slot it in after the last saved message that isn't later.
          // Messages still being sent stay where they are.
          const at = new Date(m.createdAt || 0).getTime();
          if (!(at > 0)) return [...list, fresh];
          let pos = list.length;
          while (pos > 0) {
            const prev = list[pos - 1];
            const prevAt = new Date(prev.createdAt || 0).getTime();
            if (isTemp(prev) || !(prevAt > at)) break;
            pos -= 1;
          }
          return [...list.slice(0, pos), fresh, ...list.slice(pos)];
        });
        followNew(m);
        // Only mark it read if the chat is really on screen; otherwise it waits
        // (and counts as unread) until the user comes back to it.
        if (m.direction === 'in' && isWatching()) api.markRead(m.phone).catch(() => {});
      }
      if (m.direction === 'in') {
        // Sound and desktop nudge come with the message's notification
        // (CrmShell, per Settings → Manage Notifications). The demo has no
        // notifications, so it alerts here.
        // A muted chat stays quiet (the server skips its notification too).
        const known = chatsRef.current.find((c) => c.phone === m.phone);
        if (demo && !isMutedNow(known?.mutedUntil)) {
          const prefs = loadPrefs();
          if (wants(prefs, 'message', 'sound')) playSound(prefs.soundType);
          const sender = known
            ? chatDisplayName(known)
            : m.name || (m.channel === 'messenger' ? 'Messenger user' : m.channel === 'instagram' ? 'Instagram user' : `+${m.phone}`);
          if (wants(prefs, 'message', 'desktop') && (!isWatching() || m.phone !== activePhoneRef.current)) {
            notify(sender, m.body?.trim() || 'New message');
          }
        }
        // A message from the customer reopens the 24h window. The open chat's
        // timer and composer follow it straight away, not on the next refresh.
        if (m.phone === activePhoneRef.current) {
          const at = new Date(m.createdAt || Date.now()).getTime();
          setWindowExpiresAt((cur) => Math.max(cur, at + WINDOW_MS));
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

    return () => {
      offMsg();
      offStatus();
      offReaction();
      offTyping();
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
    const apply = (r: { enabled?: boolean; contacts?: SandboxContacts }) =>
      live && setSandboxContacts(r.enabled && r.contacts ? r.contacts : null);
    const load = () => {
      api.getSandbox().then(apply).catch(() => {});
    };
    // The first read shares the connect page's (already on its way); after a
    // reconnect, ask again.
    prepareOnboarding(api).then((p) => apply(p.sandbox)).catch(() => {});
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
  // Muted chats keep their own (grey) count but don't add to this one.
  const unreadChats = chats.filter((c) => c.unread > 0 && !isMutedNow(c.mutedUntil)).length;
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
    if (!phone) return;
    // A file that failed to upload: upload the same file again.
    if (m.raw?.localUpload) {
      const local = localFilesRef.current.get(m._id);
      if (!local) return;
      setMessages((list) => list.filter((x) => x._id !== m._id));
      queueMedia(phone, [{ file: local.file, caption: local.caption, voice: local.voice }]);
      return;
    }
    if (!m.body) return;
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

  /**
   * Media goes out like text: the bubble shows at once from the local file
   * (clock icon, spinner on photos and videos) and the upload runs behind it.
   * The socket echo of the saved message replaces the copy; a failed upload
   * stays as "Not delivered" with Retry. Files go one after another, so they
   * arrive in the order they were picked.
   */
  function queueMedia(phone: string, files: { file: File; caption?: string; voice?: boolean }[]) {
    const uploads = files.map((f) => stageMedia(phone, f.file, f.caption, f.voice));
    scrollToBottom();
    void uploads.reduce((prev, upload) => prev.then(upload), Promise.resolve());
  }

  function stageMedia(phone: string, file: File, caption?: string, voice?: boolean): () => Promise<void> {
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const url = URL.createObjectURL(file);
    const mime = file.type || '';
    const mediaType = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
          ? 'audio'
          : 'document';
    localFilesRef.current.set(tempId, { file, caption, voice, url });
    const temp: ChatMessage = {
      _id: tempId,
      phone,
      direction: 'out',
      type: mediaType,
      body: caption || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      raw: {
        localUpload: true,
        outbound: { type: mediaType, body: caption || '', mediaType, mediaUrl: url, filename: file.name, voice: !!voice },
      },
    };
    setMessages((list) => [...list, temp]);
    const setStatus = (status: string) =>
      setMessages((list) => list.map((x) => (x._id === tempId ? { ...x, status } : x)));
    return () =>
      api
        .sendMedia(phone, file, caption, voice)
        .then(() => setStatus('sent')) // no-op once the socket echo has replaced it
        .catch((e: Error) => {
          setStatus('failed');
          toast(
            'error',
            voice ? 'Voice message not sent' : 'File not sent',
            e?.message || (voice ? 'Could not send the voice note.' : 'Could not send the file.'),
          );
        });
  }

  // Send a recorded voice note.
  function sendVoice(file: File) {
    const phone = activePhone;
    if (!phone) return;
    queueMedia(phone, [{ file, voice: true }]);
  }

  // Send all previewed attachments (each with its caption): the preview
  // closes straight away and the files show in the chat while they upload.
  function sendPendingFiles(toSend: { file: File; caption: string }[]) {
    const phone = activePhone;
    if (!phone || !toSend.length) return;
    setPendingFiles([]);
    queueMedia(
      phone,
      toSend.map((it) => ({ file: it.file, caption: it.caption.trim() || undefined })),
    );
  }

  // Polls and events from the composer's + menu. The sent message comes back
  // over the socket like any other; a failure is thrown to the dialog, which
  // keeps what was typed.
  async function sendPoll(poll: PollInput) {
    const phone = activePhone;
    if (!phone) return;
    await api.sendPoll(phone, poll);
    jumpToLatest();
  }
  async function sendEvent(ev: EventInput) {
    const phone = activePhone;
    if (!phone) return;
    await api.sendEvent(phone, ev);
    jumpToLatest();
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

  const patchChat = (phone: string, patch: Partial<Chat>) =>
    setChats((list) => list.map((c) => (c.phone === phone ? { ...c, ...patch } : c)));

  /** ⋮ → Mute notifications (8 hours / 1 week / Always), or Unmute (null). */
  function muteChat(until: MuteFor | null) {
    const phone = activePhone;
    if (!phone) return;
    setMenuBusy('mute');
    api
      .muteChat(phone, until)
      .then((res) => {
        patchChat(phone, { mutedUntil: res.mutedUntil });
        if (until) toast('success', 'Chat muted', `${mutedLabel(res.mutedUntil)}. Messages still arrive, without sound, pop-ups or push.`);
        else toast('success', 'Chat unmuted', 'You’ll be alerted to new messages from this chat again.');
      })
      .catch((e: Error) => toast('error', 'Failed', e.message || 'Could not change notifications for this chat.'))
      .finally(() => setMenuBusy(null));
  }

  function toggleFavourite() {
    const phone = activePhone;
    if (!phone) return;
    const next = !activeChat?.favourite;
    setMenuBusy('favourite');
    api
      .setFavourite(phone, next)
      .then((res) => {
        patchChat(phone, { favourite: res.favourite });
        toast('success', res.favourite ? 'Added to favourites' : 'Removed from favourites',
          res.favourite ? 'Tap ♥ next to + above your chats to see your favourites.' : '');
      })
      .catch((e: Error) => toast('error', 'Failed', e.message || 'Could not update favourites.'))
      .finally(() => setMenuBusy(null));
  }

  async function toggleBlock() {
    const phone = activePhone;
    if (!phone) return;
    const name = activeName;
    const wasBlocked = !!activeChat?.blocked;
    if (!wasBlocked) {
      const ok = await confirm({
        title: `Block ${name}?`,
        message: metaChat
          ? 'Their messages will be ignored: not saved, no alerts and no bot replies. You won’t be able to message them until you unblock them.'
          : 'Blocked contacts can’t message or call you, and you can’t message them. Anything they send is ignored: not saved, no alerts, no bot replies.',
        confirmLabel: 'Block',
      });
      if (!ok) return;
    }
    setMenuBusy('block');
    api
      .setBlocked(phone, !wasBlocked)
      .then((res) => {
        patchChat(phone, { blocked: res.blocked, blockedAtMeta: res.blocked && res.atMeta });
        if (!res.blocked) toast('success', 'Contact unblocked', `You can message ${name} again.`);
        else if (res.atMeta) toast('success', 'Contact blocked', `${name} can’t message or call you on WhatsApp.`);
        else if (res.note) toast('success', 'Blocked in the CRM', `${res.note} Their messages and calls will be ignored here.`);
        else toast('success', 'Contact blocked', 'Their messages will be ignored here.');
      })
      .catch((e: Error) => toast('error', wasBlocked ? 'Unblock failed' : 'Block failed', e.message || 'Please try again.'))
      .finally(() => setMenuBusy(null));
  }

  /** ⋮ → Delete chat: the messages and the contact go; the thread closes. */
  async function deleteChatAndContact() {
    const phone = activePhone;
    if (!phone) return;
    const name = activeName;
    const blockedNow = !!activeChat?.blocked;
    const ok = await confirm({
      title: 'Delete this chat?',
      message: `This deletes the chat with ${name} and removes them from your contacts, with every message, photo, video and file. It can’t be undone.${blockedNow ? ' They stay blocked.' : ''}`,
      confirmLabel: 'Delete chat',
    });
    if (!ok) return;
    setMenuBusy('delete');
    api
      .deleteContact(phone)
      .then(() => {
        closeActiveChat();
        setMessages([]);
        setHasOlder(false);
        setChats((list) => list.filter((c) => c.phone !== phone));
        toast('success', 'Chat deleted', `${name} was removed from your contacts.`);
      })
      .catch((e: Error) => toast('error', 'Delete failed', e.message || 'Could not delete the chat.'))
      .finally(() => setMenuBusy(null));
  }

  /** ⋮ → Clear chat: every message and file goes; the contact stays. */
  async function deleteChat() {
    const phone = activePhone;
    if (!phone) return;
    const name = activeName;
    const ok = await confirm({
      title: 'Clear this chat?',
      message: `All messages in this chat with ${name}, including photos, videos and files, are deleted for good. ${name} stays in your contacts.`,
      confirmLabel: 'Clear chat',
    });
    if (!ok) return;
    setMenuBusy('clear');
    api
      .deleteChat(phone)
      .then(() => {
        setMenuBusy(null);
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
        setHasOlder(false);
        toast('success', 'Chat cleared', `Messages with ${name} were deleted. ${name} stays in your contacts.`);
      })
      .catch((e: Error) => {
        setMenuBusy(null);
        toast('error', 'Clear failed', e.message || 'Could not clear the chat.');
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
    setTemplatesLoading(true);
    return api
      .getTemplates({ includeShared: true })
      .then((res) => setTemplates(res.data || []))
      .catch(() => setTemplates([]))
      .finally(() => setTemplatesLoading(false));
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
  async function jumpToMessage(id?: string) {
    if (!id) return;
    const box = msgBoxRef.current;
    const find = () => box?.querySelector<HTMLElement>(`[data-msg-id="${id}"]`) || null;
    let el = find();
    // Quoting a message older than what's loaded: load earlier pages until
    // it's there (a long way back stops after 20 pages, 1,000 messages).
    // Meanwhile the list must not pin itself to the bottom as it grows.
    if (!el) jumpScrollUntil.current = Date.now() + 60_000;
    for (let i = 0; !el && hasOlderRef.current && i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await loadOlder();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 40));
      el = find();
    }
    if (!el) {
      jumpScrollUntil.current = 0;
      return;
    }
    // Scroll only the message list. scrollIntoView() would also scroll every
    // ancestor (even overflow:hidden ones) and shift the whole CRM.
    // Rects are screen px, scrollTop / clientHeight are CSS px (they differ in the 90% view).
    const s = uiScale();
    const boxRect = box!.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    // No prefetch while it scrolls; once it's there, look again (it may have
    // landed near the top, where the next page is due).
    jumpScrollUntil.current = Date.now() + JUMP_SCROLL_MS;
    setTimeout(() => {
      jumpScrollUntil.current = 0;
      maybeLoadOlder();
    }, JUMP_SCROLL_MS + 50);
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

  // The message bubbles are memoised (MessageItem): they get callbacks that
  // never change identity and call the latest handlers, so typing in the
  // composer, the typing indicator or a new chat-list row don't redraw them.
  const handlers = useRef({ toggleReact, react, retrySend, jumpToMessage });
  handlers.current = { toggleReact, react, retrySend, jumpToMessage };
  const onToggleReactStable = useCallback((m: ChatMessage) => handlers.current.toggleReact(m), []);
  const onReactStable = useCallback((m: ChatMessage, emoji: string) => handlers.current.react(m, emoji), []);
  const onRetryStable = useCallback((m: ChatMessage) => handlers.current.retrySend(m), []);
  const onJumpToStable = useCallback((id?: string) => handlers.current.jumpToMessage(id), []);
  const onCloseReactStable = useCallback(() => setReactingId(null), []);
  const onReplyStable = useCallback((msg: ChatMessage) => setReplyingTo(msg), []);

  // The reactions panel's people: the customer (number, then their WhatsApp
  // name, as WhatsApp lists them) and the business as "You".
  const activeChatName = activeChat?.name || activeName;
  const activeChatChannel = activeChat?.channel || 'whatsapp';
  const activeChatAvatar = activeChat?.avatarUrl;
  const people = useMemo(() => {
    const phoneLabel = activePhone && /^\d{6,}$/.test(activePhone) ? `+${activePhone}` : '';
    const name = activeChatName && activeChatName !== phoneLabel ? activeChatName : '';
    return {
      customer: {
        name: phoneLabel || name || 'Customer',
        sub: phoneLabel && name ? `~${name}` : '',
        avatarUrl: activeChatAvatar,
        channel: activeChatChannel,
      },
      you: { name: businessName || 'You', avatarUrl: businessAvatar || undefined },
    };
  }, [activePhone, activeChatName, activeChatChannel, activeChatAvatar, businessName, businessAvatar]);
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
          // Not yet known whether WhatsApp is connected: neither page yet (the
          // empty inbox used to show first, then swap to the connect page).
          !accountKnown ? (
            <div className="no-chat-wait" data-testid="chat-empty-wait" aria-busy="true">
              <span className="no-chat-wait-spin" aria-hidden="true" />
            </div>
          ) : needsConnect ? (
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
                      <CountryFlag phone={activePhone} size={18} className="flag" />
                      <span className="th-num">+{activePhone}</span>
                    </>
                  )}
                </div>
              </div>

              <SessionTimer expiresAt={windowExpiresAt} metaChat={metaChat} />

              {/* WhatsApp voice call; video isn't in Meta's Calling API yet (Soon). */}
              {!metaChat && calls?.available && activePhone && (
                <div className="th-call-group">
                  <button
                    type="button"
                    className={`th-call${calls.activePhone === activePhone ? ' live' : ''}`}
                    onClick={() => calls.startCall(activePhone, activeChat?.name || activeName)}
                    disabled={calls.busy || !!activeChat?.blocked}
                    title={activeChat?.blocked ? 'Unblock this contact to call them' : calls.busy ? (calls.activePhone === activePhone ? 'On a call with them' : 'You’re on another call') : 'WhatsApp voice call'}
                    aria-label="Voice call"
                    data-testid="th-call"
                  >
                    <CallIcon />
                  </button>
                  <button
                    type="button"
                    className="th-call soon"
                    disabled
                    title="Video calls aren’t in WhatsApp’s Calling API yet"
                    aria-label="Video call (coming soon)"
                    data-testid="th-video"
                  >
                    <VideocamIcon />
                    <SoonPill />
                  </button>
                </div>
              )}

              {/* ⋮ menu: Bot / Manual for this chat (on Messenger / Instagram it switches
                  that channel's journey on or off for this customer), Mute, Favourites,
                  Close, Block, Clear chat, Delete chat. */}
              <ChatHeaderMenu
                key={activePhone}
                paused={paused}
                pausing={pausing}
                onTogglePause={togglePause}
                mutedUntil={activeChat?.mutedUntil}
                onMute={muteChat}
                favourite={!!activeChat?.favourite}
                onToggleFavourite={toggleFavourite}
                onCloseChat={closeActiveChat}
                blocked={!!activeChat?.blocked}
                onToggleBlock={toggleBlock}
                onClear={deleteChat}
                onDelete={deleteChatAndContact}
                busy={menuBusy}
              />
            </header>


            <div className="messages-wrap">
            <div className="messages" ref={msgBoxRef}>
              {/* Older messages on the way: a pill floating at the top. It
                  takes no room, so nothing in the thread moves for it. */}
              {loadingOlder && (
                <div className="msgs-older" role="status" data-testid="msgs-older">
                  <span className="msgs-older-pill">
                    <span className="msgs-older-spin" aria-hidden="true" />
                    Loading earlier messages…
                  </span>
                </div>
              )}
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
                  <Fragment key={m.raw?.localKey || m._id}>
                    {newDay && (
                      <div className="day-sep" role="separator">
                        <span>{dayLabel(m.createdAt)}</span>
                      </div>
                    )}
                    <MessageItem
                      message={m}
                      api={api}
                      reacting={reactingId === m._id}
                      onToggleReact={onToggleReactStable}
                      onReact={onReactStable}
                      onCloseReact={onCloseReactStable}
                      onReply={onReplyStable}
                      onJumpTo={onJumpToStable}
                      onViewMedia={setViewMedia}
                      onRetry={m.type === 'text' || m.raw?.localUpload ? onRetryStable : undefined}
                      people={people}
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
              {/* Scrolled up: a round arrow to the newest message (WhatsApp style),
                  with how many arrived meanwhile. Gone at the bottom. */}
              {showJump && (
                <button
                  type="button"
                  className="jump-latest"
                  onClick={jumpToLatest}
                  aria-label={unseen ? `${unseen} new message${unseen === 1 ? '' : 's'}: scroll to the latest` : 'Scroll to the latest message'}
                  title="Scroll to the latest message"
                  data-testid="jump-latest"
                >
                  {unseen > 0 && <span className="jump-count" data-testid="jump-count">{unseen > 99 ? '99+' : unseen}</span>}
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                    <path d="M12 15.4 6.6 10l1.4-1.4 4 4 4-4 1.4 1.4z" />
                  </svg>
                </button>
              )}
            </div>

            {activeChat?.blocked ? (
              // Blocked from the ⋮ menu: nothing goes out (the server refuses too).
              <div className="chat-blocked-bar" data-testid="chat-blocked">
                <span className="material-icons" aria-hidden="true">block</span>
                <div>
                  <strong>You blocked this contact</strong>
                  {!metaChat && activeChat.blockedAtMeta
                    ? 'They can’t message or call you on WhatsApp.'
                    : 'Their messages and calls are ignored.'}
                </div>
                <button
                  type="button"
                  className="cb-btn"
                  onClick={toggleBlock}
                  disabled={menuBusy === 'block'}
                  data-testid="chat-unblock"
                >
                  {menuBusy === 'block' ? 'Unblocking…' : 'Unblock'}
                </button>
              </div>
            ) : activeChat?.locked ? (
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
              uploading={false /* media uploads run behind their chat bubbles */}
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
              onSendPoll={metaChat ? undefined : sendPoll}
              onSendEvent={metaChat ? undefined : sendEvent}
              canCallLink={!!calls?.available}
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
                loading={templatesLoading}
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
                sending={false}
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
