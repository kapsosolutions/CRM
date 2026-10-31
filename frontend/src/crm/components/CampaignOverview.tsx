// Enterprise Campaigns Overview dashboard (inspired by Wati / Meta WhatsApp CRM)
// Displays campaign analytics, messaging limits, delivery funnel metrics, and
// an interactive Campaign Planner with Calendar and List views.
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { CrmApi } from '../api';
import type {
  BusinessProfile, TemplateItem, Campaign, CampaignChannel, CampaignDetail, CampaignOverviewData, CampaignStats, CampaignStatus,
  CampaignRecipientResult, MetaAudienceCounts, MetaChannelsInfo, MetaCampaignInitialContent, MetaChannel,
} from '../types';
import './MetaMessaging.css';
import { TemplateLibrary } from './TemplateLibrary';
import { MetaChannelTemplateList } from './CampaignTemplateLists';
import { useNotify, useConfirm } from './Dialogs';

import { TemplatePhonePreview, previewPropsFromTemplate } from './TemplatePhonePreview';
import { Dropdown, type KOption } from './Dropdown';
import { TemplateViewSvg, TemplateSearchSvg } from './TemplateIcons';
import { CustomDateTimePicker } from './CustomDateTimePicker';
import { isAuthTemplate } from '../authTemplate';

const SORT_OPTIONS: KOption[] = [
  { value: 'latest', label: 'Latest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name (A–Z)' },
];

const TIME_RANGE_OPTIONS: KOption[] = [
  { value: 'Last 7 days', label: 'Last 7 days' },
  { value: 'Last 14 days', label: 'Last 14 days' },
  { value: 'Last 30 days', label: 'Last 30 days' },
  { value: 'This Month', label: 'This Month' },
  { value: 'All Time', label: 'All Time' },
  { value: 'Custom', label: 'Custom' },
];

const LANGUAGE_LABEL: Record<string, string> = {
  en_US: 'English (US)',
  en: 'English',
  en_GB: 'English (UK)',
  hi: 'Hindi',
  te: 'Telugu',
  ta: 'Tamil',
};

const STATUS_TONE: Record<string, string> = {
  APPROVED: 'green',
  REJECTED: 'red',
  PAUSED: 'grey',
  DISABLED: 'grey',
  DRAFT: 'amber',
};

const titleCase = (s?: string) => {
  const v = String(s || '').replace(/_/g, ' ').toLowerCase();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : '—';
};

/** A campaign as the overview lists it (from GET /api/campaigns). */
export interface CampaignRecord {
  id: string;
  name: string;
  template: string;
  /** The channel's name, as shown and exported. */
  channel: string;
  channelKey: CampaignChannel;
  /** When it went out, or will: start time, else schedule, else creation. */
  dateMs: number;
  date: string;
  recipients: number;
  status: CampaignStatus;
  stats: CampaignStats;
  /** Drip waiting for its next follow-up: when it is due. */
  dripNextAt: string | null;
  /** Why the whole campaign stopped, if it did. */
  error: string;
}

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** A drip follow-up's wait, in words ("2 hours after the previous message"). */
function waitText(ms: number): string {
  if (!ms) return 'Right after the previous one';
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const d = ms / 86400000;
  const h = ms / 3600000;
  const m = Math.round(ms / 60000);
  if (Number.isInteger(d)) return `${plural(d, 'day')} later`;
  if (Number.isInteger(h)) return `${plural(h, 'hour')} later`;
  return `${plural(m, 'minute')} later`;
}

const RECIPIENT_LABEL: Record<CampaignRecipientResult['status'], string> = {
  pending: 'Pending',
  cancelled: 'Not sent (cancelled)',
  sent: 'Sent, not delivered yet',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
  skipped: 'Skipped',
};

const CHANNEL_NAME: Record<CampaignChannel, string> = { whatsapp: 'WhatsApp', messenger: 'Messenger', instagram: 'Instagram' };
const CHANNEL_ICON: Record<CampaignChannel, string> = {
  whatsapp: '/whatsapp.svg',
  messenger: '/channel-messenger.svg',
  instagram: '/channel-instagram.svg',
};
const channelOf = (c: { channel?: string }): CampaignChannel =>
  c.channel === 'messenger' || c.channel === 'instagram' ? c.channel : 'whatsapp';

/** Meta's quality rating as the card shows it. */
const QUALITY: Record<string, { label: string; tone: string; color: string }> = {
  GREEN: { label: 'High', tone: 'high', color: '#24d06e' },
  YELLOW: { label: 'Medium', tone: 'medium', color: '#f59e0b' },
  RED: { label: 'Low', tone: 'low', color: '#ef4444' },
  UNKNOWN: { label: 'Not rated yet', tone: 'unknown', color: '#9ca3af' },
};

const ZERO_STATS: CampaignStats = {
  total: 0, accepted: 0, delivered: 0, read: 0, failed: 0, pending: 0, sentOnly: 0, replied: 0, cancelled: 0,
};

const POLL_MS = 15000;
const OVERVIEW_TAB_KEY = 'crm_campaigns_overview_channel';
// Campaigns are WhatsApp only: Messenger / Instagram campaigns can only reach
// people inside the 24-hour window, so they are hidden from this page. Their
// code stays; add them back here (and in the sidebar) to show them again.
const CHANNELS: CampaignChannel[] = ['whatsapp'];

function formatWhen(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return (
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  );
}

function toRecord(c: Campaign): CampaignRecord {
  const when = c.startedAt || c.scheduledAt || c.createdAt;
  const dateMs = when ? new Date(when).getTime() || 0 : 0;
  return {
    id: c._id,
    name: c.name,
    template: c.templateName || '—',
    channel: CHANNEL_NAME[channelOf(c)],
    channelKey: channelOf(c),
    dateMs,
    date: formatWhen(dateMs),
    recipients: c.total,
    status: c.status,
    stats: c.stats || { ...ZERO_STATS, total: c.total, pending: c.total },
    error: c.error || '',
    dripNextAt: c.dripNextAt || null,
  };
}

/** "YYYY-MM-DD" of a local date. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO → the datetime-local value the editor uses. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** A campaign failure reason in one line, plus the full text for a tooltip. */
function reasonText(e: CampaignRecipientResult['error']): { short: string; full: string } {
  if (!e) return { short: '', full: '' };
  const short = e.title && e.message && e.title !== e.message ? `${e.title}: ${e.message}` : e.message || e.title;
  const full = [e.code ? `Error ${e.code}` : '', short, e.details].filter(Boolean).join(' · ');
  return { short, full };
}

interface Props {
  api: CrmApi;
  business?: BusinessProfile;
  demo?: boolean;
  templates: TemplateItem[];
  onCreateNew: (templateName?: string, draftData?: any) => void;
  /** Open the Create template page, optionally filled in from a library template. */
  onCreateTemplate?: (from?: TemplateItem) => void;
  onNavigate?: (view: any) => void;
  /** Open this campaign's results modal, e.g. from a notification. */
  focusRequest?: { id: string; n: number } | null;
  /** A WhatsApp template was created from the library (reload the list). */
  onTemplatesChanged?: () => void;
}

export function CampaignOverview({
  api,
  business: _business,
  demo: _demo,
  focusRequest,
  templates,
  onCreateNew,
  onCreateTemplate,
  onNavigate,
  onTemplatesChanged,
}: Props) {
  // Navigation & view states
  // library: the Template Library gallery · wa / messenger / instagram: that channel's templates list
  const [activeNav, setActiveNav] = useState<'overview' | 'library' | 'wa' | 'messenger' | 'instagram' | 'scheduled'>('overview');
  const tplNav = activeNav === 'wa' || activeNav === 'messenger' || activeNav === 'instagram' ? activeNav : null;
  /** A new Messenger / Instagram campaign, optionally with its content preselected. */
  const newMetaCampaign = (ch: MetaChannel, initialContent?: MetaCampaignInitialContent) => onCreateNew(undefined, { channel: ch, initialContent: initialContent || null });
  const [templateMenuOpen, setTemplateMenuOpen] = useState(true);
  const [channelTab, setChannelTabState] = useState<CampaignChannel>(() => {
    try {
      const v = localStorage.getItem(OVERVIEW_TAB_KEY) as CampaignChannel | null;
      return v && CHANNELS.includes(v) ? v : 'whatsapp';
    } catch {
      return 'whatsapp';
    }
  });
  const setChannelTab = (c: CampaignChannel) => {
    setChannelTabState(c);
    try {
      localStorage.setItem(OVERVIEW_TAB_KEY, c);
    } catch {
      /* ignore */
    }
  };
  // Messenger / Instagram overview cards: the connection, and who is inside the 24-hour window now.
  const [metaConns, setMetaConns] = useState<MetaChannelsInfo['connections'] | null>(null);
  const [metaAudience, setMetaAudience] = useState<MetaAudienceCounts | null>(null);
  const [plannerTab, setPlannerTab] = useState<'calendar' | 'list'>('calendar');
  const [timeRange, setTimeRange] = useState('Last 7 days');

  // Template Library local states
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryCategory, setLibraryCategory] = useState<string>('ALL');
  const [libraryStatusFilter, setLibraryStatusFilter] = useState<string>('ALL');
  const [librarySort, setLibrarySort] = useState<'latest' | 'oldest' | 'name'>('latest');
  const [previewTemplate, setPreviewTemplate] = useState<TemplateItem | null>(null);
  
  // Set default start/end dates to last 7 days
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  const notify = useNotify();
  const confirm = useConfirm();
  const [campaignsList, setCampaignsList] = useState<CampaignRecord[]>([]);
  const [overview, setOverview] = useState<CampaignOverviewData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [setDefaultView, setSetDefaultView] = useState(true);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [plannerFilter, setPlannerFilter] = useState('All Campaigns');
  const [channelFilter, setChannelFilter] = useState<'all' | CampaignChannel>('all');
  // Results modal: one campaign with each recipient's delivery state.
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  // The month the calendar shows (first day of it).
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Campaign list + KPI cards, both from the server.
  const load = useCallback(async () => {
    const tz = -new Date().getTimezoneOffset();
    const [list, ov] = await Promise.allSettled([api.getCampaigns(), api.getCampaignOverview(tz)]);
    if (list.status === 'fulfilled') {
      setCampaignsList((list.value.data || []).map(toRecord));
      setLoadError('');
    } else {
      setLoadError(list.reason?.message || 'Could not load campaigns.');
    }
    if (ov.status === 'fulfilled') setOverview(ov.value);
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  // While anything is sending or waiting to send, keep the counts live.
  const live = campaignsList.some((c) => c.status === 'sending' || c.status === 'scheduled');
  const detailId = detail?._id;
  const detailRef = useRef(detailId);
  detailRef.current = detailId;
  useEffect(() => {
    if (!live && !detailId) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      load();
      const id = detailRef.current;
      if (id) {
        api.getCampaign(id).then((r) => {
          if (detailRef.current === id) setDetail(r.data);
        }).catch(() => {});
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [live, detailId, load, api]);

  // Opened from a notification: show that campaign's results.
  useEffect(() => {
    if (focusRequest?.id) {
      setActiveNav('overview');
      openDetail(focusRequest.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.n]);

  async function openDetail(id: string) {
    setDetailBusy(true);
    try {
      const r = await api.getCampaign(id);
      setDetail(r.data);
    } catch (e) {
      notify('error', 'Could not open the campaign', (e as Error).message || 'Please try again.');
    } finally {
      setDetailBusy(false);
    }
  }

  /** Resume a draft (or edit a scheduled campaign) in the editor. */
  async function resumeCampaign(id: string) {
    try {
      const { data: c } = await api.getCampaign(id);
      // Messenger / Instagram: their own editor, with the stored content and audience.
      if (channelOf(c) !== 'whatsapp') {
        onCreateNew(undefined, { id: c._id, channel: channelOf(c), meta: c });
        return;
      }
      // Authentication template: a recipient's one value is their code.
      const auth = isAuthTemplate(templates.find((t) => t.name === c.templateName));
      onCreateNew(c.templateName || undefined, {
        id: c._id,
        campaignName: c.name,
        campaignType: c.type || 'single',
        templateName: c.templateName || '',
        scheduleMode: c.status === 'scheduled' && c.scheduledAt ? 'later' : 'now',
        scheduledAt: toLocalInput(c.scheduledAt),
        recipients: (c.audience || []).map((r) => ({
          phone: r.phone,
          name: r.name || `+${r.phone}`,
          status: 'queued',
          ...(r.bodyParams && r.bodyParams.length ? { bodyParams: r.bodyParams } : {}),
          ...(auth && r.bodyParams?.[0] ? { code: r.bodyParams[0] } : {}),
        })),
        ltoCode: c.ltoCode || '',
        ltoEndsAt: toLocalInput(c.ltoExpiresAt),
        // Drip: its sequence, so the editor shows it picked.
        drip: c.drip || null,
      });
    } catch (e) {
      notify('error', 'Could not open the campaign', (e as Error).message || 'Please try again.');
    }
  }

  async function cancelCampaign(c: { _id: string; name: string }) {
    const ok = await confirm({
      title: 'Cancel campaign?',
      message: `“${c.name}” will stop before its next message. Messages already sent are not recalled.`,
      confirmLabel: 'Cancel campaign',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.cancelCampaign(c._id);
      notify('success', 'Campaign cancelled', `“${c.name}” was cancelled.`);
      await load();
      if (detailRef.current === c._id) {
        const r = await api.getCampaign(c._id);
        setDetail(r.data);
      }
    } catch (e) {
      notify('error', 'Could not cancel', (e as Error).message || 'Please try again.');
    }
  }

  async function deleteCampaign(c: { id: string; name: string }) {
    const ok = await confirm({
      title: 'Delete campaign?',
      message: `“${c.name}” will be removed from your campaigns.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.deleteCampaign(c.id);
      notify('success', 'Campaign deleted', `“${c.name}” was deleted.`);
      if (detailRef.current === c.id) setDetail(null);
      await load();
    } catch (e) {
      notify('error', 'Could not delete', (e as Error).message || 'Please try again.');
    }
  }

  // Interactive time range filter handler
  const handleTimeRangeChange = (range: string) => {
    setTimeRange(range);
    const end = new Date();
    const endStr = end.toISOString().split('T')[0];
    let start = new Date();

    if (range === 'Last 7 days') {
      start.setDate(end.getDate() - 7);
    } else if (range === 'Last 14 days') {
      start.setDate(end.getDate() - 14);
    } else if (range === 'Last 30 days') {
      start.setDate(end.getDate() - 30);
    } else if (range === 'This Month') {
      start = new Date(end.getFullYear(), end.getMonth(), 1);
    } else if (range === 'All Time') {
      start = new Date(2020, 0, 1);
    }

    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(endStr);
  };

  // The planner's status filter ("Sent" = anything that went out).
  const plannerCampaigns = useMemo(() => {
    return campaignsList.filter((c) => {
      if (channelFilter !== 'all' && c.channelKey !== channelFilter) return false;
      if (plannerFilter === 'Scheduled') return c.status === 'scheduled';
      if (plannerFilter === 'Sent') return c.status === 'sending' || c.status === 'completed' || c.status === 'failed';
      if (plannerFilter === 'Draft') return c.status === 'draft';
      return true;
    });
  }, [campaignsList, plannerFilter, channelFilter]);

  // ...and the overview's date range on top (the funnel, the list, the export).
  const filteredCampaigns = useMemo(() => {
    if (timeRange === 'All Time') return plannerCampaigns;
    const startMs = new Date(`${startDate}T00:00:00`).getTime();
    const endMs = new Date(`${endDate}T23:59:59.999`).getTime();
    return plannerCampaigns.filter((c) => {
      if (!c.dateMs) return true;
      return c.dateMs >= startMs && c.dateMs <= endMs;
    });
  }, [plannerCampaigns, startDate, endDate, timeRange]);

  // The "Scheduled Campaigns" page lists everything, including future sends.
  const listCampaigns = activeNav === 'scheduled' ? plannerCampaigns : filteredCampaigns;

  // Funnel cards: the real counts of the campaigns in range, summed. Delivered
  // and read only count what Meta reported.
  // The overview's cards count the selected channel's campaigns only.
  const channelCampaigns = useMemo(
    () => filteredCampaigns.filter((c) => c.channelKey === channelTab),
    [filteredCampaigns, channelTab],
  );
  const stats = useMemo(() => {
    const sum = (k: keyof CampaignStats) => channelCampaigns.reduce((acc, c) => acc + (c.stats[k] || 0), 0);
    const of = (status: CampaignStatus) =>
      channelCampaigns.filter((c) => c.status === status).reduce((acc, c) => acc + (c.stats.pending || 0), 0);
    return {
      sent: sum('accepted'),
      delivered: sum('delivered'),
      read: sum('read'),
      replied: sum('replied'),
      sending: of('sending'),
      failed: sum('failed'),
      processing: sum('sentOnly'),
      queued: of('scheduled'),
      skipped: sum('skipped'),
      campaigns: channelCampaigns.length,
    };
  }, [channelCampaigns]);

  const isMeta = channelTab !== 'whatsapp';
  useEffect(() => {
    if (!isMeta) return undefined;
    let live = true;
    setMetaAudience(null);
    api.getMetaChannels().then((r) => live && setMetaConns(r.connections)).catch(() => live && setMetaConns({ messenger: null, instagram: null }));
    api
      .getCampaignAudience(channelTab as 'messenger' | 'instagram', 0)
      .then((r) => live && setMetaAudience(r))
      .catch(() => live && setMetaAudience(null));
    return () => {
      live = false;
    };
  }, [api, channelTab, isMeta]);
  const metaConn = isMeta && metaConns ? metaConns[channelTab as 'messenger' | 'instagram'] : null;

  // KPI cards.
  const limit = overview?.limit || null;
  const used24h = overview?.usage?.used24h ?? 0;
  const messages24h = overview?.usage?.messages24h ?? 0;
  const limitPct = limit?.unlimited ? 0 : limit?.limit ? Math.min(100, (used24h / limit.limit) * 100) : 0;
  const quality = overview?.quality ? QUALITY[overview.quality] || { label: overview.quality, tone: 'unknown', color: '#9ca3af' } : null;
  const streak = overview?.streak;

  const statuses = useMemo(
    () => [...new Set((templates || []).map((t) => String(t.status || 'PENDING').toUpperCase()))].sort(),
    [templates],
  );

  const statusOptions: KOption[] = useMemo(
    () => [
      { value: 'ALL', label: 'All statuses' },
      ...statuses.map((s) => ({ value: s, label: titleCase(s) })),
    ],
    [statuses],
  );

  const categoryOptions: KOption[] = useMemo(
    () => [
      { value: 'ALL', label: 'All Categories' },
      { value: 'MARKETING', label: 'Marketing' },
      { value: 'UTILITY', label: 'Utility' },
      { value: 'AUTHENTICATION', label: 'Authentication' },
    ],
    [],
  );

  // Dynamically filtered templates for the Template Library view
  const filteredTemplates = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    return (templates || []).filter((t) => {
      // Status filter
      if (libraryStatusFilter && libraryStatusFilter !== 'ALL') {
        if (String(t.status || 'PENDING').toUpperCase() !== libraryStatusFilter.toUpperCase()) {
          return false;
        }
      }
      // Category filter
      if (libraryCategory !== 'ALL' && String(t.category || '').toUpperCase() !== libraryCategory.toUpperCase()) {
        return false;
      }
      // Search query
      if (q) {
        const nameMatch = t.name.toLowerCase().includes(q);
        const catMatch = String(t.category || '').toLowerCase().includes(q);
        const bodyText = t.components?.find((c) => c.type === 'BODY')?.text || t.bodyText || '';
        const bodyMatch = bodyText.toLowerCase().includes(q);
        if (!nameMatch && !catMatch && !bodyMatch) return false;
      }
      return true;
    });
  }, [templates, librarySearch, libraryCategory, libraryStatusFilter]);

  const libraryRows = useMemo(() => {
    return [...filteredTemplates].sort((a, b) => {
      if (librarySort === 'name') return a.name.localeCompare(b.name);
      const tA = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0;
      const tB = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;
      return librarySort === 'oldest' ? tA - tB : tB - tA;
    });
  }, [filteredTemplates, librarySort]);

  // Calendar events: the planner's campaigns, by local day.
  type CalEvent = { id: string; title: string; time: string; type: 'sent' | 'scheduled' | 'draft' | 'failed'; status: CampaignStatus };
  const calendarEvents = useMemo(() => {
    const events: Record<string, CalEvent[]> = {};
    plannerCampaigns.forEach((c) => {
      if (!c.dateMs) return;
      const d = new Date(c.dateMs);
      const key = dayKey(d);
      if (!events[key]) events[key] = [];
      events[key].push({
        id: c.id,
        title: c.name,
        time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        type:
          c.status === 'scheduled' ? 'scheduled'
            : c.status === 'draft' ? 'draft'
              : c.status === 'failed' || c.status === 'cancelled' ? 'failed'
                : 'sent',
        status: c.status,
      });
    });
    return events;
  }, [plannerCampaigns]);

  function openEvent(id: string, status: CampaignStatus) {
    if (status === 'draft') resumeCampaign(id);
    else openDetail(id);
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await load();
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleExportCsv() {
    const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const csvContent =
      'Campaign Name,Template,Date,Channel,Recipients,Sent,Delivered,Read,Replied,Failed,Pending,Status\n' +
      filteredCampaigns
        .map(
          (c) =>
            [
              q(c.name), q(c.template), q(c.date), q(c.channel), c.recipients, c.stats.accepted, c.stats.delivered,
              c.stats.read, c.stats.replied, c.stats.failed, c.stats.pending, q(STATUS_LABEL[c.status] || c.status),
            ].join(','),
        )
        .join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`);
    link.setAttribute('download', `campaign_report_${startDate}_to_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // The shown month, Monday first, padded with the neighbouring months' days.
  const daysInGrid = useMemo(() => {
    const y = calMonth.getFullYear();
    const m = calMonth.getMonth();
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;
    const inMonth = new Date(y, m + 1, 0).getDate();
    const cells = Math.ceil((lead + inMonth) / 7) * 7;
    return Array.from({ length: cells }, (_, i) => {
      const d = new Date(y, m, 1 - lead + i);
      return { day: d.getDate(), isCurrentMonth: d.getMonth() === m, key: dayKey(d), date: d };
    });
  }, [calMonth]);
  const monthTitle = calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const todayKey = dayKey(new Date());

  return (
    <div className="co-shell">
      {/* ================= LEFT SUB-SIDEBAR ================= */}
      <aside className="co-sidebar">
        <div className="co-sidebar-head">
          <h3>Campaigns</h3>
        </div>

        <button className="co-create-btn" onClick={() => onCreateNew()}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span>Create New Campaign</span>
        </button>

        <nav className="co-nav">
          <button
            className={`co-nav-item${activeNav === 'overview' ? ' active' : ''}`}
            onClick={() => setActiveNav('overview')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 21 21" fill="none" className="co-nav-icon">
              <path
                d="M8.5 2.5C8.91421 2.5 9.25 2.83579 9.25 3.25V11.25H17.25C17.6297 11.25 17.9435 11.5322 17.9932 11.8982L18 12C18 16.9706 13.9706 20.5 9 20.5C4.02944 20.5 0 16.4706 0 11.5C0 6.52944 3.52944 2.5 8.5 2.5ZM7.75 4.037L7.54109 4.06073C3.8518 4.53155 1.5 7.68274 1.5 11.5C1.5 15.6421 4.85786 19 9 19C12.8173 19 15.9685 16.6482 16.4393 12.9589L16.462 12.75H8.5C8.1203 12.75 7.80651 12.4678 7.75685 12.1018L7.75 12V4.037ZM11.5 0C16.4706 0 20.5 4.02944 20.5 9C20.5 9.41421 20.1642 9.75 19.75 9.75H11.5C11.0858 9.75 10.75 9.41421 10.75 9V0.75C10.75 0.335786 11.0858 0 11.5 0ZM12.25 1.537V8.25H18.962L18.9393 8.04109C18.5085 4.66578 15.8342 1.99148 12.4589 1.56073L12.25 1.537Z"
                fill="currentColor"
              />
            </svg>
            <span>Campaign Overview</span>
          </button>

          <div className="co-nav-group">
            <button
              className="co-nav-item co-nav-parent"
              onClick={() => setTemplateMenuOpen((prev) => !prev)}
            >
              <div className="co-nav-item-left">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="co-nav-icon">
                  <path d="M3.5 4.5H16.5C17.0523 4.5 17.5 4.94772 17.5 5.5V14.5C17.5 15.0523 17.0523 15.5 16.5 15.5H3.5C2.94772 15.5 2.5 15.0523 2.5 14.5V5.5C2.5 4.94772 2.94772 4.5 3.5 4.5Z" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M6 8.5H14M6 11.5H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span>Template Messages</span>
              </div>
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className={`co-chevron${templateMenuOpen ? ' open' : ''}`}
              >
                <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {templateMenuOpen && (
              <div className="co-nav-sub">
                <button
                  className={`co-nav-sub-item${activeNav === 'library' ? ' active' : ''}`}
                  onClick={() => setActiveNav('library')}
                  title="Ready-made templates from Meta’s WhatsApp template library"
                  data-testid="co-nav-template-library"
                  aria-current={activeNav === 'library' ? 'page' : undefined}
                >
                  Template Library
                </button>
                <button
                  className={`co-nav-sub-item${activeNav === 'wa' ? ' active' : ''}`}
                  onClick={() => setActiveNav('wa')}
                  title="WhatsApp templates"
                  data-testid="co-nav-templates-whatsapp"
                  aria-current={activeNav === 'wa' ? 'page' : undefined}
                >
                  WhatsApp
                </button>
              </div>
            )}
          </div>

          <button
            className={`co-nav-item${activeNav === 'scheduled' ? ' active' : ''}`}
            onClick={() => {
              setActiveNav('scheduled');
              setPlannerTab('calendar');
            }}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="co-nav-icon">
              <rect x="3" y="4.5" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6.5 2.5V6.5M13.5 2.5V6.5M3 8H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>Scheduled Campaigns</span>
          </button>

        </nav>
      </aside>

      {/* ================= MAIN DASHBOARD BODY ================= */}
      <main className="co-main">
        {/* Top Header */}
        <header className="co-head">
          <div className="co-head-info">
            <h2>
              {activeNav === 'scheduled'
                ? 'Scheduled Campaigns'
                : activeNav === 'library'
                ? 'Template Library'
                : activeNav === 'wa'
                ? 'WhatsApp Templates'
                : activeNav === 'messenger'
                ? 'Messenger Templates'
                : activeNav === 'instagram'
                ? 'Instagram Templates'
                : 'Campaigns Overview'}
            </h2>
            <p>
              {activeNav === 'scheduled'
                ? 'Plan and schedule WhatsApp campaign broadcasts'
                : activeNav === 'library'
                ? 'Ready-made templates from Meta’s WhatsApp template library'
                : activeNav === 'wa'
                ? 'Choose an approved template to start a campaign with dynamic Excel / CSV columns'
                : activeNav === 'messenger'
                ? 'Utility templates and quick messages to start a Messenger campaign with'
                : activeNav === 'instagram'
                ? 'Quick messages to start an Instagram campaign with (sent inside the 24-hour window)'
                : 'Get an overview of all your campaign related analytics and insights'}
            </p>
          </div>

          <div className="co-head-actions">
            {tplNav ? (
              <>
                <button
                  className="co-btn-outline"
                  onClick={() => {
                    if (tplNav !== 'wa') onNavigate?.(`templates:${tplNav}`);
                    else if (onCreateTemplate) onCreateTemplate();
                    else onNavigate?.('templates');
                  }}
                  title={tplNav === 'wa' ? 'Create a new template' : `Create a ${CHANNEL_NAME[tplNav]} template on the Templates page`}
                  data-testid="co-tpl-create"
                >
                  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span>Create Template</span>
                </button>
                <button
                  className="co-btn-primary"
                  onClick={() => (tplNav === 'wa' ? onCreateNew(undefined, { channel: 'whatsapp', fresh: true }) : newMetaCampaign(tplNav))}
                  data-testid="co-tpl-new-campaign"
                >
                  New Campaign
                </button>
              </>
            ) : activeNav === 'library' ? (
              <>
                <button
                  className="co-btn-outline"
                  onClick={() => onNavigate?.('templates:library')}
                  title="Open the Template Library on the Templates page"
                  data-testid="co-lib-open-templates"
                >
                  <span>Open in Templates</span>
                </button>
                <button className="co-btn-primary" onClick={() => onCreateNew()}>
                  New Campaign
                </button>
              </>
            ) : (
              <>
                <button
                  className="co-btn-tutorial"
                  onClick={() => setShowTutorial(true)}
                  title="Watch tutorial (Coming Soon)"
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="10" cy="10" r="8" fill="#3B82F6" />
                    <path d="M8.5 7L13 10L8.5 13V7Z" fill="white" />
                  </svg>
                  <span>Watch Tutorial</span>
                  <span className="co-soon-badge">Soon</span>
                </button>

                <button className="co-btn-primary" onClick={() => onCreateNew()}>
                  New Campaign
                </button>
              </>
            )}
          </div>
        </header>

        {activeNav === 'overview' && (
          <>
            {/* Channel segment tabs (only when there is more than one channel) */}
            {CHANNELS.length > 1 && (
            <div className="co-segment-wrap">
              <div className="co-segment" role="tablist" aria-label="Channel">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch}
                    role="tab"
                    aria-selected={channelTab === ch}
                    className={`co-seg-tab${channelTab === ch ? ' active' : ''}`}
                    onClick={() => setChannelTab(ch)}
                    data-testid={`co-seg-${ch}`}
                  >
                    <img src={CHANNEL_ICON[ch]} alt="" width={15} height={15} style={{ marginRight: 6, verticalAlign: '-2px' }} />
                    {CHANNEL_NAME[ch]}
                  </button>
                ))}
              </div>
            </div>
            )}

            {/* Overview Filter Bar */}
            <div className="co-filter-row">
              <div className="co-filter-left">
                <h3 className="co-filter-title">Overview</h3>

                <div className="co-time-range-wrap">
                  <Dropdown
                    options={TIME_RANGE_OPTIONS}
                    value={timeRange}
                    onChange={handleTimeRangeChange}
                    size="sm"
                    className="co-time-dropdown"
                  />
                </div>

                <CustomDateTimePicker
                  value={startDate}
                  onChange={(val) => {
                    setStartDate(val);
                    setTimeRange('Custom');
                  }}
                  showTime={false}
                  hidePastDates={false}
                  dateDisplayFormat="long"
                  variant="pill"
                  pillTitle="Click to choose start date"
                  align="left"
                />

                <CustomDateTimePicker
                  value={endDate}
                  onChange={(val) => {
                    setEndDate(val);
                    setTimeRange('Custom');
                  }}
                  showTime={false}
                  hidePastDates={false}
                  dateDisplayFormat="long"
                  variant="pill"
                  pillTitle="Click to choose end date"
                  align="left"
                />

                <button className="co-btn-outline" onClick={handleExportCsv} title="Export CSV report">
                  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 3V12M10 3L6.5 6.5M10 3L13.5 6.5" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 11V15C4 15.5523 4.44772 16 5 16H15C15.5523 16 16 15.5523 16 15V11" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span>Export</span>
                </button>

                <button
                  className={`co-btn-icon-outline${isRefreshing ? ' refreshing' : ''}`}
                  onClick={handleRefresh}
                  title="Refresh statistics"
                  aria-label="Refresh statistics"
                >
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={isRefreshing ? 'co-spinning' : ''}>
                    <path d="M16.5 10C16.5 13.5899 13.5899 16.5 10 16.5C6.41015 16.5 3.5 13.5899 3.5 10C3.5 6.41015 6.41015 3.5 10 3.5C12.1645 3.5 14.0742 4.55799 15.2472 6.18206M16.5 3.5V6.5H13.5" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messenger / Instagram: their own KPI cards */}
            {isMeta && (
              <section className="co-kpi-row" data-testid={`co-kpi-${channelTab}`}>
                <div className="co-kpi-card">
                  <div className="co-kpi-head">
                    <div className="co-kpi-title-wrap">
                      <img src={CHANNEL_ICON[channelTab]} alt="" width={20} height={20} />
                      <span className="co-kpi-title">Connected {channelTab === 'instagram' ? 'account' : 'Page'}</span>
                    </div>
                  </div>
                  <div className="co-kpi-body">
                    {!metaConns ? (
                      <span className="co-kpi-stat">Loading…</span>
                    ) : metaConn?.status === 'connected' ? (
                      <div className="co-kpi-bottom-row">
                        <span className="co-kpi-stat" data-testid="co-meta-conn">
                          {channelTab === 'instagram' ? `@${metaConn.igUsername || metaConn.igUserId}` : metaConn.pageName || metaConn.pageId}
                        </span>
                        <span className="co-quality-badge high">Connected</span>
                      </div>
                    ) : (
                      <div className="co-kpi-bottom-row">
                        <span className="co-kpi-stat">{metaConn ? 'Disconnected at Meta' : 'Not connected'}</span>
                        <button
                          type="button"
                          className="co-kpi-link"
                          style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
                          onClick={() => onNavigate?.(`channel-status:${channelTab}`)}
                          data-testid="co-meta-connect"
                        >
                          {metaConn ? 'Reconnect' : `Connect ${CHANNEL_NAME[channelTab]}`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="co-kpi-card">
                  <div className="co-kpi-head">
                    <div className="co-kpi-title-wrap">
                      <span className="material-icons" style={{ fontSize: 20, color: '#24d06e' }} aria-hidden="true">schedule</span>
                      <span className="co-kpi-title">Inside the 24-hour window now</span>
                      <span
                        className="co-info-icon"
                        title={`${CHANNEL_NAME[channelTab]} only allows campaign messages to people who wrote in the last 24 hours${channelTab === 'messenger' ? ' (approved utility templates can reach everyone)' : ''}.`}
                      >
                        ⓘ
                      </span>
                    </div>
                  </div>
                  <div className="co-kpi-body">
                    <div className="co-kpi-bar">
                      <div
                        className="co-kpi-bar-fill"
                        style={{ width: `${metaAudience?.total ? Math.min(100, (metaAudience.inWindow / metaAudience.total) * 100) : 0}%` }}
                      />
                    </div>
                    <div className="co-kpi-bottom-row">
                      <span className="co-kpi-stat" data-testid="co-meta-window">
                        {!metaAudience
                          ? 'Loading…'
                          : `${metaAudience.inWindow.toLocaleString('en-US')} of ${metaAudience.total.toLocaleString('en-US')} contacts`}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="co-kpi-card">
                  <div className="co-kpi-head">
                    <div className="co-kpi-title-wrap">
                      <span className="material-icons" style={{ fontSize: 20, color: '#6CACEC' }} aria-hidden="true">campaign</span>
                      <span className="co-kpi-title">Campaigns in this range</span>
                    </div>
                  </div>
                  <div className="co-kpi-body">
                    <div className="co-kpi-bottom-row">
                      <span className="co-kpi-stat" data-testid="co-meta-campaigns">
                        {stats.campaigns} campaign{stats.campaigns === 1 ? '' : 's'} · {stats.skipped} skipped (outside 24 h)
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* 3 KPI Cards Top Row (Exact to reference image) */}
            {!isMeta && (
            <section className="co-kpi-row">
              {/* Card 1: Your daily Meta messaging limit */}
              <div className="co-kpi-card">
                <div className="co-kpi-head">
                  <div className="co-kpi-title-wrap">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3.25 14.75A7.75 7.75 0 1 1 16.75 14.75" stroke="#24d06e" strokeWidth="1.6" strokeLinecap="round" />
                      <path d="M5.1 11.2L4.1 10.8M7 7.1L6.4 6.2M10 5.5V4.5M13 7.1L13.6 6.2M14.9 11.2L15.9 10.8" stroke="#24d06e" strokeWidth="1.3" strokeLinecap="round" />
                      <path d="M10 12.5L13.1 8.2" stroke="#24d06e" strokeWidth="1.7" strokeLinecap="round" />
                      <circle cx="10" cy="12.5" r="1.4" fill="#24d06e" />
                      <path d="M5.5 16.5H14.5" stroke="#24d06e" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                    <span className="co-kpi-title">Your daily Meta messaging limit</span>
                    <span
                      className="co-info-icon"
                      title={
                        'How many unique customers your number can send template messages to in a rolling 24 hours (Meta\'s tier for your number). '
                        + `In the last 24 hours you sent ${messages24h.toLocaleString('en-US')} template message${messages24h === 1 ? '' : 's'} to ${used24h.toLocaleString('en-US')} unique contact${used24h === 1 ? '' : 's'}.`
                      }
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="8" cy="8" r="6.25" stroke="#9ca3af" strokeWidth="1.25" />
                        <path d="M6.5 6.25C6.5 5.42157 7.17157 4.75 8 4.75C8.82843 4.75 9.5 5.42157 9.5 6.25C9.5 6.84587 9.15175 7.36014 8.64731 7.59918C8.2435 7.79054 8 8.1969 8 8.64453V9" stroke="#9ca3af" strokeWidth="1.25" strokeLinecap="round" />
                        <circle cx="8" cy="11.25" r="0.75" fill="#9ca3af" />
                      </svg>
                    </span>
                  </div>
                </div>
                <div className="co-kpi-body">
                  <div className="co-kpi-bar">
                    <div className="co-kpi-bar-fill" style={{ width: `${limitPct}%` }} />
                  </div>
                  <div className="co-kpi-bottom-row">
                    <span
                      className="co-kpi-stat"
                      data-testid="co-limit-stat"
                      title={overview?.metaError ? `Meta: ${overview.metaError}` : undefined}
                    >
                      {!overview
                        ? 'Loading…'
                        : !overview.connected
                          ? 'Connect your WhatsApp number to see your limit'
                          : limit?.unlimited
                            ? `${used24h.toLocaleString('en-US')} unique contacts · Unlimited`
                            : limit?.limit
                              ? `${used24h.toLocaleString('en-US')}/${limit.label} unique contacts`
                              : `${used24h.toLocaleString('en-US')} unique contacts · limit ${limit?.label || 'unavailable'}`}
                    </span>
                    <a
                      href="https://developers.facebook.com/docs/whatsapp/messaging-limits"
                      target="_blank"
                      rel="noreferrer"
                      className="co-kpi-link"
                    >
                      What are limits?
                    </a>
                  </div>
                </div>
              </div>

              {/* Card 2: Consecutive days of messaging */}
              <div className="co-kpi-card">
                <div className="co-kpi-head">
                  <div className="co-kpi-title-wrap">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10.8 2.2C11.3 5.1 8.1 6.1 8.4 8.6C7.4 7.9 6.9 6.8 7.1 5.6C4.8 7.4 3.5 9.4 3.5 12C3.5 15.2 6.2 17.5 9.7 17.5C13.4 17.5 16.5 15.1 16.5 11.7C16.5 8.2 13.8 5 10.8 2.2Z" stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M10.1 10.2C10.3 11.6 8.7 12.3 8.8 13.7C8.9 14.8 9.7 15.5 10.8 15.5C12 15.5 12.8 14.6 12.8 13.5C12.8 12.3 11.8 11.1 10.1 10.2Z" stroke="#f97316" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="co-kpi-title">Consecutive days of messaging</span>
                    <span
                      className="co-info-icon"
                      title="Your activity streak: days in a row, up to today, on which your number sent at least one message that didn't fail. The dots are the last 7 days, today on the right."
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="8" cy="8" r="6.25" stroke="#9ca3af" strokeWidth="1.25" />
                        <path d="M6.5 6.25C6.5 5.42157 7.17157 4.75 8 4.75C8.82843 4.75 9.5 5.42157 9.5 6.25C9.5 6.84587 9.15175 7.36014 8.64731 7.59918C8.2435 7.79054 8 8.1969 8 8.64453V9" stroke="#9ca3af" strokeWidth="1.25" strokeLinecap="round" />
                        <circle cx="8" cy="11.25" r="0.75" fill="#9ca3af" />
                      </svg>
                    </span>
                  </div>
                </div>
                <div className="co-kpi-body">
                  <div className="co-streak-dots" data-testid="co-streak-dots">
                    {(streak?.days || []).map((d, i, all) => {
                      const label = new Date(`${d.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                      const isToday = i === all.length - 1;
                      return (
                        <span
                          key={d.date}
                          className={`co-dot ${d.active ? 'filled' : 'dotted'}${isToday ? ' today' : ''}`}
                          title={`${isToday ? 'Today' : label}: ${d.active ? 'messages sent' : 'no messages sent'}`}
                        />
                      );
                    })}
                    <span className="co-streak-label" data-testid="co-streak-label">
                      {!streak ? '' : `${streak.current} day${streak.current === 1 ? '' : 's'} in a row`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 3: Messaging Quality */}
              <div className="co-kpi-card">
                <div className="co-kpi-head">
                  <div className="co-kpi-title-wrap">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 21 20" fill="none">
                      <path d="M17.3333 10.8335C17.3333 15.0002 14.4167 17.0835 10.95 18.2919C10.7685 18.3534 10.5713 18.3505 10.3917 18.2835C6.91667 17.0835 4 15.0002 4 10.8335V5.00021C4 4.7792 4.0878 4.56724 4.24408 4.41096C4.40036 4.25468 4.61232 4.16688 4.83333 4.16688C6.5 4.16688 8.58333 3.16688 10.0333 1.90021C10.2099 1.74938 10.4345 1.6665 10.6667 1.6665C10.8989 1.6665 11.1235 1.74938 11.3 1.90021C12.7583 3.17521 14.8333 4.16688 16.5 4.16688C16.721 4.16688 16.933 4.25468 17.0893 4.41096C17.2455 4.56724 17.3333 4.7792 17.3333 5.00021V10.8335Z" stroke="#6CACEC" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M8.16663 10.0002L9.83329 11.6668L13.1666 8.3335" stroke="#6CACEC" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="co-kpi-title">Messaging Quality</span>
                    <span className="co-info-icon" title="Meta phone number quality rating based on user feedback">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="8" cy="8" r="6.25" stroke="#9ca3af" strokeWidth="1.25" />
                        <path d="M6.5 6.25C6.5 5.42157 7.17157 4.75 8 4.75C8.82843 4.75 9.5 5.42157 9.5 6.25C9.5 6.84587 9.15175 7.36014 8.64731 7.59918C8.2435 7.79054 8 8.1969 8 8.64453V9" stroke="#9ca3af" strokeWidth="1.25" strokeLinecap="round" />
                        <circle cx="8" cy="11.25" r="0.75" fill="#9ca3af" />
                      </svg>
                    </span>
                  </div>
                </div>
                <div className="co-kpi-body">
                  <div className="co-quality-stat">
                    <svg width="18" height="15" viewBox="0 0 18 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="1" y="9" width="3.5" height="6" rx="1" fill={quality?.color || '#d1d5db'} />
                      <rect x="7" y="5" width="3.5" height="10" rx="1" fill={quality && quality.tone !== 'low' ? quality.color : '#d1d5db'} />
                      <rect x="13" y="1" width="3.5" height="14" rx="1" fill={quality?.tone === 'high' ? quality.color : '#d1d5db'} />
                    </svg>
                    <span
                      className={`co-quality-badge ${quality?.tone || 'unknown'}`}
                      data-testid="co-quality"
                      title={overview?.metaError ? `Meta: ${overview.metaError}` : undefined}
                    >
                      {!overview
                        ? 'Loading…'
                        : !overview.connected
                          ? 'Not connected'
                          : quality?.label || 'Unavailable'}
                    </span>
                  </div>
                </div>
              </div>
            </section>
            )}

            {/* Funnel Metrics 8-Card Grid (4 Columns) */}
            <section className="co-funnel-grid">
              {/* 1. Sent */}
              <div className="co-metric-card">
                <div className="co-metric-left">
                  <div className="co-metric-val">{stats.sent}</div>
                  <div className="co-metric-lbl">
                    <span>Sent</span>
                    <span className="co-info-icon" title="Campaign messages Meta accepted for delivery">ⓘ</span>
                  </div>
                </div>
                <div className="co-metric-badge green">
                  <svg width="18" height="14" viewBox="0 0 18 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1.66797 7L7.16797 12.5L16.3346 1.5" stroke="#23A455" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              {/* 2. Delivered */}
              <div className="co-metric-card">
                <div className="co-metric-left">
                  <div className="co-metric-val">{stats.delivered}</div>
                  <div className="co-metric-lbl">
                    <span>Delivered</span>
                    <span className="co-info-icon" title={`Delivered, as reported by ${CHANNEL_NAME[channelTab]} (includes read)`}>ⓘ</span>
                  </div>
                </div>
                <div className="co-metric-badge green">
                  <svg width="22" height="12" viewBox="0 0 22 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1.83203 6L6.64453 10.5833L9.05078 7.83333" stroke="#23A455" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M7.33203 5.99984L12.1445 10.5832L20.1654 1.4165" stroke="#23A455" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14.6654 1.4165L11.457 5.08317" stroke="#23A455" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              {/* 3. Read */}
              <div className="co-metric-card">
                <div className="co-metric-left">
                  <div className="co-metric-val">{stats.read}</div>
                  <div className="co-metric-lbl">
                    <span>Read</span>
                    <span className="co-info-icon" title="Messages opened and read">ⓘ</span>
                  </div>
                </div>
                <div className="co-metric-badge green">
                  <svg width="22" height="16" viewBox="0 0 22 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20.2565 6.962C20.7305 7.582 20.7305 8.419 20.2565 9.038C18.7635 10.987 15.1815 15 10.9995 15C6.81752 15 3.23552 10.987 1.74252 9.038C1.51191 8.74113 1.38672 8.37592 1.38672 8C1.38672 7.62408 1.51191 7.25887 1.74252 6.962C3.23552 5.013 6.81752 1 10.9995 1C15.1815 1 18.7635 5.013 20.2565 6.962V6.962Z" stroke="#23A455" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M11 11C12.6569 11 14 9.65685 14 8C14 6.34315 12.6569 5 11 5C9.34315 5 8 6.34315 8 8C8 9.65685 9.34315 11 11 11Z" stroke="#23A455" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              {/* 4. Replied */}
              <div className="co-metric-card">
                <div className="co-metric-left">
                  <div className="co-metric-val">{stats.replied}</div>
                  <div className="co-metric-lbl">
                    <span>Replied</span>
                    <span className="co-info-icon" title="Recipients who wrote back after the campaign message">ⓘ</span>
                  </div>
                </div>
                <div className="co-metric-badge green">
                  <svg width="22" height="16" viewBox="0 0 22 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8.60219 0.736277C8.76965 0.805709 8.91277 0.923237 9.01344 1.074C9.11411 1.22476 9.16782 1.40199 9.16777 1.58328V3.03711L11.2697 0.935194C11.3979 0.807035 11.5612 0.719762 11.739 0.684408C11.9168 0.649055 12.1011 0.667208 12.2685 0.736572C12.436 0.805936 12.5792 0.923397 12.6799 1.07411C12.7806 1.22482 12.8344 1.40201 12.8344 1.58328V4.35986C14.5385 4.45978 15.9245 4.84203 17.0447 5.44519C18.2398 6.0821 19.2221 7.0554 19.8699 8.24469C21.0524 10.3851 21.0844 12.9023 21.0844 14.4166C21.0844 14.6597 20.9879 14.8929 20.816 15.0648C20.644 15.2367 20.4109 15.3333 20.1678 15.3333C19.9247 15.3333 19.6915 15.2367 19.5196 15.0648C19.3477 14.8929 19.2511 14.6597 19.2511 14.4166C19.2511 13.8474 19.0513 13.4257 18.7039 13.0783C18.3335 12.7089 17.7679 12.399 17.0245 12.1616C15.7925 11.7693 14.2562 11.6354 12.8344 11.6437V14.4166C12.8344 14.5979 12.7806 14.7751 12.6799 14.9258C12.5792 15.0765 12.436 15.1939 12.2685 15.2633C12.1011 15.3327 11.9168 15.3508 11.739 15.3155C11.5612 15.2801 11.3979 15.1929 11.2697 15.0647L1.18636 8.64803C1.01451 8.47613 0.917969 8.24301 0.917969 7.99994C0.917969 7.75688 1.01451 7.52376 1.18636 7.35186L7.60302 0.935194C7.73121 0.806922 7.89457 0.719555 8.07243 0.684147C8.25028 0.648739 8.43465 0.666881 8.60219 0.736277ZM7.33444 11.1294L4.85302 8.64803C4.68117 8.47613 4.58464 8.24301 4.58464 7.99994C4.58464 7.75688 4.68117 7.52376 4.85302 7.35186L7.33444 4.87044V3.79611L3.13061 7.99994L7.33444 12.2038V11.1294ZM18.955 11.0011C18.8138 10.3485 18.5814 9.719 18.2648 9.13111C17.7871 8.24994 17.0601 7.5293 16.1748 7.05944C15.1866 6.52686 13.8199 6.16661 11.9178 6.16661C11.6747 6.16661 11.4415 6.07003 11.2696 5.89812C11.0977 5.72622 11.0011 5.49306 11.0011 5.24994V3.79611L6.79727 7.99994L11.0011 12.2038V10.7499C11.0011 10.514 11.0921 10.2871 11.2552 10.1165C11.4182 9.94593 11.6408 9.84481 11.8765 9.83419C13.5989 9.75628 15.787 9.84336 17.5819 10.4154C18.0584 10.5635 18.5185 10.7601 18.955 11.002V11.0011Z" fill="#23A455" />
                  </svg>
                </div>
              </div>

              {/* 5. Sending */}
              <div className="co-metric-card">
                <div className="co-metric-left">
                  <div className="co-metric-val">{stats.sending}</div>
                  <div className="co-metric-lbl">
                    <span>Sending</span>
                    <span className="co-info-icon" title="Messages of campaigns being sent right now that haven't gone out yet">ⓘ</span>
                  </div>
                </div>
                <div className="co-metric-badge green">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.6469 7.54313L4.8136 1.12646C4.30714 0.874384 3.73525 0.784643 3.17592 0.869473C2.61658 0.954302 2.09702 1.20957 1.68807 1.60048C1.27912 1.99139 1.00068 2.49891 0.890721 3.05385C0.780757 3.60879 0.84462 4.18414 1.0736 4.70146L3.2736 9.62396C3.32352 9.74297 3.34923 9.87074 3.34923 9.99979C3.34923 10.1288 3.32352 10.2566 3.2736 10.3756L1.0736 15.2981C0.887244 15.7168 0.808462 16.1754 0.844415 16.6322C0.880368 17.0891 1.02992 17.5297 1.27947 17.914C1.52902 18.2984 1.87067 18.6143 2.27336 18.833C2.67605 19.0517 3.12701 19.1663 3.58527 19.1665C4.01448 19.1622 4.4373 19.062 4.82277 18.8731L17.6561 12.4565C18.1113 12.2275 18.494 11.8765 18.7613 11.4427C19.0287 11.0089 19.1703 10.5094 19.1703 9.99979C19.1703 9.49022 19.0287 8.99068 18.7613 8.55689C18.494 8.1231 18.1113 7.77212 17.6561 7.54313H17.6469ZM16.8311 10.8156L3.99777 17.2323C3.82925 17.3132 3.64002 17.3407 3.45546 17.311C3.27089 17.2813 3.09981 17.1959 2.96516 17.0662C2.8305 16.9366 2.73871 16.7688 2.70209 16.5855C2.66547 16.4022 2.68577 16.2121 2.76027 16.0406L4.9511 11.1181C4.97946 11.0524 5.00395 10.9851 5.02444 10.9165H11.3403C11.5834 10.9165 11.8165 10.8199 11.9884 10.648C12.1604 10.4761 12.2569 10.2429 12.2569 9.99979C12.2569 9.75668 12.1604 9.52352 11.9884 9.35161C11.8165 9.1797 11.5834 9.08313 11.3403 9.08313H5.02444C5.00395 9.01453 4.97946 8.94719 4.9511 8.88146L2.76027 3.95896C2.68577 3.78751 2.66547 3.59738 2.70209 3.41406C2.73871 3.23075 2.8305 3.06301 2.96516 2.93334C3.09981 2.80368 3.27089 2.71828 3.45546 2.6886C3.64002 2.65892 3.82925 2.68638 3.99777 2.76729L16.8311 9.18396C16.9813 9.26088 17.1073 9.37776 17.1953 9.5217C17.2832 9.66565 17.3298 9.83108 17.3298 9.99979C17.3298 10.1685 17.2832 10.3339 17.1953 10.4779C17.1073 10.6218 16.9813 10.7387 16.8311 10.8156Z" fill="#23A455" />
                  </svg>
                </div>
              </div>

              {/* 6. Failed */}
              <div className="co-metric-card">
                <div className="co-metric-left">
                  <div className="co-metric-val">{stats.failed}</div>
                  <div className="co-metric-lbl">
                    <span>Failed</span>
                    <span className="co-info-icon" title="Messages Meta refused or couldn't deliver (open a campaign to see why)">ⓘ</span>
                  </div>
                </div>
                <div className="co-metric-badge green">
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4.51796 4.51898C6.02201 3.00511 8.00712 2.06343 10.1311 1.85629C12.255 1.64915 14.3846 2.18953 16.1529 3.38427C17.9211 4.57901 19.217 6.35324 19.8173 8.40108C20.4176 10.4489 20.2846 12.642 19.4413 14.6023C19.3534 14.7845 19.3246 14.9896 19.3588 15.189L20.1655 19.0665C20.1965 19.2151 20.1902 19.3692 20.147 19.5148C20.1038 19.6604 20.0251 19.793 19.918 19.9007C19.8301 19.9878 19.7256 20.0563 19.6106 20.102C19.4956 20.1477 19.3725 20.1696 19.2488 20.1665H19.0655L15.1421 19.3781C14.9427 19.3542 14.7405 19.3826 14.5555 19.4606C12.5952 20.304 10.4021 20.437 8.35422 19.8367C6.30638 19.2364 4.53216 17.9404 3.33741 16.1722C2.14267 14.404 1.60229 12.2743 1.80943 10.1504C2.01657 8.02648 2.95825 6.04137 4.47213 4.53732L4.51796 4.51898ZM3.75713 12.1823C3.93635 13.2768 4.36149 14.3164 5.00054 15.2228C5.63959 16.1292 6.47592 16.8789 7.44657 17.4154C8.41723 17.9519 9.49693 18.2613 10.6044 18.3202C11.7119 18.3792 12.8184 18.1861 13.8405 17.7557C14.203 17.6015 14.5924 17.5205 14.9863 17.5173C15.1584 17.5185 15.3301 17.5339 15.4996 17.5632L18.0846 18.0856L17.5621 15.5007C17.4581 14.9408 17.5251 14.3626 17.7546 13.8415C18.1851 12.8194 18.3781 11.7129 18.3192 10.6054C18.2603 9.49795 17.9509 8.41825 17.4144 7.4476C16.8779 6.47694 16.1282 5.64062 15.2218 5.00156C14.3154 4.36251 13.2758 3.93737 12.1813 3.75815C11.0325 3.56961 9.85524 3.65729 8.74702 4.01396C7.6388 4.37062 6.63142 4.98601 5.8082 5.80923C4.98499 6.63244 4.3696 7.63982 4.01293 8.74805C3.65627 9.85627 3.56858 11.0335 3.75713 12.1823Z" fill="#23A455" />
                    <path d="M10.504 11.2619L8.93246 12.8335L9.16797 13.069L10.7396 11.4974L11.2699 10.9671L11.8002 11.4974L13.3718 13.069L13.6073 12.8335L12.0357 11.2619L11.5054 10.7316L12.0357 10.2012L13.6073 8.62966L13.3718 8.39416L11.8002 9.96574L11.2699 10.4961L10.7396 9.96574L9.16797 8.39416L8.93246 8.62966L10.504 10.2012L11.0344 10.7316L10.504 11.2619Z" stroke="#23A455" strokeWidth="1.5" />
                  </svg>
                </div>
              </div>

              {/* 7. Processing */}
              <div className="co-metric-card">
                <div className="co-metric-left">
                  <div className="co-metric-val" data-testid="co-metric-processing">{isMeta ? stats.skipped : stats.processing}</div>
                  <div className="co-metric-lbl">
                    <span>{isMeta ? 'Skipped' : 'Processing'}</span>
                    <span
                      className="co-info-icon"
                      title={isMeta ? 'Not sent: outside the 24-hour window when their turn came' : 'Accepted by Meta, no delivery receipt yet'}
                    >
                      ⓘ
                    </span>
                  </div>
                </div>
                <div className="co-metric-badge green">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M7.1888 7.08317H3.4388C3.21779 7.08317 3.00583 6.99537 2.84955 6.83909C2.69327 6.68281 2.60547 6.47085 2.60547 6.24984V2.49984C2.60547 2.27882 2.69327 2.06686 2.84955 1.91058C3.00583 1.7543 3.21779 1.6665 3.4388 1.6665C3.65982 1.6665 3.87178 1.7543 4.02806 1.91058C4.18434 2.06686 4.27214 2.27882 4.27214 2.49984V5.4165H7.1888C7.40982 5.4165 7.62178 5.5043 7.77806 5.66058C7.93434 5.81686 8.02213 6.02882 8.02213 6.24984C8.02213 6.47085 7.93434 6.68281 7.77806 6.83909C7.62178 6.99537 7.40982 7.08317 7.1888 7.08317Z" fill="#23A455" />
                    <path d="M17.501 10.8335C17.28 10.8335 17.068 10.7457 16.9117 10.5894C16.7554 10.4331 16.6676 10.2212 16.6676 10.0002C16.6683 8.53311 16.1847 7.10687 15.2919 5.94275C14.3991 4.77864 13.147 3.94174 11.73 3.56194C10.313 3.18213 8.8102 3.28065 7.45488 3.8422C6.09956 4.40376 4.96748 5.39696 4.23431 6.66767C4.12358 6.85895 3.9414 6.99842 3.72784 7.05538C3.51429 7.11235 3.28685 7.08214 3.09556 6.97142C2.90427 6.86069 2.76481 6.67851 2.70784 6.46495C2.65088 6.25139 2.68108 6.02395 2.79181 5.83267C3.70869 4.24453 5.12405 3.00337 6.81832 2.30174C8.51259 1.60011 10.3911 1.47722 12.1623 1.95216C13.9335 2.42709 15.4985 3.47328 16.6145 4.92844C17.7304 6.38359 18.335 8.16636 18.3343 10.0002C18.3343 10.2212 18.2465 10.4331 18.0902 10.5894C17.934 10.7457 17.722 10.8335 17.501 10.8335ZM16.5635 18.3335C16.3425 18.3335 16.1305 18.2457 15.9742 18.0894C15.8179 17.9331 15.7301 17.7212 15.7301 17.5002V14.5835H12.8135C12.5925 14.5835 12.3805 14.4957 12.2242 14.3394C12.0679 14.1831 11.9801 13.9712 11.9801 13.7502C11.9801 13.5292 12.0679 13.3172 12.2242 13.1609C12.3805 13.0046 12.5925 12.9168 12.8135 12.9168H16.5635C16.7845 12.9168 16.9965 13.0046 17.1527 13.1609C17.309 13.3172 17.3968 13.5292 17.3968 13.7502V17.5002C17.3968 17.7212 17.309 17.9331 17.1527 18.0894C16.9965 18.2457 16.7845 18.3335 16.5635 18.3335Z" fill="#23A455" />
                    <path d="M10.0013 18.3332C7.79198 18.3305 5.6739 17.4517 4.11167 15.8895C2.54944 14.3272 1.67062 12.2092 1.66797 9.99984C1.66797 9.77882 1.75577 9.56686 1.91205 9.41058C2.06833 9.2543 2.28029 9.1665 2.5013 9.1665C2.72232 9.1665 2.93428 9.2543 3.09056 9.41058C3.24684 9.56686 3.33464 9.77882 3.33464 9.99984C3.334 11.4669 3.8176 12.8931 4.71039 14.0572C5.60318 15.2214 6.85524 16.0583 8.27227 16.4381C9.6893 16.8179 11.1921 16.7194 12.5474 16.1578C13.9027 15.5962 15.0348 14.603 15.768 13.3323C15.8228 13.2376 15.8957 13.1546 15.9826 13.0881C16.0695 13.0216 16.1687 12.9728 16.2744 12.9446C16.3802 12.9164 16.4904 12.9093 16.5989 12.9237C16.7074 12.9381 16.812 12.9738 16.9067 13.0286C17.0014 13.0834 17.0844 13.1564 17.1509 13.2433C17.2175 13.3302 17.2662 13.4293 17.2944 13.5351C17.3226 13.6408 17.3297 13.7511 17.3153 13.8595C17.3009 13.968 17.2653 14.0726 17.2105 14.1673C16.4776 15.4311 15.4263 16.4807 14.1614 17.2116C12.8965 17.9425 11.4622 18.3292 10.0013 18.3332Z" fill="#23A455" />
                  </svg>
                </div>
              </div>

              {/* 8. Queued */}
              <div className="co-metric-card">
                <div className="co-metric-left">
                  <div className="co-metric-val">{stats.queued}</div>
                  <div className="co-metric-lbl">
                    <span>Queued</span>
                    <span className="co-info-icon" title="Messages of scheduled campaigns waiting to go out">ⓘ</span>
                  </div>
                </div>
                <div className="co-metric-badge green">
                  <svg width="22" height="16" viewBox="0 0 22 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12.8626 1.36479V1.92329H5.66616C3.79786 1.92329 2.2794 3.44174 2.2794 5.31004V6.96775H2.27495C2.07347 6.96775 1.91016 6.80444 1.91016 6.60296V1.36479C1.91016 1.16335 2.07351 1 2.27495 1H12.4978C12.6993 1 12.8626 1.16335 12.8626 1.36479Z" stroke="#23A455" strokeWidth="2" />
                    <path d="M16.2532 5.31004V5.86853H9.50209C7.63381 5.86853 6.11533 7.3869 6.11533 9.25528V10.9129H5.66558C5.46413 10.9129 5.30078 10.7496 5.30078 10.5481V5.31004C5.30078 5.1086 5.46413 4.94525 5.66558 4.94525H15.8884C16.0899 4.94525 16.2532 5.10857 16.2532 5.31004Z" stroke="#23A455" strokeWidth="2" />
                    <path d="M9.50542 8.89056H19.7283C19.9298 8.89056 20.0931 9.05388 20.0931 9.25536V14.4935C20.0931 14.695 19.9298 14.8583 19.7283 14.8583H9.50542C9.30398 14.8583 9.14062 14.695 9.14062 14.4935V9.25536C9.14062 9.05391 9.30398 8.89056 9.50542 8.89056Z" stroke="#23A455" strokeWidth="2" />
                  </svg>
                </div>
              </div>
            </section>
          </>
        )}

        {/* Template Library gallery · Messenger / Instagram lists · WhatsApp templates · else the planner */}
        {activeNav === 'library' ? (
          <TemplateLibrary
            api={api}
            onNavigate={onNavigate}
            onStartWhatsAppCampaign={(name) => onCreateNew(name)}
            onStartMetaCampaign={(ch, content) => newMetaCampaign(ch, content)}
            onViewTemplates={(ch) => setActiveNav(ch === 'whatsapp' ? 'wa' : ch)}
            onCreated={(ch) => { if (ch === 'whatsapp') onTemplatesChanged?.(); }}
            onEditWhatsApp={onCreateTemplate ? (t) => onCreateTemplate(t) : undefined}
          />
        ) : activeNav === 'messenger' || activeNav === 'instagram' ? (
          <MetaChannelTemplateList
            key={activeNav}
            api={api}
            channel={activeNav}
            onNavigate={onNavigate}
            onUse={(content) => newMetaCampaign(activeNav, content)}
          />
        ) : activeNav === 'wa' ? (
          <div className="co-library-container tl-body">
            {/* Filter / Search Bar like Templates Page */}
            <div className="tl-toolbar">
              <div className="tl-sort">
                <span className="tl-toolbar-label">Sorted by:</span>
                <Dropdown
                  size="sm"
                  options={SORT_OPTIONS}
                  value={librarySort}
                  onChange={(v) => setLibrarySort(v as 'latest' | 'oldest' | 'name')}
                  className="tl-dropdown"
                />
              </div>

              <div className="tl-search">
                <input
                  className="k-input"
                  type="search"
                  placeholder="Search templates…"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  aria-label="Search templates"
                />
                <span className="tl-search-icon" aria-hidden="true">
                  <TemplateSearchSvg width={18} height={18} />
                </span>
              </div>

              <div className="tl-filter">
                <span className="material-icons tl-filter-icon" aria-hidden="true">filter_list</span>
                <Dropdown
                  size="sm"
                  options={statusOptions}
                  value={libraryStatusFilter}
                  onChange={(v) => setLibraryStatusFilter(v)}
                  placeholder="All statuses"
                  className="tl-dropdown tl-filter-dropdown"
                />
              </div>

              <div className="tl-filter">
                <Dropdown
                  size="sm"
                  options={categoryOptions}
                  value={libraryCategory}
                  onChange={(v) => setLibraryCategory(v)}
                  placeholder="All Categories"
                  className="tl-dropdown"
                />
              </div>
            </div>

            {/* Subhead count */}
            <div className="co-library-subhead" style={{ margin: '4px 0 2px' }}>
              <span>Showing {libraryRows.length} Template{libraryRows.length === 1 ? '' : 's'}</span>
            </div>

            {/* Table List View (Identical to Template Page) */}
            <div className="tl-table-wrap">
              <table className="tl-table">
                <thead>
                  <tr>
                    <th scope="col">Template Name</th>
                    <th scope="col">Category</th>
                    <th scope="col" className="c">Status</th>
                    <th scope="col">Language</th>
                    <th scope="col">Last Updated</th>
                    <th scope="col" className="c">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {libraryRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="tl-empty">
                        {templates?.length ? 'No templates match your search.' : 'No templates yet. Create your first one.'}
                      </td>
                    </tr>
                  ) : (
                    libraryRows.map((t) => {
                      const status = String(t.status || 'PENDING').toUpperCase();
                      const isApproved = status === 'APPROVED';
                      const trig = t.trigger;
                      const autoOn = !!trig?.enabled;
                      const ms = new Date(t.updatedAt || t.createdAt || 0).getTime() || 0;
                      const dateStr = ms
                        ? new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : '—';

                      return (
                        <tr key={t.name}>
                          <td>
                            <button
                              type="button"
                              className="tl-name"
                              onClick={() => setPreviewTemplate(t)}
                              title="Click to preview on WhatsApp phone screen"
                            >
                              {t.name}
                            </button>
                            {t.shared && (
                              <span className="tl-kind tl-sample" title="A sample template of the shared test number: send it from a chat to the people who joined your test number">
                                Sample
                              </span>
                            )}
                            {t.kind === 'carousel' && <span className="tl-kind">Carousel</span>}
                            {t.kind === 'lto' && <span className="tl-kind">Limited-time offer</span>}
                            {autoOn && (
                              <span className="tl-auto material-icons" title="Auto-send enabled" aria-label="Auto-send on">
                                bolt
                              </span>
                            )}
                          </td>
                          <td>{titleCase(t.category)}</td>
                          <td className="c">
                            <span className={`tl-status ${STATUS_TONE[status] || 'amber'}`}>{titleCase(status)}</span>
                          </td>
                          <td>{LANGUAGE_LABEL[t.language || ''] || t.language || '—'}</td>
                          <td>{dateStr}</td>
                          <td className="c">
                            <div className="tl-actions" style={{ alignItems: 'center', justifyContent: 'center' }}>
                              <button
                                type="button"
                                className="tl-act"
                                onClick={() => setPreviewTemplate(t)}
                                title="Preview on WhatsApp phone screen"
                                aria-label={`Preview ${t.name}`}
                              >
                                <TemplateViewSvg width={18} height={18} />
                              </button>
                              <button
                                type="button"
                                className="co-btn-start-camp-sm"
                                onClick={() => onCreateNew(t.name)}
                                disabled={!isApproved || !!t.shared}
                                title={t.shared
                                  ? 'Sample templates are sent from a chat to people who joined your test number. Connect your own WhatsApp number to run campaigns.'
                                  : isApproved ? `Start campaign with ${t.name}` : 'Only approved templates can be used in campaigns'}
                                data-testid="co-start-camp"
                              >
                                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M17.65 7.54L4.81 1.13C3.54 0.49 2.05 1.48 2.05 2.89L2 8.5L12 10L2 11.5L2.05 17.11C2.05 18.52 3.54 19.51 4.81 18.87L17.65 12.46C18.88 11.84 18.88 10.16 17.65 9.54V7.54Z" fill="currentColor" />
                                </svg>
                                <span>Start Campaign</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Phone Preview Modal */}
            {previewTemplate && (
              <div className="demo-backdrop" onClick={() => setPreviewTemplate(null)}>
                <div className="demo-box co-phone-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="demo-head">
                    <span>Template Preview: {previewTemplate.name}</span>
                    <button className="demo-close" onClick={() => setPreviewTemplate(null)}>✕</button>
                  </div>
                  <div className="demo-body co-phone-modal-body">
                    <TemplatePhonePreview
                      {...previewPropsFromTemplate(previewTemplate)}
                      showTitle={false}
                    />
                    <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                      <button
                        className="co-btn-primary"
                        onClick={() => {
                          const name = previewTemplate.name;
                          setPreviewTemplate(null);
                          onCreateNew(name);
                        }}
                        disabled={previewTemplate.status !== 'APPROVED' || !!previewTemplate.shared}
                        title={previewTemplate.shared ? 'Sample templates are sent from a chat. Connect your own WhatsApp number to run campaigns.' : undefined}
                      >
                        Start Campaign With This Template
                      </button>
                      <button className="co-btn-outline" onClick={() => setPreviewTemplate(null)}>
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ================= CAMPAIGN PLANNER ================= */
          <section className={`co-planner-sec${activeNav === 'scheduled' ? ' full-view' : ''}`}>
          <div className="co-planner-head">
            <div className="co-view-tabs">
              <button
                className={`co-vtab calendar${plannerTab === 'calendar' ? ' active' : ''}`}
                onClick={() => setPlannerTab('calendar')}
              >
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="2.5" y="3.5" width="15" height="14" rx="2" stroke="#2563eb" strokeWidth="1.5" fill="#eff6ff" />
                  <path d="M6 1.8V4.8M14 1.8V4.8M2.5 7.5H17.5" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M5.5 10.5H6.5M10 10.5H11M14.5 10.5H15.5M5.5 13.5H6.5M10 13.5H11M14.5 13.5H15.5" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span>Calendar</span>
              </button>
              <button
                className={`co-vtab list${plannerTab === 'list' ? ' active' : ''}`}
                onClick={() => setPlannerTab('list')}
              >
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="3.5" width="14" height="13" rx="1.5" stroke="#ef4444" strokeWidth="1.5" />
                  <path d="M6.5 7H13.5M6.5 10H13.5M6.5 13H10.5" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                <span>List</span>
              </button>
            </div>

            <div className="co-planner-head-right">
              <label className="co-checkbox-label">
                <input
                  type="checkbox"
                  checked={setDefaultView}
                  onChange={(e) => setSetDefaultView(e.target.checked)}
                />
                <span className="co-custom-check">
                  <svg width="10" height="10" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 10.5L8 14.5L16 6.5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span>Set as default view</span>
              </label>
            </div>
          </div>

          {/* Sub Toolbar (Month Navigator & Filters) */}
          <div className="co-planner-toolbar">
            <div className="co-month-nav">
              <button
                className="co-nav-arrow-bare"
                aria-label="Previous month"
                onClick={() => setCalMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              >
                ‹
              </button>
              <span className="co-month-title">{monthTitle}</span>
              <button
                className="co-nav-arrow-bare"
                aria-label="Next month"
                onClick={() => setCalMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              >
                ›
              </button>
            </div>

            <div className="co-legend">
              <span className="co-legend-item">
                <span className="co-legend-box purple" /> Scheduled
              </span>
              <span className="co-legend-item">
                <span className="co-legend-box green" /> Sent
              </span>
              <span className="co-legend-item">
                <span className="co-legend-box amber" /> Draft
              </span>
            </div>

            <div className="co-planner-actions">
              <div className="co-select-pill">
                <select
                  value={plannerFilter}
                  onChange={(e) => setPlannerFilter(e.target.value)}
                  aria-label="Filter campaigns"
                >
                  <option value="All Campaigns">All Campaigns</option>
                  <option value="Scheduled">Scheduled</option>
                  <option value="Sent">Sent</option>
                  <option value="Draft">Draft</option>
                </select>
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 7.5L10 12.5L15 7.5" stroke="#6b7280" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              <div className="co-select-pill">
                <select
                  value={channelFilter}
                  onChange={(e) => setChannelFilter(e.target.value as 'all' | CampaignChannel)}
                  aria-label="Filter by channel"
                  data-testid="co-channel-filter"
                >
                  <option value="all">All channels</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 7.5L10 12.5L15 7.5" stroke="#6b7280" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              <button className="co-btn-create-green" onClick={() => onCreateNew()}>
                Create New
              </button>
            </div>
          </div>

          {/* CALENDAR VIEW */}
          {plannerTab === 'calendar' && (
            <div className="co-calendar-grid">
              {/* Day column headers */}
              <div className="co-cal-row head">
                <div className="co-cal-head-cell">Mon</div>
                <div className="co-cal-head-cell">Tue</div>
                <div className="co-cal-head-cell">Wed</div>
                <div className="co-cal-head-cell">Thu</div>
                <div className="co-cal-head-cell">Fri</div>
                <div className="co-cal-head-cell">Sat</div>
                <div className="co-cal-head-cell">Sun</div>
              </div>

              {/* Day cells grid */}
              <div className="co-cal-cells">
                {daysInGrid.map((item) => {
                  const events = calendarEvents[item.key] || null;
                  return (
                    <div
                      key={item.key}
                      className={`co-cal-cell${!item.isCurrentMonth ? ' outside' : ''}${item.key === todayKey ? ' today' : ''}`}
                      data-day={item.key}
                      onClick={() => {
                        if (events && events.length > 0) openEvent(events[0].id, events[0].status);
                        else onCreateNew();
                      }}
                    >
                      <div className="co-cal-day-num">{item.day}</div>
                      {events && events.map((ev) => (
                        <div
                          key={ev.id}
                          className={`co-cal-event ${ev.type}`}
                          title={`${ev.title} · ${STATUS_LABEL[ev.status]} (${ev.time})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEvent(ev.id, ev.status);
                          }}
                        >
                          <span className="co-event-dot" />
                          <span className="co-event-text">{ev.title}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* LIST VIEW */}
          {plannerTab === 'list' && (
            <div className="co-list-wrap">
              {loadError && <p className="err" style={{ margin: '0 0 10px' }}>{loadError}</p>}
              {listCampaigns.length === 0 ? (
                <div className="co-empty-state">
                  <div className="co-empty-icon">
                    <svg width="40" height="40" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10 2C5.58 2 2 5.58 2 10C2 11.54 2.44 12.97 3.2 14.19L2 18L5.92 16.83C7.11 17.57 8.51 18 10 18C14.42 18 18 14.42 18 10C18 5.58 14.42 2 10 2Z" stroke="#94a3af" strokeWidth="1.5" />
                    </svg>
                  </div>
                  <h4>No campaigns found</h4>
                  <p>There are no campaigns for the selected filters. Click below to schedule or broadcast a campaign.</p>
                  <button className="co-btn-primary" onClick={() => onCreateNew()}>
                    Create New Campaign
                  </button>
                </div>
              ) : (
                <table className="co-table">
                  <thead>
                    <tr>
                      <th>Campaign Name</th>
                      <th>Template</th>
                      <th>Date & Time</th>
                      <th>Channel</th>
                      <th>Recipients</th>
                      <th>Delivery Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listCampaigns.map((c) => (
                      <tr key={c.id} data-campaign-id={c.id}>
                        <td className="co-table-title">{c.name}</td>
                        <td>
                          <span className="co-tmpl-chip">{c.template}</span>
                        </td>
                        <td className="co-table-date">{c.date}</td>
                        <td>
                          <span className="co-channel-tag" data-channel={c.channelKey}>
                            <img src={CHANNEL_ICON[c.channelKey]} alt="" />
                            {c.channel}
                          </span>
                        </td>
                        <td>{c.recipients}</td>
                        <td>
                          <span
                            className={`co-status-pill ${c.status}`}
                            title={c.error || (c.dripNextAt ? `Drip: next follow-up ${formatWhen(new Date(c.dripNextAt).getTime())}` : undefined)}
                          >
                            {c.dripNextAt && c.status === 'sending' ? 'Drip running' : STATUS_LABEL[c.status] || c.status}
                          </span>
                          {c.status !== 'draft' && (
                            <div className="co-row-counts" data-testid="co-row-counts">
                              {c.stats.accepted} sent · {c.stats.delivered} delivered · {c.stats.read} read
                              {' · '}
                              <span className={c.stats.failed ? 'co-count-failed' : ''}>{c.stats.failed} failed</span>
                              {c.stats.pending > 0 && ` · ${c.stats.pending} pending`}
                              {(c.stats.skipped || 0) > 0 && ` · ${c.stats.skipped} skipped`}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="co-row-actions">
                            <button
                              className="co-btn-table-action"
                              onClick={() => (c.status === 'draft' ? resumeCampaign(c.id) : openDetail(c.id))}
                              title={c.status === 'draft' ? 'Edit / Resume Draft Campaign' : 'See each recipient\'s delivery status'}
                              disabled={detailBusy}
                            >
                              {c.status === 'draft' ? 'Edit Draft' : 'View'}
                            </button>
                            {(c.status === 'draft' || c.status === 'cancelled') && (
                              <button
                                className="co-btn-table-action danger"
                                onClick={() => deleteCampaign(c)}
                                title="Delete this campaign"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </section>
        )}

        {/* Bottom Walkthrough Toast (Dismissible) */}
        {showWalkthrough && (
          <div className="co-walkthrough-toast">
            <span>Master campaigns quickly with interactive feature walkthroughs</span>
            <button
              className="co-toast-close"
              onClick={() => setShowWalkthrough(false)}
              aria-label="Dismiss guide"
            >
              ✕
            </button>
          </div>
        )}

        {/* Floating Chat / Help Bubble */}
        <button
          className="co-fab-chat"
          title="Need help or walkthrough?"
          aria-label="Help chat"
          onClick={() => setShowTutorial(true)}
        >
          <svg width="22" height="22" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 3C5.58 3 2 6.13 2 10C2 11.5 2.5 12.88 3.37 14L2.5 17.5L6.15 16.65C7.29 17.29 8.6 17.67 10 17.67C14.42 17.67 18 14.54 18 10.67C18 6.8 14.42 3 10 3Z" fill="white" />
          </svg>
        </button>

        {/* Campaign results: every recipient's real delivery state */}
        {detail && (
          <div className="demo-backdrop" onClick={() => setDetail(null)}>
            <div className="demo-box co-results-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Campaign results">
              <div className="demo-head">
                <span>{detail.name}</span>
                <button className="demo-close" onClick={() => setDetail(null)} aria-label="Close">
                  ✕
                </button>
              </div>
              <div className="demo-body co-results-body">
                <div className="co-results-meta">
                  <span className={`co-status-pill ${detail.status}`}>{STATUS_LABEL[detail.status] || detail.status}</span>
                  <span className="co-channel-tag" data-channel={channelOf(detail)}>
                    <img src={CHANNEL_ICON[channelOf(detail)]} alt="" />
                    {CHANNEL_NAME[channelOf(detail)]}
                  </span>
                  {channelOf(detail) === 'whatsapp' ? (
                    <span>Template: <strong>{detail.templateName || '—'}</strong></span>
                  ) : (
                    <span>
                      Sends: <strong>
                        {[detail.content?.quickMessageName && `quick message “${detail.content.quickMessageName}”`,
                          detail.content?.mode === 'text' && 'a text message',
                          detail.content?.utilityTemplateName && `utility template “${detail.content.utilityTemplateName}”`]
                          .filter(Boolean).join(' + ') || '—'}
                      </strong>
                    </span>
                  )}
                  <span>
                    {detail.status === 'scheduled' ? 'Scheduled for' : 'Started'}:{' '}
                    <strong>{formatWhen(new Date(detail.startedAt || detail.scheduledAt || detail.createdAt || 0).getTime())}</strong>
                  </span>
                  {detail.finishedAt && detail.status !== 'scheduled' && (
                    <span>Finished: <strong>{formatWhen(new Date(detail.finishedAt).getTime())}</strong></span>
                  )}
                  {detail.type === 'drip' && (
                    <span>Drip: <strong>{detail.drip?.name || 'sequence'}</strong> ({detail.drip?.steps.length || 0} follow-up{detail.drip?.steps.length === 1 ? '' : 's'})</span>
                  )}
                </div>
                {detail.error && <p className="err co-results-error">{detail.error}</p>}
                {detail.stats && (
                  <div className="co-results-stats" data-testid="co-results-stats">
                    {([
                      ['Recipients', detail.stats.total],
                      ['Sent', detail.stats.accepted],
                      ['Delivered', detail.stats.delivered],
                      ['Read', detail.stats.read],
                      ['Replied', detail.stats.replied],
                      ['Failed', detail.stats.failed],
                      ['Not delivered yet', detail.stats.sentOnly],
                      ['Pending', detail.stats.pending],
                      ...(detail.stats.cancelled ? [['Cancelled', detail.stats.cancelled] as [string, number]] : []),
                      ...(channelOf(detail) !== 'whatsapp' ? [['Skipped (outside 24 h)', detail.stats.skipped || 0] as [string, number]] : []),
                      // WhatsApp: numbers another campaign had just sent the same template to.
                      ...(channelOf(detail) === 'whatsapp' && detail.stats.skipped ? [['Skipped (already sent)', detail.stats.skipped] as [string, number]] : []),
                    ] as [string, number][]).map(([label, n]) => (
                      <div key={label} className={`co-results-stat${label === 'Failed' && n ? ' failed' : ''}`}>
                        <strong>{n}</strong>
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {detail.dripProgress && (
                  <div className="co-drip" data-testid="co-drip">
                    <div className="co-drip-head">
                      <strong>Drip follow-ups</strong>
                      <span>
                        {detail.dripProgress.stopOnReply ? 'Stops for anyone who replies' : 'Sent whether or not they reply'}
                        {detail.dripProgress.nextAt && detail.status === 'sending'
                          ? ` · next one ${formatWhen(new Date(detail.dripProgress.nextAt).getTime())}`
                          : ''}
                      </span>
                    </div>
                    <table className="co-table co-drip-table">
                      <thead>
                        <tr>
                          <th>Follow-up</th>
                          <th>Sent after</th>
                          <th>Sent</th>
                          <th>Delivered</th>
                          <th>Read</th>
                          <th>Failed</th>
                          <th>Waiting</th>
                          <th>Stopped (replied)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.dripProgress.steps.map((s) => (
                          <tr key={s.step} data-step={s.step}>
                            <td>{s.step}. <strong>{s.templateName}</strong></td>
                            <td>{waitText(s.delayMs)}</td>
                            <td>{s.sent}</td>
                            <td>{s.delivered}</td>
                            <td>{s.read}</td>
                            <td className={s.failed ? 'co-drip-bad' : ''}>{s.failed}</td>
                            <td>{s.waiting}</td>
                            <td>{s.stopped}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="co-results-table-wrap">
                  <table className="co-table co-results-table">
                    <thead>
                      <tr>
                        <th>Recipient</th>
                        <th>{channelOf(detail) === 'whatsapp' ? 'Phone' : 'Sent as'}</th>
                        <th>Status</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.recipients.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="tl-empty">No recipients.</td>
                        </tr>
                      ) : (
                        detail.recipients.map((r) => {
                          const why = reasonText(r.error);
                          return (
                            <tr key={r.phone} data-phone={r.phone}>
                              <td>{r.name && r.name !== `+${r.phone}` ? r.name : channelOf(detail) === 'whatsapp' ? '—' : `${CHANNEL_NAME[channelOf(detail)]} user`}</td>
                              <td>
                                {channelOf(detail) === 'whatsapp'
                                  ? `+${r.phone}`
                                  : r.via === 'utility' ? 'Utility template' : r.via === 'quick' ? 'Quick message' : '—'}
                              </td>
                              <td>
                                <span className={`co-rcpt-status ${r.status}`}>{RECIPIENT_LABEL[r.status] || r.status}</span>
                                {r.replied && <span className="co-rcpt-replied">Replied</span>}
                              </td>
                              <td className="co-rcpt-reason" title={why.full || undefined}>
                                {why.short || ''}
                                {why.full && r.error?.code ? <span className="co-rcpt-code"> ({r.error.code})</span> : null}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="co-results-actions">
                  {(detail.status === 'scheduled' || detail.status === 'sending') && (
                    <button className="co-btn-outline danger" onClick={() => cancelCampaign(detail)}>
                      Cancel campaign
                    </button>
                  )}
                  {detail.status === 'scheduled' && (
                    <button
                      className="co-btn-outline"
                      onClick={() => {
                        const id = detail._id;
                        setDetail(null);
                        resumeCampaign(id);
                      }}
                    >
                      Edit
                    </button>
                  )}
                  {(detail.status === 'scheduled' || detail.status === 'cancelled') && (
                    <button
                      className="co-btn-outline danger"
                      onClick={() => deleteCampaign({ id: detail._id, name: detail.name })}
                    >
                      Delete
                    </button>
                  )}
                  <button className="co-btn-primary" onClick={() => setDetail(null)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tutorial Modal */}
        {showTutorial && (
          <div className="demo-backdrop" onClick={() => setShowTutorial(false)}>
            <div className="demo-box" onClick={(e) => e.stopPropagation()}>
              <div className="demo-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>Campaigns Video Tutorial</span>
                  <span className="co-soon-badge">Soon</span>
                </div>
                <button
                  className="demo-close"
                  onClick={() => setShowTutorial(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <div className="demo-body" style={{ padding: '24px' }}>
                <div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', fontWeight: 600, marginBottom: '14px' }}>
                    <span>Video tutorial is coming soon!</span>
                  </div>
                  <h4 style={{ margin: '0 0 10px', fontSize: '16px' }}>Getting Started with Campaigns</h4>
                  <p style={{ color: '#6b7280', fontSize: '14px', lineHeight: 1.6 }}>
                    1. <strong>Select an Approved Template:</strong> Choose from your verified WhatsApp templates.<br />
                    2. <strong>Add Audience:</strong> Paste mobile numbers with country codes or upload Excel / CSV files.<br />
                    3. <strong>Preview Live:</strong> Review your message in the WhatsApp mobile preview on the right.<br />
                    4. <strong>Send & Track:</strong> Deliver at high speed with automatic rate-limit spacing and real-time delivery statuses.
                  </p>
                  <div style={{ marginTop: '20px' }}>
                    <button className="co-btn-primary" onClick={() => { setShowTutorial(false); onCreateNew(); }}>
                      Create Campaign Now
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
