// One ready-made form's answers on a page of its own ("Pickup requests",
// "Delivery issues"), opened from the Forms section of the sidebar. The
// submissions are the same records as Orders → Form submissions, narrowed to
// the form they came from (flowForms.ts presetOfSubmission).
import { useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type { Registration, RegistrationStatus, WaFlowDef } from '../types';
import { OTHER_FORMS, presetOfSubmission, type FormPage } from '../flowForms';
import { REG_STATUS, RegistrationsList } from './OrdersPage';
import { CrmPageHero } from './CrmPageHero';
import { formPageHero } from '../emptyPages';

interface Props {
  api: CrmApi;
  page: FormPage;
  onOpenChat?: (phone: string) => void;
  /** Go to Automation, to put the form in a flow. */
  onOpenFlows?: () => void;
  /** Something changed (a status, a deletion): the sidebar re-reads its forms. */
  onChanged?: () => void;
}

type StatusFilter = '' | RegistrationStatus;

/** Everything a submission says, lower-cased, for the search box. */
function searchText(r: Registration): string {
  const parts = [r.name, r.phone, r.email, r.flowName, r.category, r.memberName];
  for (const row of r.rows || []) parts.push(row.label, row.value);
  for (const v of Object.values(r.fields || {})) if (typeof v === 'string' || typeof v === 'number') parts.push(String(v));
  return parts.filter(Boolean).join(' ').toLowerCase();
}

export function FormSubmissionsPage({ api, page, onOpenChat, onOpenFlows, onChanged }: Props) {
  const [all, setAll] = useState<Registration[]>([]);
  const [flows, setFlows] = useState<WaFlowDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusFilter>('');
  const [query, setQuery] = useState('');

  function load() {
    setLoading(true);
    Promise.all([
      api.getRegistrations().then((r) => r.data || []).catch(() => [] as Registration[]),
      api.listFlows().then((r) => r.data || []).catch(() => [] as WaFlowDef[]),
    ])
      .then(([regs, fl]) => {
        setAll(regs);
        setFlows(fl);
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    setStatus('');
    setQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  const flowsById = useMemo(() => new Map(flows.map((f) => [f._id, f])), [flows]);
  // This form's submissions ("Other forms": those that came from no ready-made form).
  const mine = useMemo(
    () => all.filter((r) => {
      const id = presetOfSubmission(r, flowsById);
      return page.id === OTHER_FORMS ? !id : id === page.id;
    }),
    [all, flowsById, page.id],
  );
  // The flows this form is in, to say where its answers come from.
  const usedIn = useMemo(
    () => (page.preset
      ? flows.filter((f) => (f.screens || []).some((s) => (s.components || []).some((c) => c.preset === page.id))).map((f) => f.name)
      : []),
    [flows, page],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of mine) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [mine]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => mine.filter((r) => (!status || r.status === status) && (!q || searchText(r).includes(q))),
    [mine, status, q],
  );

  // Edits in the list apply to the full set, so the counts follow.
  const setItems = (f: (list: Registration[]) => Registration[]) => {
    setAll((list) => {
      const ids = new Set(mine.map((r) => r._id));
      const before = list.filter((r) => ids.has(r._id));
      const after = f(before);
      const byId = new Map(after.map((r) => [r._id, r]));
      return list.filter((r) => !ids.has(r._id) || byId.has(r._id)).map((r) => byId.get(r._id) || r);
    });
    onChanged?.();
  };

  const formName = page.preset?.title || 'form';
  const filtered = mine.length > 0 && shown.length === 0;
  // Nothing at all yet: the page hero, with Automation one tap away when the
  // form isn't in a flow.
  const hero = formPageHero(page.label, page.preset?.title || null, usedIn);
  const heroAction = !page.preset || !usedIn.length ? onOpenFlows : undefined;
  const emptyHero = (
    <CrmPageHero
      icon={page.icon}
      tone="purple"
      {...hero}
      actionLabel={heroAction ? hero.actionLabel : undefined}
      actionIcon="auto_awesome"
      onAction={heroAction}
      testId="form-page-hero"
    />
  );
  const empty = filtered
    ? { icon: 'search_off', title: 'Nothing matches', description: 'Try another status or clear the search.' }
    : page.preset
      ? {
          icon: page.icon,
          title: `No ${page.label.toLowerCase()} yet`,
          description: usedIn.length
            ? `When customers send the “${formName}” form on WhatsApp, their answers appear here.`
            : `Add the “${formName}” form to a WhatsApp flow (Automation → Flows → Build → Forms). When customers send it, their answers appear here.`,
        }
      : {
          icon: 'assignment',
          title: 'No other submissions',
          description: 'Answers from forms you built yourself, field by field, appear here.',
        };

  return (
    <div className="page form-page" data-testid="form-page" data-form={page.id}>
      {/* The top bar names the page. Its status tabs and search appear once
          answers have come in; until then the page shows how to start. */}
      {mine.length > 0 && (
        <header className="page-head">
          <span className="page-head-fill" />
          {mine.length > 0 && (
            <div className="flow-tabs ord-filter" data-testid="form-status-tabs">
              {[{ value: '', label: 'All' }, ...REG_STATUS].map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={`flow-tab${status === s.value ? ' on' : ''}`}
                  onClick={() => setStatus(s.value as StatusFilter)}
                  data-status={s.value || 'all'}
                >
                  {s.label}
                  {(s.value ? counts[s.value] : mine.length) > 0 && (
                    <span className="ord-count">{s.value ? counts[s.value] : mine.length}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {mine.length > 0 && (
            <div className="ord-search">
              <span className="material-icons">search</span>
              <input
                className="ord-search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, phone or answer"
                data-testid="form-search"
              />
              {query && (
                <button type="button" className="ord-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                  <span className="material-icons">close</span>
                </button>
              )}
            </div>
          )}
        </header>
      )}

      <RegistrationsList
        api={api}
        items={shown}
        loading={loading}
        onChanged={() => {
          load();
          onChanged?.();
        }}
        setItems={setItems}
        empty={empty}
        emptyHero={mine.length === 0 ? emptyHero : undefined}
        onOpenChat={onOpenChat}
        pagerKey={`form-page-${page.id}`}
      />
    </div>
  );
}
