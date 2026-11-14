// Orders & bookings: fulfilment records with a status workflow. A filter
// toggles All / Orders / Bookings; each card shows items, total, customer and a
// status dropdown to advance the order.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type { Order, OrderStatus, Registration, RegistrationStatus } from '../types';
import type { VerticalConfig } from '../verticals';
import { verticalConfig } from '../verticals';
import { Dropdown, type KOption } from './Dropdown';
import { OrderDetailsPage } from './OrderDetailsPage';
import { useConfirm, useNotify } from './Dialogs';
import { CrmEmptyState } from './CrmEmptyState';
import { CrmPageHero } from './CrmPageHero';
import { OrdersRailSvg } from './NavRail';
import { ordersHero, submissionsHero } from '../emptyPages';
import { BladeSpinner } from './BladeSpinner';
import { Pager, usePaged } from './Pager';
import { WhatsAppConnectRequired } from './WhatsAppConnectRequired';
import { FormSubmissionDetails } from './FormSubmissionDetails';
import { WhatsAppIcon } from './AppIcons';
import { REG_STATUS, presetOf, submissionSummary } from '../formSubmission';
import type { FormPreset } from '../flowForms';
import type { BusinessProfile } from '../types';

interface Props {
  api: CrmApi;
  vertical?: VerticalConfig;
  business?: BusinessProfile;
  demo?: boolean;
  onConnected?: (b: BusinessProfile) => void;
  /** Jump to this customer's thread in the chat view. */
  onOpenChat?: (phone: string) => void;
  /**
   * Open this order's details, e.g. from a notification (`n` changes per
   * request). Without an id, the form submissions tab is shown instead.
   */
  focusRequest?: { id: string; n: number } | null;
  /** Go to another page (the empty page's button opens Automation). */
  onNavigate?: (view: 'flows') => void;
}

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

// A label for every status the backend can store, used as a fallback when the
// tenant's vertical doesn't list one (e.g. a clinic order left at 'preparing'
// from an earlier build) so the dropdown never renders a blank.
const GENERIC_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

// The lifecycle a status belongs to. "delivered" is the terminal success state
// every vertical shares (shown as "Completed"/"Delivered"/"Closed"); anything
// that isn't done or cancelled is still active.
type Lifecycle = 'active' | 'completed' | 'cancelled';
// The tab the user is on. "today" isn't a status — it's a view onto active
// records whose appointment falls on the current day.
type View = Lifecycle | 'today';
function lifecycleOf(status?: string): Lifecycle {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'delivered') return 'completed';
  return 'active';
}

// Local 'YYYY-MM-DD' for a date string/Date, in the viewer's zone.
function localDate(d?: string | Date): string {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function fmtWhen(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * How the customer chose to pay, as a short label: "Online", "COD" for a
 * shop, "Offline" (pay at the visit) for a booking. The raw button text a flow
 * captured varies by tenant ("Pay now", "Cash on delivery", "Pay at clinic"),
 * so it's matched loosely and kept as the tooltip.
 */
function payMethodOf(o: Order, catalog: boolean): { kind: 'online' | 'offline' | 'other' | 'none'; label: string } {
  const raw = String(o.paymentMethod || '').trim();
  // Paid through WhatsApp Pay without a recorded method: that's online.
  if (!raw) return o.paid ? { kind: 'online', label: 'Online' } : { kind: 'none', label: '—' };
  if (/online|upi|card|razorpay|pay ?now|whatsapp ?pay|net ?banking|wallet/i.test(raw)) {
    return { kind: 'online', label: 'Online' };
  }
  if (/\bcod\b|cash|offline|counter|visit|clinic|hotel|venue|later|store|on ?delivery/i.test(raw)) {
    return { kind: 'offline', label: catalog ? 'COD' : 'Offline' };
  }
  return { kind: 'other', label: raw };
}

export function OrdersPage({ api, vertical, business, demo, onConnected, onOpenChat, focusRequest, onNavigate }: Props) {
  const v = vertical || verticalConfig('other');

  if (!demo && business && !business.whatsappConnected) {
    return <WhatsAppConnectRequired page="orders" api={api} business={business} onConnected={onConnected} />;
  }

  const [orders, setOrders] = useState<Order[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'orders' | 'forms'>('orders');
  const [filter, setFilter] = useState<'all' | 'order' | 'booking'>('all');
  // Which stage of the lifecycle to show. Active hides finished and cancelled
  // records so the day-to-day list isn't buried under old ones.
  const [life, setLife] = useState<View>('active');
  // Free-text search (name / reference / phone), applied across every date and
  // lifecycle. A date filter narrows the current tab to one appointment day.
  const [query, setQuery] = useState('');
  const [apptDate, setApptDate] = useState('');
  // The order whose details page is open, if any.
  const [openId, setOpenId] = useState('');
  // The form submission whose details page is open (Form submissions tab).
  const [openRegId, setOpenRegId] = useState('');

  // Status options + labels follow the business type: a clinic sees
  // Pending / Confirmed / Completed / Cancelled, a shop the full delivery flow.
  const statusOptions = v.orderStatuses as KOption[];
  const labelOf = (status?: string) =>
    v.orderStatuses.find((s) => s.value === status)?.label
    || GENERIC_STATUS_LABEL[status as OrderStatus]
    || status
    || '';
  const statusLabelMap = useMemo(() => {
    const m = { ...GENERIC_STATUS_LABEL } as Record<string, string>;
    for (const s of v.orderStatuses) m[s.value] = s.label;
    return m as Record<OrderStatus, string>;
  }, [v]);
  // The options for one row: the vertical's set, plus the row's own status if
  // it isn't among them, so a legacy value still shows and can be changed.
  const optionsFor = (status?: string): KOption[] =>
    status && !v.orderStatuses.some((s) => s.value === status)
      ? [...statusOptions, { value: status, label: labelOf(status) }]
      : statusOptions;
  // What this vertical calls the terminal "done" state, used for the tab label
  // ("Completed" for a clinic, "Delivered" for a shop, "Closed" for a lead).
  const completedLabel = labelOf('delivered');

  // Enquiry and booking businesses always have the submissions tab. Every
  // other business (a shop, a clinic) gets it as soon as a form has been
  // submitted — the ready-made forms in the Flow builder are for everyone.
  const showForms = v.formsTab || registrations.length > 0;

  function load() {
    setLoading(true);
    Promise.all([
      api.getOrders().then((r) => r.data || []).catch(() => []),
      api.getRegistrations().then((r) => r.data || []).catch(() => []),
    ])
      .then(([o, r]) => {
        setOrders(o);
        setRegistrations(r);
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opened from a notification. Already on this page, the list is reloaded
  // so a just-created order is in it.
  const focusMounted = useRef(false);
  useEffect(() => {
    if (focusRequest) {
      if (focusRequest.id) {
        setTab('orders');
        setOpenId(focusRequest.id);
      } else if (showForms) {
        setOpenId('');
        setOpenRegId('');
        setTab('forms');
      }
      if (focusMounted.current) load();
    }
    focusMounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.n]);

  function changeStatus(o: Order, status: OrderStatus) {
    setOrders((list) => list.map((x) => (x._id === o._id ? { ...x, status } : x)));
    api.setOrderStatus(o._id, status).catch(load);
  }
  const regActions = useRegistrationActions({ api, setItems: setRegistrations, onChanged: load });

  // Narrow by kind first, so the lifecycle counts reflect what's actually in
  // view (a restaurant filtered to "Bookings" would otherwise count orders).
  const byKind = useMemo(
    () => (filter === 'all' ? orders : orders.filter((o) => o.kind === filter)),
    [orders, filter],
  );
  const todayISO = useMemo(() => localDate(new Date()), []);
  const apptISOof = (o: Order) => localDate(o.scheduledAt);
  const isToday = (o: Order) => apptISOof(o) === todayISO && o.status !== 'cancelled';

  const lifeCounts = useMemo(() => {
    const c: Record<View, number> = { active: 0, today: 0, completed: 0, cancelled: 0 };
    for (const o of byKind) {
      c[lifecycleOf(o.status)] += 1;
      if (isToday(o)) c.today += 1;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byKind, todayISO]);

  const q = query.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  const searching = q.length > 0;
  const matchesQuery = (o: Order) =>
    !searching
    || (o.reference || '').toLowerCase().includes(q)
    || (o.customerName || '').toLowerCase().includes(q)
    || (!!qDigits && (o.phone || '').includes(qDigits))
    || (o.items || []).some((it) => (it.name || '').toLowerCase().includes(q));

  const shown = useMemo(() => {
    let list: Order[];
    if (searching) {
      // Search spans every lifecycle and date.
      list = byKind.filter(matchesQuery);
    } else {
      list = byKind.filter((o) => (life === 'today' ? isToday(o) : lifecycleOf(o.status) === life));
      if (apptDate) list = list.filter((o) => apptISOof(o) === apptDate);
    }
    // Today / a chosen day / search read best in appointment-time order; the
    // plain lifecycle lists keep newest-placed-first (as loaded).
    if (life === 'today' || apptDate || searching) {
      return [...list].sort(
        (a, b) => (a.scheduledAt ? +new Date(a.scheduledAt) : Infinity)
          - (b.scheduledAt ? +new Date(b.scheduledAt) : Infinity),
      );
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byKind, life, apptDate, searching, q, todayISO]);
  const plural = v.ordersLabel.toLowerCase();
  const ordersPaged = usePaged(shown, `${filter}|${life}|${q}|${apptDate}`, { key: 'orders', noun: [plural.replace(/ies$/, 'y').replace(/s$/, ''), plural] });
  // Does this tenant actually have both? Catalog businesses only ever have
  // orders, so the kind filter would offer an empty tab.
  const mixedKinds = useMemo(
    () => new Set(orders.map((o) => o.kind || 'order')).size > 1,
    [orders],
  );

  // Columns follow the business type.
  //  - Shop / restaurant: no Items (a long cart would wreck the row; the
  //    details page lists it) and no Scheduled (orders aren't scheduled), but
  //    a Payment type column (Online / COD).
  //  - Bookings (clinic, salon, hotel…): keep Items and Appointment, plus a
  //    Payment method column (Online / Offline).
  // A shop that also takes bookings (a restaurant's table) still gets its
  // Appointment column.
  const isCatalog = v.archetype === 'catalog';
  const showItems = !isCatalog;
  const showSchedule = !isCatalog || orders.some((o) => o.kind === 'booking');
  const scheduleLabel = isCatalog ? 'Scheduled' : 'Appointment';
  const colsClass = `${isCatalog ? 'cat' : 'bk'}${showSchedule ? ' sched' : ''}`;

  // Read from `orders` rather than held in state, so a status change made on
  // the details page is reflected straight away.
  const open = openId ? orders.find((o) => o._id === openId) : null;
  if (open) {
    return (
      <OrderDetailsPage
        order={open}
        api={api}
        statusOptions={optionsFor(open.status)}
        statusLabel={statusLabelMap}
        customerLabel={v.customerLabel}
        slipTitle={v.archetype === 'person' ? 'Appointment slip' : v.archetype === 'lead' ? 'Enquiry slip' : 'Booking slip'}
        onBack={() => setOpenId('')}
        onStatusChange={changeStatus}
        onOpenChat={onOpenChat}
      />
    );
  }

  // A form submission's details page (Form submissions tab).
  const openReg = tab === 'forms' && openRegId ? registrations.find((r) => r._id === openRegId) : null;
  if (openReg) {
    return (
      <FormSubmissionDetails
        registration={openReg}
        preset={presetOf(openReg)}
        vertical={v}
        onBack={() => setOpenRegId('')}
        onStatusChange={regActions.changeStatus}
        onDelete={(r) => {
          regActions.remove(r).then((gone) => {
            if (gone) setOpenRegId('');
          });
        }}
        onOpenChat={onOpenChat}
      />
    );
  }

  const hasNoOrders = !loading && orders.length === 0 && !searching;

  return (
    <div className={`page${hasNoOrders ? ' ord-empty-bg' : ''}`}>
      {/* The top bar names the page ("Appointments", "Bookings"). The header
          holds the tabs and the search, so it's left out while there's
          neither to show. */}
      {(showForms || (tab !== 'forms' && orders.length > 0)) && (
      <header className="page-head">
        {/* With one tab there's nothing to switch between, so the toggle only
            appears for verticals that collect form submissions. */}
        {showForms && (
          <div className="flow-tabs ord-filter">
            <button className={`flow-tab${tab === 'orders' ? ' on' : ''}`} onClick={() => setTab('orders')}>
              {v.ordersLabel}
              {orders.length > 0 && <span className="ord-count">{orders.length}</span>}
            </button>
            <button className={`flow-tab${tab === 'forms' ? ' on' : ''}`} onClick={() => setTab('forms')}>
              Form submissions
              {registrations.length > 0 && <span className="ord-count">{registrations.length}</span>}
            </button>
          </div>
        )}
        {!showForms && <span className="page-head-fill" />}
        {tab !== 'forms' && orders.length > 0 && (
          <div className="ord-search">
            <span className="material-icons">search</span>
            <input
              className="ord-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${v.customerLabel.toLowerCase()}, ID or phone`}
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

      {showForms && tab === 'forms' ? (
        <RegistrationsList
          api={api}
          items={registrations}
          loading={loading}
          onChanged={load}
          setItems={setRegistrations}
          onOpen={(r) => setOpenRegId(r._id)}
          emptyHero={(
            <CrmPageHero
              icon="assignment"
              tone="purple"
              {...submissionsHero()}
              actionIcon="auto_awesome"
              onAction={onNavigate ? () => onNavigate('flows') : undefined}
              testId="submissions-hero"
            />
          )}
        />
      ) : (
      <div className="page-body">
        {loading && <BladeSpinner center={true} containerHeight={200} />}
        {/* Only worth showing when there's actually something to filter — a
            restaurant has orders and no bookings, so an empty Bookings tab is
            just a dead end. */}
        {!loading && mixedKinds && (
          <div className="flow-tabs ord-filter inline">
            {(['all', 'order', 'booking'] as const).map((f) => (
              <button key={f} className={`flow-tab${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'order' ? 'Orders' : 'Bookings'}
              </button>
            ))}
          </div>
        )}
        {/* Lifecycle tabs. Active is the working list; finished and cancelled
            records move out of it but stay one tap away. */}
        {!loading && !searching && orders.length > 0 && (
          <div className="ord-toolbar">
            <div className="ord-life-tabs">
              {(['active', 'today', 'completed', 'cancelled'] as const).map((l) => (
                <button
                  key={l}
                  className={`ord-life-tab${life === l ? ' on' : ''} ${l}`}
                  onClick={() => setLife(l)}
                >
                  {l === 'active' ? 'Active' : l === 'today' ? 'Today' : l === 'completed' ? completedLabel : 'Cancelled'}
                  {lifeCounts[l] > 0 && <span className="ord-count">{lifeCounts[l]}</span>}
                </button>
              ))}
            </div>
            <div className="ord-datefilter">
              <span className="material-icons">event</span>
              <input
                type="date"
                value={apptDate}
                onChange={(e) => setApptDate(e.target.value)}
                aria-label="Filter by appointment date"
              />
              {apptDate && (
                <button type="button" className="ord-date-clear" onClick={() => setApptDate('')} aria-label="Clear date filter">
                  <span className="material-icons">close</span>
                </button>
              )}
            </div>
          </div>
        )}
        {!loading && searching && (
          <div className="ord-search-note">
            Showing results for “{query}” across all {v.ordersLabel.toLowerCase()}.
            <button type="button" onClick={() => setQuery('')}>Clear search</button>
          </div>
        )}
        {!loading && orders.length === 0 && !searching && !apptDate && (
          <CrmPageHero
            icon={<OrdersRailSvg />}
            tone="green"
            {...ordersHero(v)}
            actionIcon="auto_awesome"
            onAction={onNavigate ? () => onNavigate('flows') : undefined}
            testId="orders-hero"
          />
        )}
        {!loading && shown.length === 0 && !(orders.length === 0 && !searching && !apptDate) && (
          <CrmEmptyState
            icon={searching ? 'search_off' : 'receipt_long'}
            iconTone={searching ? 'slate' : 'primary'}
            title={
              searching
                ? `No ${v.ordersLabel.toLowerCase()} match “${query}”`
                : apptDate
                  ? `No ${v.ordersLabel.toLowerCase()} on ${apptDate}`
                  : life === 'today'
                    ? `No ${v.ordersLabel.toLowerCase()} today`
                    : life === 'active'
                      ? `No active ${v.ordersLabel.toLowerCase()} right now`
                      : life === 'completed'
                        ? `No ${completedLabel.toLowerCase()} ${v.ordersLabel.toLowerCase()} yet`
                        : `No cancelled ${v.ordersLabel.toLowerCase()}`
            }
            description={
              searching
                ? 'Try checking for typos or searching by customer name, phone number, or reference.'
                : orders.length === 0
                  ? `When customers place ${v.ordersLabel.toLowerCase()} or complete booking flows on WhatsApp, they will appear here with live tracking and status updates.`
                  : `There are currently no ${life === 'today' ? "appointments or orders scheduled for today" : `${life} records`} to display in this view.`
            }
            actionLabel={searching ? 'Clear search' : apptDate ? 'Clear date filter' : undefined}
            actionIcon={searching ? 'clear' : apptDate ? 'close' : undefined}
            onAction={searching ? () => setQuery('') : apptDate ? () => setApptDate('') : undefined}
          />
        )}
        {shown.length > 0 && (
          <div className={`ord-list cols-${colsClass.replace(' ', ' cols-')}`}>
            {/* Column captions are decoration: each row states its own values,
                and the row button carries a full description. */}
            <div className="ord-row head" aria-hidden="true">
              <span>Reference</span>
              <span>{v.customerLabel}</span>
              {showItems && <span className="h-items">Items</span>}
              <span className="num">Total</span>
              <span>{isCatalog ? 'Payment type' : 'Payment method'}</span>
              <span>Payment</span>
              {showSchedule && <span className="h-sched">{scheduleLabel}</span>}
              <span>Status</span>
              <span className="h-when">Placed</span>
              <span />
            </div>

            {ordersPaged.items.map((o) => {
              const lines = o.items || [];
              const units = lines.reduce((n, it) => n + (Number(it.qty) || 1), 0);
              const pm = payMethodOf(o, isCatalog);
              return (
                <div className={`ord-row st-${o.status}`} key={o._id}>
                  {/* Covers the row so anywhere is clickable, and is a real
                      button so it's tab-reachable. The status dropdown sits
                      above it and keeps its own clicks. */}
                  <button
                    type="button"
                    className="ord-row-open"
                    onClick={() => setOpenId(o._id)}
                    aria-label={`Open ${o.reference || 'order'} for ${o.customerName || o.phone}, ${money(o.total)}`}
                  />
                  <span className="ord-cell ref">
                    <span className="material-icons">{o.kind === 'booking' ? 'event' : 'receipt_long'}</span>
                    <span className="ord-ref-text">{o.reference || '—'}</span>
                  </span>

                  <span className="ord-cell cust">
                    <span className="ord-cust-name">{o.customerName || 'Unnamed'}</span>
                    <span className="ord-cust-phone">+{o.phone}</span>
                  </span>

                  {showItems && (
                    <span className="ord-cell items">
                      {lines.length === 0 ? (
                        <em>none</em>
                      ) : (
                        <>
                          <span className="ord-items-first">{lines[0].qty}× {lines[0].name}</span>
                          {lines.length > 1 && <span className="ord-items-more">+{lines.length - 1} more</span>}
                          {lines.length === 1 && units > 1 && <span className="ord-items-more">{units} units</span>}
                        </>
                      )}
                    </span>
                  )}

                  <span className="ord-cell num total">{money(o.total)}</span>

                  <span className="ord-cell method">
                    {pm.kind === 'none' ? (
                      <span className="ord-muted">—</span>
                    ) : (
                      <span className={`ord-method ${pm.kind}`} title={o.paymentMethod || pm.label}>
                        <span className="material-icons" aria-hidden="true">
                          {pm.kind === 'online' ? 'credit_card' : pm.kind === 'offline' ? 'payments' : 'account_balance_wallet'}
                        </span>
                        {pm.label}
                      </span>
                    )}
                  </span>

                  <span className="ord-cell pay">
                    <span className={`ord-pay ${o.paid ? 'paid' : 'unpaid'}`}>
                      {o.paid ? 'Paid' : 'Not paid'}
                    </span>
                  </span>

                  {showSchedule && (
                    <span className="ord-cell sched">
                      {o.scheduledAt ? fmtWhen(o.scheduledAt) : '—'}
                    </span>
                  )}

                  <span className="ord-cell status">
                    <div className="ord-status-sel">
                      <Dropdown
                        options={optionsFor(o.status)}
                        value={o.status}
                        onChange={(val) => changeStatus(o, val as OrderStatus)}
                      />
                    </div>
                  </span>

                  <span className="ord-cell when">
                    {fmtWhen(o.createdAt)}
                    {o.deliveryAddress && (
                      <span className="ord-has-loc" title={o.deliveryAddress}>
                        <span className="material-icons">location_on</span>
                      </span>
                    )}
                  </span>

                  <span className="ord-cell chev">
                    <span className="material-icons">chevron_right</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {!loading && shown.length > 0 && <Pager {...ordersPaged.pager} />}
      </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form submissions — whatever fields the tenant put on the flow's screens.
// The list keeps every submission on one line (contact, a short summary of
// the answers, status, when); the whole row opens the submission's details
// page (FormSubmissionDetails), where every answer is drawn in full.
// ---------------------------------------------------------------------------
export { REG_STATUS };

/** Change a submission's status, or delete it (after asking). */
export function useRegistrationActions({
  api,
  setItems,
  onChanged,
}: {
  api: CrmApi;
  setItems: (f: (list: Registration[]) => Registration[]) => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const notify = useNotify();
  function changeStatus(r: Registration, status: RegistrationStatus) {
    setItems((list) => list.map((x) => (x._id === r._id ? { ...x, status } : x)));
    api.setRegistrationStatus(r._id, status).catch(onChanged);
  }
  /** Resolves true once the submission is gone from the list. */
  async function remove(r: Registration): Promise<boolean> {
    const who = r.name || (r.phone ? `+${r.phone}` : 'this contact');
    const ok = await confirm({
      title: 'Delete submission?',
      message: `The form submission from ${who} will be deleted.`,
      confirmLabel: 'Delete submission',
    });
    if (!ok) return false;
    setItems((list) => list.filter((x) => x._id !== r._id));
    try {
      await api.deleteRegistration(r._id);
      notify('success', 'Submission deleted', `The entry from ${who} was removed.`);
    } catch (e) {
      notify('error', 'Delete failed', e instanceof Error ? e.message : 'Could not delete the submission.');
      onChanged(); // put the list back the way the server has it
    }
    return true;
  }
  return { changeStatus, remove };
}

export function RegistrationsList({
  api,
  items,
  loading,
  onChanged,
  setItems,
  empty,
  onOpenChat,
  onOpen,
  presetFor = presetOf,
  pagerKey = 'form-submissions',
  emptyHero,
}: {
  api: CrmApi;
  items: Registration[];
  loading: boolean;
  onChanged: () => void;
  setItems: (f: (list: Registration[]) => Registration[]) => void;
  /** What to say when there's nothing to list (a form page names its form). */
  empty?: { icon?: string; title: string; description: string };
  /** A chat button on each row, to reply to the customer. */
  onOpenChat?: (phone: string) => void;
  /** Open a submission's details page (the whole row is the button). */
  onOpen?: (r: Registration) => void;
  /** The ready-made form a submission came from, for its summary's order. */
  presetFor?: (r: Registration) => FormPreset | null;
  /** Where the page size is remembered. */
  pagerKey?: string;
  /** Shown instead of the plain empty state when there's nothing at all. */
  emptyHero?: ReactNode;
}) {
  const { changeStatus, remove } = useRegistrationActions({ api, setItems, onChanged });
  // Narrow to one form ("Patient registration") when several are in use.
  const [formFilter, setFormFilter] = useState('');
  const formNames = useMemo(
    () => [...new Set(items.map((r) => r.flowName || 'Form'))].sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const shown = useMemo(
    () => (formFilter ? items.filter((r) => (r.flowName || 'Form') === formFilter) : items),
    [items, formFilter],
  );
  const paged = usePaged(shown, formFilter, { key: pagerKey, noun: ['submission', 'submissions'] });

  return (
    <div className="page-body">
      {loading && (
        <div className="ord-list reg-list reg-skeleton" aria-busy="true" aria-label="Loading submissions">
          <div className="ord-row reg-row-grid head" aria-hidden="true">
            <span>Contact</span>
            <span>Summary</span>
            <span>Status</span>
            <span className="h-when">Received</span>
            <span />
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div className="ord-row reg-row-grid reg-skel-row" key={i} aria-hidden="true">
              <span className="ord-cell reg-contact">
                <span className="reg-skel-avatar" />
                <span className="reg-contact-text">
                  <span className="reg-skel-bar w-name" />
                  <span className="reg-skel-bar w-phone" />
                </span>
              </span>
              <span className="ord-cell reg-summary">
                <span className="reg-skel-pill w-1" />
                <span className="reg-skel-pill w-2" />
                <span className="reg-skel-pill w-3" />
              </span>
              <span className="ord-cell">
                <span className="reg-skel-status" />
              </span>
              <span className="ord-cell when">
                <span className="reg-skel-bar w-date" />
              </span>
              <span className="ord-cell reg-acts">
                <span className="reg-skel-ico" />
                <span className="reg-skel-ico" />
              </span>
            </div>
          ))}
        </div>
      )}
      {!loading && items.length === 0 && emptyHero}
      {!loading && items.length === 0 && !emptyHero && (
        <CrmEmptyState
          icon={empty?.icon || 'assignment'}
          iconTone="purple"
          title={empty?.title || 'No form submissions yet'}
          description={empty?.description || 'Add a form to a WhatsApp flow (Automation → Flows → Build → Forms). When customers fill it in on WhatsApp, their answers land here.'}
        />
      )}
      {!loading && formNames.length > 1 && (
        <div className="reg-form-filter" data-testid="reg-form-filter">
          <Dropdown
            options={[{ value: '', label: `All forms (${items.length})` }, ...formNames.map((n) => ({
              value: n,
              label: `${n} (${items.filter((r) => (r.flowName || 'Form') === n).length})`,
            }))]}
            value={formFilter}
            onChange={setFormFilter}
          />
        </div>
      )}
      {!loading && items.length > 0 && (
        <div className={`ord-list reg-list${onOpenChat ? ' reg-chat' : ''}`}>
          <div className="ord-row reg-row-grid head" aria-hidden="true">
            <span>Contact</span>
            <span>Summary</span>
            <span>Status</span>
            <span className="h-when">Received</span>
            <span className="h-acts">Actions</span>
          </div>

          {paged.items.map((r) => {
            const who = r.name || (r.phone ? `+${r.phone}` : 'Unknown');
            const initials = (r.name || r.phone || '?').replace(/^\+/, '').slice(0, 2).toUpperCase();
            const { text, items: summaryItems, extra, files } = submissionSummary(r, presetFor(r));
            return (
              <div
                className={`ord-row reg-row-grid reg-${r.status}${onOpen ? ' reg-open' : ''}`}
                key={r._id}
                data-testid="reg-row"
              >
                {/* The row's button sits under the cells; the status dropdown
                    and the chat / delete buttons sit above it. */}
                {onOpen && (
                  <button
                    type="button"
                    className="ord-row-open"
                    onClick={() => onOpen(r)}
                    aria-label={`Open the submission from ${who}`}
                    data-testid="reg-row-open"
                  />
                )}
                <span className="ord-cell reg-contact">
                  <span className={`reg-avatar reg-av-${r.status}`} aria-hidden="true">{initials}</span>
                  <span className="reg-contact-text">
                    <span className="ord-cust-name">{who}</span>
                    {r.name && r.phone && <span className="ord-cust-phone">+{r.phone}</span>}
                  </span>
                </span>

                <span className="ord-cell reg-summary" title={text}>
                  {summaryItems.length > 0 ? (
                    <span className="reg-kv-strip">
                      {summaryItems.map((it, idx) => (
                        <span className="reg-kv" key={`${it.label}-${idx}`}>
                          <span className="reg-kv-k">{it.label}</span>
                          <span className="reg-kv-v">{it.value}</span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    !files && <em className="reg-none">No details</em>
                  )}
                  {extra > 0 && (
                    <span className="reg-more" title={`${extra} more ${extra === 1 ? 'answer' : 'answers'}`}>
                      +{extra}
                    </span>
                  )}
                  {files > 0 && (
                    <span className="reg-files" title={`${files} ${files === 1 ? 'attachment' : 'attachments'}`}>
                      <span className="material-icons">attach_file</span>
                      {files}
                    </span>
                  )}
                </span>

                <span className="ord-cell status">
                  <div className="ord-status-sel">
                    <Dropdown
                      options={REG_STATUS}
                      value={r.status}
                      onChange={(v) => changeStatus(r, v as RegistrationStatus)}
                    />
                  </div>
                </span>

                <span className="ord-cell when">{fmtWhen(r.createdAt)}</span>

                <span className="ord-cell status reg-acts">
                  {onOpenChat && r.phone && (
                    <button
                      type="button"
                      className="prod-act reg-wa-act"
                      onClick={() => onOpenChat(r.phone || '')}
                      title="Chat on WhatsApp"
                      aria-label={`Chat with ${who} on WhatsApp`}
                      data-testid="reg-open-chat"
                    >
                      <WhatsAppIcon size={17} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="prod-act danger"
                    onClick={() => remove(r)}
                    title="Delete submission"
                    aria-label={`Delete submission from ${who}`}
                  >
                    <span className="material-icons">delete_outline</span>
                  </button>
                  {onOpen && (
                    <span className="reg-row-chev" aria-hidden="true">
                      <span className="material-icons">chevron_right</span>
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {!loading && shown.length > 0 && <Pager {...paged.pager} />}
    </div>
  );
}
