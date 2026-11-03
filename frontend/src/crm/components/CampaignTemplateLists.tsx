// Campaigns → Template Messages → Messenger / Instagram: the templates a
// campaign on that channel can send, in the same table layout as the WhatsApp
// list (sort, search, filters, "Showing N templates").
//   Messenger: utility templates (approved by Meta) and quick messages.
//   Instagram: quick messages.
// "Use in campaign" opens the channel's campaign creator with it preselected.
import { useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type { MetaCampaignInitialContent, MetaChannel, MetaChannelConnection, QuickMessage, UtilityTemplate } from '../types';
import { CHANNEL_LABEL, KIND_LABEL, languageLabel, utilityReason } from '../metaMessaging';
import { Modal, QuickMessagePreview, UtilityPreview } from './MetaTemplates';
import { Dropdown, type KOption } from './Dropdown';
import { BladeSpinner } from './BladeSpinner';
import { Pager, usePaged } from './Pager';
import { TemplateSearchSvg, TemplateViewSvg } from './TemplateIcons';
import './MetaMessaging.css';
import './TemplateLibrary.css';

const SORT_OPTIONS: KOption[] = [
  { value: 'latest', label: 'Latest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name (A–Z)' },
];
const STATUS_TONE: Record<string, string> = { APPROVED: 'green', REJECTED: 'red', PAUSED: 'grey', DISABLED: 'grey', DELETED: 'grey' };
const titleCase = (s: string) => {
  const v = String(s || '').replace(/_/g, ' ').toLowerCase();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : '—';
};
const timeOf = (x: { updatedAt?: string | null; createdAt?: string | null }) => new Date(x.updatedAt || x.createdAt || 0).getTime() || 0;
const dateLabel = (x: { updatedAt?: string | null; createdAt?: string | null }) => {
  const ms = timeOf(x);
  return ms ? new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
};
const ICON: Record<MetaChannel, string> = { messenger: '/channel-messenger.svg', instagram: '/channel-instagram.svg' };

const SendIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M17.65 7.54L4.81 1.13C3.54 0.49 2.05 1.48 2.05 2.89L2 8.5L12 10L2 11.5L2.05 17.11C2.05 18.52 3.54 19.51 4.81 18.87L17.65 12.46C18.88 11.84 18.88 10.16 17.65 9.54V7.54Z" fill="currentColor" />
  </svg>
);

interface Props {
  api: CrmApi;
  channel: MetaChannel;
  onUse: (content: MetaCampaignInitialContent) => void;
  onNavigate?: (view: string) => void;
}

export function MetaChannelTemplateList({ api, channel, onUse, onNavigate }: Props) {
  const label = CHANNEL_LABEL[channel];
  const [quick, setQuick] = useState<QuickMessage[] | null>(null);
  const [utility, setUtility] = useState<UtilityTemplate[] | null>(null);
  const [conn, setConn] = useState<MetaChannelConnection | null | undefined>(undefined);
  const [sort, setSort] = useState('latest');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [preview, setPreview] = useState<{ kind: 'quick'; q: QuickMessage } | { kind: 'utility'; t: UtilityTemplate } | null>(null);

  useEffect(() => {
    setQuick(null);
    setUtility(null);
    api.getQuickMessages(channel).then((r) => setQuick(r.data || [])).catch(() => setQuick([]));
    api.getMetaChannels().then((r) => setConn(r.connections[channel])).catch(() => setConn(null));
    if (channel === 'messenger') api.getUtilityTemplates().then((r) => setUtility(r.data || [])).catch(() => setUtility([]));
    else setUtility([]);
  }, [api, channel]);

  const connected = conn?.status === 'connected';
  const sorter = <T extends { name: string; updatedAt?: string | null; createdAt?: string | null }>(a: T, b: T) => (
    sort === 'name' ? a.name.localeCompare(b.name) : sort === 'oldest' ? timeOf(a) - timeOf(b) : timeOf(b) - timeOf(a)
  );
  const q = query.trim().toLowerCase();
  const utilityRows = useMemo(() => (utility || [])
    .filter((t) => (status === 'ALL' || String(t.status).toUpperCase() === status) && (!q || t.name.toLowerCase().includes(q) || t.bodyText.toLowerCase().includes(q)))
    .sort(sorter), [utility, status, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const quickRows = useMemo(() => (quick || [])
    .filter((m) => !q || m.name.toLowerCase().includes(q) || m.text.toLowerCase().includes(q) || KIND_LABEL[m.kind].toLowerCase().includes(q))
    .sort(sorter), [quick, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const utilityPaged = usePaged(utilityRows, `${channel}|${q}|${status}|${sort}`, { key: 'campaign-utility', noun: ['template', 'templates'] });
  const quickPaged = usePaged(quickRows, `${channel}|${q}|${sort}`, { key: 'campaign-quick', noun: ['quick message', 'quick messages'] });

  const showUtility = channel === 'messenger' && (type === 'ALL' || type === 'UTILITY');
  const showQuick = type === 'ALL' || type === 'QUICK';
  const shownCount = (showUtility && connected ? utilityRows.length : 0) + (showQuick && status === 'ALL' ? quickRows.length : 0);
  const statusOptions: KOption[] = useMemo(() => [
    { value: 'ALL', label: 'All statuses' },
    ...[...new Set((utility || []).map((t) => String(t.status).toUpperCase()))].sort().map((s) => ({ value: s, label: titleCase(s) })),
  ], [utility]);
  const usable = (t: UtilityTemplate) => t.status === 'APPROVED' && t.onCurrentPage;

  return (
    <div className="co-library-container tl-body" data-testid={`co-tpl-list-${channel}`}>
      <div className="tl-toolbar">
        <div className="tl-sort">
          <span className="tl-toolbar-label">Sorted by:</span>
          <Dropdown size="sm" options={SORT_OPTIONS} value={sort} onChange={setSort} className="tl-dropdown" />
        </div>
        <div className="tl-search">
          <input className="k-input" type="search" placeholder="Search templates…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search templates" data-testid="co-tpl-search" />
          <span className="tl-search-icon" aria-hidden="true"><TemplateSearchSvg width={18} height={18} /></span>
        </div>
        {channel === 'messenger' && (
          <>
            <div className="tl-filter" data-testid="co-tpl-type">
              <span className="material-icons tl-filter-icon" aria-hidden="true">filter_list</span>
              <Dropdown
                size="sm"
                options={[{ value: 'ALL', label: 'All types' }, { value: 'UTILITY', label: 'Utility templates' }, { value: 'QUICK', label: 'Quick messages' }]}
                value={type}
                onChange={setType}
                className="tl-dropdown tl-filter-dropdown"
              />
            </div>
            <div className="tl-filter" data-testid="co-tpl-status">
              <Dropdown size="sm" options={statusOptions} value={status} onChange={setStatus} placeholder="All statuses" className="tl-dropdown" />
            </div>
          </>
        )}
      </div>

      <div className="co-library-subhead" style={{ margin: '4px 0 2px' }}>
        <span data-testid="co-tpl-count">Showing {shownCount} template{shownCount === 1 ? '' : 's'}</span>
      </div>

      {channel === 'instagram' && (
        <p className="mm-notice" data-testid="co-ig-note">
          <span className="material-icons">info</span>
          <span>Instagram has no Meta-approved templates. Campaigns send quick messages, only to contacts inside the 24-hour window.</span>
        </p>
      )}

      {showUtility && (
        <section className="co-tpl-section" data-testid="co-ut-section">
          <h4>Utility templates <span className="mm-badge">Approved by Meta</span> {connected && <span className="tlb-count">{utilityRows.length}</span>}</h4>
          {conn !== undefined && !connected ? (
            <div className="mm-connect" data-testid="co-ut-connect">
              <img src={ICON.messenger} alt="" />
              <div>
                <strong>{conn ? 'Messenger needs to be reconnected' : 'Connect Messenger first'}</strong>
                <p>Utility templates live on your Facebook Page. Connect it on Channel Status to create and send them.</p>
              </div>
              {onNavigate && <button type="button" className="k-btn" onClick={() => onNavigate('channel-status:messenger')} data-testid="co-ut-connect-btn">{conn ? 'Reconnect Messenger' : 'Connect Messenger'}</button>}
            </div>
          ) : (
            <div className="tl-table-wrap">
              <table className="tl-table" data-testid="co-ut-table">
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
                  {utility === null || conn === undefined ? (
                    <tr><td colSpan={6} className="tl-empty"><BladeSpinner center={true} containerHeight={80} /></td></tr>
                  ) : utilityRows.length === 0 ? (
                    <tr><td colSpan={6} className="tl-empty">{utility.length ? 'No templates match your search.' : 'No utility templates yet. Create one on the Templates page.'}</td></tr>
                  ) : utilityPaged.items.map((t) => {
                    const st = String(t.status || 'PENDING').toUpperCase();
                    return (
                      <tr key={t._id} data-ut-name={t.name}>
                        <td>
                          <button type="button" className="tl-name" onClick={() => setPreview({ kind: 'utility', t })}>{t.name}</button>
                          {t.origin === 'clone' && <span className="tl-kind">From Meta’s library</span>}
                          {!t.onCurrentPage && <span className="tl-kind">Other Page</span>}
                        </td>
                        <td>Utility</td>
                        <td className="c">
                          <span className={`tl-status ${STATUS_TONE[st] || 'amber'}`}>{titleCase(st)}</span>
                          {st === 'REJECTED' && t.rejectedReason && <span className="tl-reason" title={utilityReason(t.rejectedReason)}>{utilityReason(t.rejectedReason)}</span>}
                        </td>
                        <td>{languageLabel(t.language)}</td>
                        <td>{dateLabel(t)}</td>
                        <td className="c">
                          <div className="tl-actions" style={{ alignItems: 'center', justifyContent: 'center' }}>
                            <button type="button" className="tl-act" onClick={() => setPreview({ kind: 'utility', t })} title="Preview" aria-label={`Preview ${t.name}`}>
                              <TemplateViewSvg width={18} height={18} />
                            </button>
                            <button
                              type="button"
                              className="co-btn-start-camp-sm"
                              onClick={() => onUse({ utilityTemplateId: t._id })}
                              disabled={!usable(t)}
                              title={usable(t) ? `Use ${t.name} in a Messenger campaign` : t.onCurrentPage ? 'Only approved templates can be used in campaigns' : 'This template belongs to a Page that is no longer connected'}
                              data-testid="co-use-utility"
                            >
                              <SendIcon />
                              <span>Use in campaign</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {connected && <Pager {...utilityPaged.pager} />}
        </section>
      )}

      {showQuick && status === 'ALL' && (
        <section className="co-tpl-section" data-testid="co-qm-section">
          <h4>Quick messages <span className="tlb-count">{quickRows.length}</span></h4>
          <div className="tl-table-wrap">
            <table className="tl-table" data-testid="co-qm-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Last Updated</th>
                  <th scope="col" className="c">Actions</th>
                </tr>
              </thead>
              <tbody>
                {quick === null ? (
                  <tr><td colSpan={4} className="tl-empty"><BladeSpinner center={true} containerHeight={80} /></td></tr>
                ) : quickRows.length === 0 ? (
                  <tr><td colSpan={4} className="tl-empty">{quick.length ? 'No quick messages match your search.' : `No ${label} quick messages yet. Create one on the Templates page.`}</td></tr>
                ) : quickPaged.items.map((m) => (
                  <tr key={m._id} data-qm-id={m._id}>
                    <td><button type="button" className="tl-name" onClick={() => setPreview({ kind: 'quick', q: m })}>{m.name}</button></td>
                    <td>{KIND_LABEL[m.kind]}{m.kind === 'cards' && m.cards.length > 1 ? ` · carousel of ${m.cards.length}` : ''}</td>
                    <td>{dateLabel(m)}</td>
                    <td className="c">
                      <div className="tl-actions" style={{ alignItems: 'center', justifyContent: 'center' }}>
                        <button type="button" className="tl-act" onClick={() => setPreview({ kind: 'quick', q: m })} title="Preview" aria-label={`Preview ${m.name}`}>
                          <TemplateViewSvg width={18} height={18} />
                        </button>
                        <button type="button" className="co-btn-start-camp-sm" onClick={() => onUse({ quickMessageId: m._id })} title={`Use ${m.name} in a ${label} campaign`} data-testid="co-use-quick">
                          <SendIcon />
                          <span>Use in campaign</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager {...quickPaged.pager} />
        </section>
      )}

      {preview && (
        <Modal
          title={preview.kind === 'quick' ? preview.q.name : preview.t.name}
          onClose={() => setPreview(null)}
          testid="co-tpl-preview"
          footer={(
            <>
              <button type="button" className="k-btn ghost" onClick={() => setPreview(null)}>Close</button>
              <button
                type="button"
                className="k-btn"
                disabled={preview.kind === 'utility' && !usable(preview.t)}
                onClick={() => {
                  const p = preview;
                  setPreview(null);
                  onUse(p.kind === 'quick' ? { quickMessageId: p.q._id } : { utilityTemplateId: p.t._id });
                }}
                data-testid="co-tpl-preview-use"
              >
                Use in campaign
              </button>
            </>
          )}
        >
          {preview.kind === 'quick'
            ? <QuickMessagePreview qm={preview.q} channel={channel} />
            : <UtilityPreview bodyText={preview.t.bodyText} values={preview.t.bodyExamples} buttons={preview.t.buttons} />}
        </Modal>
      )}
    </div>
  );
}
