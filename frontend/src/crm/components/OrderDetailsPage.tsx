// Full-page view of one order: what was ordered, what it costs, how the
// customer is paying, and where it's going.
//
// The map is an OpenStreetMap embed rather than Google Maps. Google's Maps
// JavaScript and Embed APIs both require a billable API key, which every tenant
// would have to supply before a delivery address was visible; OSM's embed is
// keyless, documented, and pans/zooms on its own. Google still gets used for
// the two deep links, since that's what a rider will have on their phone.
import { DownloadIcon, WhatsAppIcon } from './AppIcons';
import { useEffect, useState } from 'react';
import type { CrmApi } from '../api';
import type { Order, OrderStatus } from '../types';
import { Dropdown, type KOption } from './Dropdown';
import { useBackHandler } from '../useBackHandler';

interface Props {
  order: Order;
  api: CrmApi;
  statusOptions: KOption[];
  statusLabel: Record<OrderStatus, string>;
  /** What this business calls the customer: Customer / Patient / Guest / Client. */
  customerLabel?: string;
  /** The heading over a booking's PDF: "Appointment slip" / "Booking slip". */
  slipTitle?: string;
  onBack: () => void;
  onStatusChange: (o: Order, status: OrderStatus) => void;
  /** Open this customer's thread in the CRM's own chat view. */
  onOpenChat?: (phone: string) => void;
}

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const fmtWhen = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

/** A small window around the pin — roughly a few streets at this latitude. */
function osmEmbed(lat: number, lng: number): string {
  const d = 0.0045;
  const bbox = [lng - d, lat - d, lng + d, lat + d].map((n) => n.toFixed(6)).join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

const COORDS = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/;

/**
 * The pin to draw, from whichever field has it.
 *
 * `locationLat`/`locationLng` are the proper home, but orders confirmed before
 * those existed only kept the maps link, and the address field falls back to
 * the raw coordinates. Reading all three means the page never claims "no
 * location shared" while simultaneously offering to open the shared pin.
 */
function pinOf(o: Order): { lat: number; lng: number } | null {
  if (Number.isFinite(o.locationLat) && Number.isFinite(o.locationLng)) {
    return { lat: Number(o.locationLat), lng: Number(o.locationLng) };
  }
  for (const source of [o.locationUrl, o.deliveryAddress]) {
    const m = String(source || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

export function OrderDetailsPage({
  order: o,
  api,
  statusOptions,
  statusLabel,
  customerLabel = 'Customer',
  slipTitle = 'Appointment slip',
  onBack,
  onStatusChange,
  onOpenChat,
}: Props) {
  useBackHandler(true, onBack);
  const items = o.items || [];
  const units = items.reduce((n, it) => n + (Number(it.qty) || 1), 0);
  const subtotal = items.reduce((n, it) => n + Number(it.price || 0) * Number(it.qty || 1), 0);
  const delivery = Number(o.deliveryFee) || 0;
  const pin = pinOf(o);
  // A booking is an appointment, not a delivery: it has no delivery leg and no
  // address, so those sections are dropped and the confirmation slip (PDF) is
  // shown in their place.
  const isBooking = o.kind === 'booking';

  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfErr, setPdfErr] = useState('');
  useEffect(() => {
    if (!isBooking) return undefined;
    let active = true;
    let url = '';
    setPdfUrl('');
    setPdfErr('');
    api.getOrderPdfUrl(o._id)
      .then((u) => {
        if (!active) { URL.revokeObjectURL(u); return; }
        url = u;
        setPdfUrl(u);
      })
      .catch((e) => { if (active) setPdfErr(e?.message || 'Could not load the document.'); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [o._id, isBooking, api]);
  // WhatsApp only sends a street address when the customer picks a saved place.
  // Drop a pin instead and the address falls back to the coordinates, which the
  // map and the readout below it already show — so don't print them twice.
  const address = COORDS.test((o.deliveryAddress || '').trim()) ? '' : o.deliveryAddress || '';

  return (
    <div className="page od-page">
      <header className="page-head od-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back to orders">
          <span className="material-icons">arrow_back</span>
        </button>
        <div className="od-head-ttl">
          <h2>{o.reference || 'Order'}</h2>
          <span className="od-kind">{o.kind === 'booking' ? 'Booking' : 'Order'}</span>
        </div>
        {/* The dropdown already shows the current status, so there's no separate
            badge repeating it next to itself. */}
        <div className="od-head-status">
          <span className="od-head-status-lbl">Status</span>
          <div className="ord-status-sel">
            <Dropdown
              options={statusOptions}
              value={o.status}
              onChange={(v) => onStatusChange(o, v as OrderStatus)}
            />
          </div>
        </div>
      </header>

      <div className="page-body od-body">
        {/* The numbers worth seeing before reading anything else. */}
        <div className="od-strip">
          <div className="od-stat total">
            <span className="od-stat-lbl">Total payable</span>
            <span className="od-stat-val">{money(o.total)}</span>
          </div>
          <div className="od-stat">
            <span className="od-stat-lbl">Status</span>
            <span className={`ord-badge st-${o.status}`}>{statusLabel[o.status]}</span>
          </div>
          <div className="od-stat">
            <span className="od-stat-lbl">Payment</span>
            <span className="od-stat-val sm">
              {o.paymentMethod || '—'}
              <span className={`od-paid${o.paid ? ' yes' : ''}`}>{o.paid ? 'Paid' : 'Not paid'}</span>
            </span>
          </div>
          <div className="od-stat">
            <span className="od-stat-lbl">Items</span>
            <span className="od-stat-val sm">
              {units} {units === 1 ? 'unit' : 'units'}
              <span className="od-stat-sub">
                {items.length} {items.length === 1 ? 'line' : 'lines'}
              </span>
            </span>
          </div>
          <div className="od-stat">
            <span className="od-stat-lbl">Placed</span>
            <span className="od-stat-val sm">{fmtWhen(o.createdAt) || '—'}</span>
          </div>
        </div>

        <div className="od-cols">
          {/* ---------- left: the order itself ---------- */}
          <div className="od-main">
            <section className="od-card">
              <div className="od-card-head">
                <span className="material-icons">receipt_long</span>
                Items
              </div>

              {items.length === 0 ? (
                <div className="od-empty">No line items recorded.</div>
              ) : (
                <div className="od-lines">
                  <div className="od-line od-line-head" aria-hidden="true">
                    <span>Qty</span>
                    <span>Item</span>
                    <span className="num">Unit price</span>
                    <span className="num">Amount</span>
                  </div>
                  {items.map((it, i) => (
                    <div className="od-line" key={i}>
                      <span className="od-line-qty">{it.qty}×</span>
                      <span className="od-line-name">{it.name}</span>
                      <span className="od-line-each num">{money(it.price)}</span>
                      <span className="od-line-amt num">
                        {money(Number(it.price || 0) * Number(it.qty || 1))}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="od-totals">
                <div className="od-total-row">
                  <span>Items</span>
                  <span>{money(subtotal)}</span>
                </div>
                {/* Bookings have no delivery leg, so the line is dropped. */}
                {!isBooking && (
                  <div className="od-total-row">
                    <span>Delivery</span>
                    <span>{delivery > 0 ? money(delivery) : 'Free'}</span>
                  </div>
                )}
                <div className="od-total-row grand">
                  <span>Total</span>
                  <span>{money(o.total)}</span>
                </div>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-head">
                <span className="material-icons">person</span>
                {customerLabel}
              </div>

              <div className="od-cust">
                <div className="od-avatar" aria-hidden="true">
                  {(o.customerName || o.phone || '?').slice(0, 2).toUpperCase()}
                </div>
                <div className="od-cust-id">
                  <div className="od-cust-name">
                    {o.customerName || <span className="od-muted">Name not captured</span>}
                  </div>
                  <div className="od-cust-phone">+{o.phone}</div>
                </div>
                {/* Opens the thread inside the CRM rather than handing the agent
                    off to WhatsApp Web, so replies stay logged against the chat. */}
                {onOpenChat && o.phone && (
                  <button className="fsd-wa-btn" onClick={() => onOpenChat(o.phone)}>
                    <WhatsAppIcon size={16} />
                    <span>WhatsApp chat</span>
                  </button>
                )}
              </div>

              <dl className="od-facts">
                {!!o.category && (
                  <>
                    <dt>Category</dt>
                    <dd>{o.category}</dd>
                  </>
                )}
                <dt>Paying by</dt>
                <dd>
                  {o.paymentMethod || <span className="od-muted">not captured</span>}
                  <span className={`od-paid${o.paid ? ' yes' : ''}`}>{o.paid ? 'Paid' : 'Not paid'}</span>
                </dd>
                <dt>Placed</dt>
                <dd>{fmtWhen(o.createdAt) || '—'}</dd>
                {!!o.scheduledAt && (
                  <>
                    <dt>Scheduled</dt>
                    <dd>{fmtWhen(o.scheduledAt)}</dd>
                  </>
                )}
                {!!o.cancelledAt && (
                  <>
                    <dt>Cancelled</dt>
                    <dd>{fmtWhen(o.cancelledAt)}</dd>
                  </>
                )}
              </dl>
            </section>
          </div>

          {/* ---------- right: the confirmation slip (bookings) or the
              delivery location (orders) ---------- */}
          <div className="od-side">
            {isBooking ? (
              <section className="od-card od-doc">
                <div className="od-card-head">
                  <span className="material-icons">picture_as_pdf</span>
                  {slipTitle}
                </div>
                {pdfErr ? (
                  <div className="od-empty">{pdfErr}</div>
                ) : pdfUrl ? (
                  <>
                    <iframe
                      className="od-pdf"
                      title={`${slipTitle} for ${o.reference || 'this booking'}`}
                      src={pdfUrl}
                    />
                    <div className="od-map-foot">
                      <a className="k-btn ghost sm" href={pdfUrl} download={`${o.reference || 'appointment'}.pdf`}>
                        <DownloadIcon />
                        Download
                      </a>
                      <a className="k-btn ghost sm" href={pdfUrl} target="_blank" rel="noreferrer">
                        <span className="material-icons">open_in_new</span>
                        Open
                      </a>
                    </div>
                  </>
                ) : (
                  <div className="od-empty">Preparing document…</div>
                )}
              </section>
            ) : (
            <section className="od-card od-loc">
              <div className="od-card-head">
                <span className="material-icons">location_on</span>
                Delivery location
              </div>

              {address && <div className="od-address">{address}</div>}
              {!address && !!pin && (
                <div className="od-address muted">
                  Pin dropped by the customer — no street address shared.
                </div>
              )}

              {pin ? (
                <>
                  <iframe
                    className="od-map"
                    title={`Map of the delivery location for ${o.reference || 'this order'}`}
                    src={osmEmbed(pin.lat, pin.lng)}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                  <div className="od-coords">
                    <span className="material-icons">my_location</span>
                    {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
                  </div>
                  <div className="od-map-foot">
                    <a
                      className="k-btn ghost sm"
                      href={`https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="material-icons">directions</span>
                      Directions
                    </a>
                    <a
                      className="k-btn ghost sm"
                      href={o.locationUrl || `https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="material-icons">open_in_new</span>
                      Google Maps
                    </a>
                  </div>
                </>
              ) : (
                <div className="od-empty">
                  No location shared. Add an <strong>Ask location</strong> block before the
                  confirmation in your flow and the pin will appear here.
                </div>
              )}
            </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
