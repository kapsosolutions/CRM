// Templates: a table of every template (name, category, status, language,
// last updated) with sort, search and a status filter. Click a name or the eye
// to open it read-only with its auto-send settings; the copy icon starts a new
// template from it; the bin deletes it (from WhatsApp too).
import { PlanCrown, useFeatureLock } from './PlanLocked';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type { BusinessProfile, TemplateItem, TriggerEvent } from '../types';
import { TemplateComposerPage } from './TemplateComposerPage';
import { triggerSummary } from './TemplateAutoSend';
import { templateReason } from '../templateReasons';
import { useConfirm, useNotify } from './Dialogs';
import { Dropdown, type KOption } from './Dropdown';
import { TemplateDuplicateSvg, TemplateDeleteSvg, TemplateViewSvg, TemplateSearchSvg, TemplateCreateSvg } from './TemplateIcons';
import { BladeSpinner } from './BladeSpinner';
import { Pager, usePaged } from './Pager';
import { MetaTemplatesPanel } from './MetaTemplates';
import { TemplatePhonePreview, previewPropsFromTemplate } from './TemplatePhonePreview';
import { TemplateLibrary } from './TemplateLibrary';
import { TemplateApiDialog } from './TemplateApiDialog';
import './TemplateLibrary.css';

// Template Library · WhatsApp · Messenger · Instagram, in a left sidebar like
// the Campaigns page's (a scrollable tab row on mobile, TemplateLibrary.css).
export type TemplatesTab = 'library' | 'whatsapp' | 'messenger' | 'instagram';
type ChannelTab = TemplatesTab;
const TAB_KEY = 'crm_templates_channel_tab';
// Messenger and Instagram are hidden (campaigns are WhatsApp only). Add
// { key: 'messenger' | 'instagram', … } back here to show those tabs again.
const CHANNEL_TABS: { key: ChannelTab; label: string; icon: string }[] = [
  { key: 'library', label: 'Template Library', icon: '' },
  { key: 'whatsapp', label: 'WhatsApp', icon: '/whatsapp.svg' },
];
const isShownTab = (t: unknown): t is ChannelTab => CHANNEL_TABS.some((x) => x.key === t);

interface Props {
  api: CrmApi;
  /** The shell's unsaved-changes probe, passed on to the create/view page. */
  registerDirty?: (fn: (() => boolean) | null) => void;
  business?: BusinessProfile;
  demo?: boolean;
  onNavigate?: (view: any) => void;
  initialMode?: 'list' | 'create';
  onModeChange?: (mode: 'list' | 'create') => void;
  /** Open this template (by name), e.g. from a notification. `n` changes per request. */
  focusRequest?: { id: string; n: number } | null;
  /** Switch to this sidebar item while already on the page ('templates:<tab>'). `n` changes per request. */
  tabRequest?: { tab: TemplatesTab; n: number } | null;
}

type Sort = 'latest' | 'oldest' | 'name';
type View = { mode: 'list' } | { mode: 'create'; from?: TemplateItem; prefill?: boolean } | { mode: 'view'; template: TemplateItem };

const SORT_OPTIONS: KOption[] = [
  { value: 'latest', label: 'Latest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name (A–Z)' },
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
const timeOf = (t: TemplateItem) => new Date(t.updatedAt || t.createdAt || 0).getTime() || 0;
const dateLabel = (t: TemplateItem) => {
  const ms = timeOf(t);
  return ms
    ? new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';
};

export function TemplatesPage({
  api,
  registerDirty,
  business,
  demo,
  onNavigate,
  initialMode = 'list',
  onModeChange,
  focusRequest,
  tabRequest,
}: Props) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>(() => (initialMode === 'create' ? { mode: 'create' } : { mode: 'list' }));
  const [sort, setSort] = useState<Sort>('latest');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [events, setEvents] = useState<TriggerEvent[]>([]);
  // A shared sample template opened for a look (phone preview, read-only).
  const [samplePreview, setSamplePreview] = useState<TemplateItem | null>(null);
  // "Use from your apps": one template's API (or just the keys, when null).
  const [apiFor, setApiFor] = useState<{ template: TemplateItem | null } | null>(null);
  // The template API is a plan feature (Basic and up): a crown, and the plans dialog.
  const apiPlan = useFeatureLock()('api');
  const openApi = (template: TemplateItem | null) => (apiPlan ? apiPlan.open() : setApiFor({ template }));
  const [tab, setTab] = useState<ChannelTab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as ChannelTab | null;
      return saved && CHANNEL_TABS.some((t) => t.key === saved) ? saved : 'whatsapp';
    } catch {
      return 'whatsapp';
    }
  });
  function pickTab(t: ChannelTab) {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  }

  // 'templates:<tab>' while the page is open (on mount the saved choice already has it).
  const tabMounted = useRef(false);
  useEffect(() => {
    if (tabMounted.current && tabRequest?.tab) {
      pickTab(isShownTab(tabRequest.tab) ? tabRequest.tab : 'whatsapp');
      setView((v) => (v.mode === 'create' ? v : { mode: 'list' }));
    }
    tabMounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabRequest?.n]);

  useEffect(() => {
    if (initialMode === 'create') {
      setView({ mode: 'create' });
    } else if (initialMode === 'list') {
      setView((prev) => (prev.mode === 'create' && !prev.from ? { mode: 'list' } : prev));
    }
  }, [initialMode]);

  function load() {
    setLoading(true);
    // Not connected yet: the shared test number's sample templates are listed
    // too (read-only, marked Sample). A connected business only gets its own.
    return api
      .getTemplates({ includeShared: true })
      .then((res) => setTemplates(res.data || []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api
      .getTemplateSources()
      .then((r) => setEvents(r.events || []))
      .catch(() => setEvents([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opened from a notification: show that template once the list is in.
  // Already on this page, the list is reloaded first so its status is fresh.
  const [pendingOpen, setPendingOpen] = useState('');
  const focusMounted = useRef(false);
  useEffect(() => {
    // A Messenger template's status notification ("messenger:<name>") opens that tab, when it is shown.
    if (focusRequest?.id?.startsWith('messenger:')) {
      if (isShownTab('messenger')) pickTab('messenger');
      focusMounted.current = true;
      return;
    }
    if (focusRequest?.id) {
      pickTab('whatsapp');
      setPendingOpen(focusRequest.id);
      if (focusMounted.current) load();
    }
    focusMounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.n]);
  useEffect(() => {
    if (!pendingOpen || loading) return;
    setPendingOpen('');
    // Never throw away a template being written.
    if (view.mode === 'create') return;
    const t = templates.find((x) => x.name === pendingOpen && !x.shared);
    if (t) setView({ mode: 'view', template: t });
    else setQuery(pendingOpen);
  }, [pendingOpen, loading, templates, view.mode]);

  const statuses = useMemo(
    () => [...new Set(templates.map((t) => String(t.status || 'PENDING').toUpperCase()))].sort(),
    [templates],
  );

  const statusOptions: KOption[] = useMemo(
    () => [
      { value: '', label: 'All statuses' },
      ...statuses.map((s) => ({ value: s, label: titleCase(s) })),
    ],
    [statuses],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = templates.filter(
      (t) =>
        (!statusFilter || String(t.status || 'PENDING').toUpperCase() === statusFilter) &&
        (!q || t.name.toLowerCase().includes(q) || String(t.category || '').toLowerCase().includes(q)),
    );
    return list.sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : sort === 'oldest' ? timeOf(a) - timeOf(b) : timeOf(b) - timeOf(a),
    );
  }, [templates, query, statusFilter, sort]);
  const paged = usePaged(rows, `${query}|${statusFilter}|${sort}`, { key: 'templates', noun: ['template', 'templates'] });

  async function remove(t: TemplateItem) {
    const ok = await confirm({
      title: 'Delete template?',
      message: `“${t.name}” will be deleted from WhatsApp too. Campaigns and automations using it will stop sending it.`,
      confirmLabel: 'Delete template',
    });
    if (!ok) return;
    try {
      await api.deleteTemplate(t.name);
      notify('success', 'Template deleted', `“${t.name}” was removed.`);
      if (view.mode === 'view') setView({ mode: 'list' });
      load();
    } catch (e) {
      notify('error', 'Delete failed', e instanceof Error ? e.message : 'Could not delete the template.');
    }
  }



  // ---- Sub-pages ----
  if (view.mode === 'create') {
    return (
      <TemplateComposerPage
        key={`${view.prefill ? 'lib-' : ''}${view.from?.name || 'new'}`}
        api={api}
        template={view.from || null}
        prefill={!!view.prefill}
        registerDirty={registerDirty}
        business={business}
        demo={demo}
        onNavigate={onNavigate}
        onBack={() => {
          setView({ mode: 'list' });
          onModeChange?.('list');
        }}
        onCreated={() => {
          setView({ mode: 'list' });
          onModeChange?.('list');
          load();
        }}
        onOpenLibrary={() => {
          pickTab('library');
          setView({ mode: 'list' });
          onModeChange?.('list');
        }}
      />
    );
  }
  if (view.mode === 'view') {
    return (
      <TemplateComposerPage
        key={`view-${view.template.name}`}
        api={api}
        mode="view"
        template={view.template}
        registerDirty={registerDirty}
        business={business}
        demo={demo}
        onNavigate={onNavigate}
        onBack={() => setView({ mode: 'list' })}
        onCreated={() => {}}
        onDuplicate={(t) => setView({ mode: 'create', from: t })}
        onChanged={load}
      />
    );
  }

  // Left sidebar (Campaigns page style); a horizontal tab row on mobile.
  const withSidebar = (content: ReactNode) => (
    <div className="co-shell tpl-shell" data-testid="tpl-shell">
      <aside className="co-sidebar tpl-sidebar">
        <div className="co-sidebar-head">
          <h3>Templates</h3>
        </div>
        <nav className="co-nav tpl-channel-tabs" role="tablist" aria-label="Templates" aria-orientation="vertical">
          {CHANNEL_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`co-nav-item${tab === t.key ? ' active' : ''}`}
              onClick={() => pickTab(t.key)}
              data-testid={`tpl-tab-${t.key}`}
            >
              <div className="co-nav-item-left">
                {t.icon ? (
                  <img src={t.icon} alt="" className="co-nav-icon tpl-side-icon" />
                ) : (
                  <span className="material-icons co-nav-icon tpl-side-icon" aria-hidden="true" style={{ fontSize: 18 }}>auto_awesome_mosaic</span>
                )}
                <span>{t.label}</span>
              </div>
            </button>
          ))}
        </nav>
      </aside>
      <div className="tpl-shell-main">{content}</div>
    </div>
  );

  if (tab === 'library') {
    return withSidebar(
      <div className="page tl-page">
        <div className="page-body tl-body tpl-library-body">
          <TemplateLibrary
            api={api}
            onNavigate={onNavigate}
            onStartWhatsAppCampaign={(name) => onNavigate?.(`campaign-new:whatsapp:${name}`)}
            onStartMetaCampaign={(ch, c) => onNavigate?.(
              c.utilityTemplateId ? `campaign-new:${ch}:utility:${c.utilityTemplateId}` : c.quickMessageId ? `campaign-new:${ch}:quick:${c.quickMessageId}` : `campaign-new:${ch}`,
            )}
            onViewTemplates={(ch) => pickTab(isShownTab(ch) ? ch : 'whatsapp')}
            onCreated={(ch) => { if (ch === 'whatsapp') load(); }}
            onEditWhatsApp={(t) => {
              pickTab('whatsapp');
              setView({ mode: 'create', from: t, prefill: true });
            }}
          />
        </div>
      </div>,
    );
  }

  if ((tab === 'messenger' || tab === 'instagram') && isShownTab(tab)) {
    return withSidebar(
      <div className="page tl-page">
        <div className="page-body tl-body">
          <MetaTemplatesPanel key={tab} api={api} channel={tab} onNavigate={onNavigate} />
        </div>
      </div>,
    );
  }

  return withSidebar(
    <div className="page tl-page">
      <header className="page-head">
        <span className="page-head-fill" />
        <button
          type="button"
          className={`k-btn ghost tl-api-keys${apiPlan ? ' plan-locked' : ''}`}
          onClick={() => openApi(null)}
          data-testid="tl-api-keys"
          data-plan-locked={apiPlan ? apiPlan.tier : undefined}
          title={apiPlan ? 'Template API keys are included from the Basic plan' : undefined}
        >
          <span className="material-icons" aria-hidden="true">key</span> API keys
          {apiPlan && <PlanCrown tier={apiPlan.tier} />}
        </button>
        <button className="k-btn tl-new" onClick={() => setView({ mode: 'create' })}>
          <TemplateCreateSvg width={18} height={18} /> Create Template
        </button>
      </header>

      <div className="page-body tl-body">
        <div className="tl-toolbar">
          <div className="tl-sort">
            <span className="tl-toolbar-label">Sorted by:</span>
            <Dropdown
              size="sm"
              options={SORT_OPTIONS}
              value={sort}
              onChange={(v) => setSort(v as Sort)}
              className="tl-dropdown"
            />
          </div>
          <div className="tl-search">
            <input
              className="k-input"
              type="search"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
              value={statusFilter}
              onChange={setStatusFilter}
              placeholder="All statuses"
              className="tl-dropdown tl-filter-dropdown"
            />
          </div>
        </div>

        <div className="tl-table-wrap">
          <table className="tl-table">
            <thead>
              <tr>
                <th scope="col">Template Name</th>
                <th scope="col">Category</th>
                <th scope="col" className="c">Status</th>
                <th scope="col">Language</th>
                <th scope="col">Last Updated</th>
                <th scope="col" className="c">API</th>
                <th scope="col" className="c">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && templates.length === 0 && (
                <tr>
                  <td colSpan={7} className="tl-empty" style={{ padding: '36px 0' }}>
                    <BladeSpinner center={true} containerHeight={100} />
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="tl-empty">
                    {templates.length ? 'No templates match your search.' : 'No templates yet. Create your first one.'}
                  </td>
                </tr>
              )}
              {paged.items.map((t) => {
                const status = String(t.status || 'PENDING').toUpperCase();
                const trig = t.trigger;
                const autoOn = !!trig?.enabled;
                return (
                  <tr key={t.name} data-shared={t.shared ? '1' : undefined} data-testid="tl-row">
                    <td>
                      <button
                        type="button"
                        className="tl-name"
                        onClick={() => (t.shared ? setSamplePreview(t) : setView({ mode: 'view', template: t }))}
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
                        <span
                          className="tl-auto material-icons"
                          title={`Auto-send on: ${triggerSummary(
                            { enabled: true, keywords: trig?.keywords || [], statuses: trig?.statuses || [], events: trig?.events || [] },
                            events,
                          )}`}
                          aria-label="Auto-send on"
                        >
                          bolt
                        </span>
                      )}
                    </td>
                    <td>{titleCase(t.category)}</td>
                    <td className="c">
                      <span className={`tl-status ${STATUS_TONE[status] || 'amber'}`}>{titleCase(status)}</span>
                      {templateReason(t.rejectedReason) && (
                        <span className="tl-reason" title={templateReason(t.rejectedReason)!.fix}>
                          {templateReason(t.rejectedReason)!.title}
                        </span>
                      )}
                    </td>
                    <td>{LANGUAGE_LABEL[t.language || ''] || t.language || '—'}</td>
                    <td>{dateLabel(t)}</td>
                    <td className="c">
                      {t.shared ? (
                        <span className="tl-api-na" title="Sample templates of the shared test number can't be sent through the API">—</span>
                      ) : (
                        <button
                          type="button"
                          className={`tl-api-btn${apiPlan ? ' plan-locked' : ''}`}
                          onClick={() => openApi(t)}
                          title={apiPlan ? 'Template API keys are included from the Basic plan' : `Send ${t.name} from your website, app or server`}
                          aria-label={`API for ${t.name}`}
                          data-testid="tl-api"
                          data-plan-locked={apiPlan ? apiPlan.tier : undefined}
                        >
                          <span className="material-icons" aria-hidden="true">code</span>
                          API
                          {apiPlan && <PlanCrown tier={apiPlan.tier} size={13} />}
                        </button>
                      )}
                    </td>
                    <td className="c">
                      {t.shared ? (
                        // A sample of the shared test number: preview only (it isn't the business's to edit or delete).
                        <div className="tl-actions">
                          <button
                            type="button"
                            className="tl-act"
                            onClick={() => setSamplePreview(t)}
                            title="Preview"
                            aria-label={`Preview ${t.name}`}
                          >
                            <TemplateViewSvg width={18} height={18} />
                          </button>
                        </div>
                      ) : (
                      <div className="tl-actions">
                        <button
                          type="button"
                          className="tl-act"
                          onClick={() => setView({ mode: 'create', from: t })}
                          title="Duplicate"
                          aria-label={`Duplicate ${t.name}`}
                        >
                          <TemplateDuplicateSvg width={18} height={18} />
                        </button>
                        <button
                          type="button"
                          className="tl-act"
                          onClick={() => setView({ mode: 'view', template: t })}
                          title="View"
                          aria-label={`View ${t.name}`}
                        >
                          <TemplateViewSvg width={18} height={18} />
                        </button>
                        <button
                          type="button"
                          className="tl-act danger"
                          onClick={() => remove(t)}
                          title="Delete"
                          aria-label={`Delete ${t.name}`}
                        >
                          <TemplateDeleteSvg width={18} height={18} />
                        </button>
                      </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager {...paged.pager} />
      </div>
      {apiFor && (
        <TemplateApiDialog
          api={api}
          template={apiFor.template}
          connected={!!demo || !!business?.whatsappConnected}
          onClose={() => setApiFor(null)}
        />
      )}
      {samplePreview && (
        <div className="demo-backdrop" onClick={() => setSamplePreview(null)}>
          <div className="demo-box co-phone-modal" onClick={(e) => e.stopPropagation()} data-testid="tl-sample-preview">
            <div className="demo-head">
              <span>Sample template: {samplePreview.name}</span>
              <button className="demo-close" onClick={() => setSamplePreview(null)}>✕</button>
            </div>
            <div className="demo-body co-phone-modal-body">
              <TemplatePhonePreview {...previewPropsFromTemplate(samplePreview)} showTitle={false} />
              <p className="k-hint" style={{ marginTop: 14 }}>
                Send it from a chat (Templates button) to someone who joined your test number. Connect your own WhatsApp number to create your own templates.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>,
  );
}
