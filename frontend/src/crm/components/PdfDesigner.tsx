// A4 PDF designer for the flow builder's "PDF document" block.
//
// The business lays out a page — logo, headings, lines, boxes and text — and
// drops in {{live values}} (chosen category, member, order id, amount paid,
// cancelled date…). At send time the backend renders this exact layout to a
// real PDF with the values filled in, so one template serves every business
// and every flow.
//
// Coordinates are CSS pixels on an A4 page at 96dpi (794 × 1123). The canvas is
// shown scaled down; the backend converts to PDF points, so what's arranged
// here is what comes out.
import { CopyIcon } from './AppIcons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBackHandler } from '../useBackHandler';
import type { PdfElement, PdfElementType, PdfTemplate } from '../types';
import { useMedia } from './uploadCtx';
import { useConfirm } from './Dialogs';
import { uiScale } from '../uiScale';
import { PDF_DESIGNS, buildPdfDesign, type PdfDesignId } from './pdfDesigns';

export const PDF_A4 = { width: 794, height: 1123 };

/** Live values usable in any text. Mirrors the backend's token list. */
export const PDF_TOKENS: { key: string; label: string }[] = [
  { key: 'business_name', label: 'Business name' },
  { key: 'customer_name', label: 'Customer name' },
  { key: 'customer_phone', label: 'Customer phone' },
  { key: 'customer_email', label: 'Customer email' },
  { key: 'category', label: 'Chosen category' },
  { key: 'member', label: 'Chosen member' },
  { key: 'order_id', label: 'Order / booking ID' },
  { key: 'order_total', label: 'Order total' },
  { key: 'order_status', label: 'Order status' },
  { key: 'order_date', label: 'Order date' },
  { key: 'order_items', label: 'Order items' },
  { key: 'amount_paid', label: 'Amount paid' },
  { key: 'payment_status', label: 'Paid / not paid' },
  { key: 'cancelled_date', label: 'Cancelled date' },
  { key: 'today', label: "Today's date" },
  // Captured on the way through the flow: the cart from a Catalog block, the
  // charges from a Payment type block, the tapped button, a shared location.
  { key: 'cart_items', label: 'Cart items' },
  { key: 'cart_count', label: 'Item count' },
  { key: 'items_total', label: 'Items subtotal' },
  { key: 'delivery_fee', label: 'Delivery fee' },
  { key: 'total_payable', label: 'Total payable' },
  { key: 'payment_method', label: 'Payment method' },
  { key: 'delivery_address', label: 'Delivery address' },
  { key: 'location_url', label: 'Map link' },
  // From an appointment booking or reschedule. Readable values, not raw: the
  // date is "18 Oct 2026" and the time "10:30 am".
  { key: 'appointment_date', label: 'Appointment date' },
  { key: 'appointment_slot', label: 'Appointment time' },
  { key: 'gender', label: 'Gender' },
  { key: 'age', label: 'Age' },
];

// Sample values so the canvas previews like a finished document.
const SAMPLE: Record<string, string> = {
  business_name: 'Devine Food Products',
  customer_name: 'Ravi Kumar',
  customer_phone: '+91 98765 43210',
  customer_email: 'ravi@example.com',
  category: 'Cardiology',
  member: 'Dr. Asha Rao · Cardiologist',
  order_id: 'DVN-B2C-1AA1F8',
  order_total: 'Rs.189',
  order_status: 'Cancelled',
  order_date: '15/8/2026',
  order_items: '1× Ghee 1L',
  amount_paid: 'Rs.189',
  payment_status: 'Paid',
  cancelled_date: '17/8/2026',
  today: '17/8/2026',
  cart_items: '2 x Carrot - 1 kg - Rs.600\n1 x Ghee - 500 ml - Rs.250',
  cart_count: '3',
  items_total: 'Rs.850',
  delivery_fee: 'Rs.99',
  total_payable: 'Rs.949',
  payment_method: 'COD',
  delivery_address: '12 MG Road, Bengaluru 560001',
  location_url: 'https://maps.google.com/?q=12.97,77.59',
  appointment_date: '18 Oct 2026',
  appointment_slot: '10:30 am',
  gender: 'Female',
  age: '34',
};

let eidSeq = 1;
const newEid = () => `e${Date.now().toString(36)}${eidSeq++}`;

function defaultElement(type: PdfElementType): PdfElement {
  const base = { id: newEid(), type, x: 64, y: 120 };
  switch (type) {
    case 'image':
      return { ...base, w: 150, h: 150, src: '' };
    case 'box':
      return { ...base, w: 666, h: 90, fill: '#f4f6f8', radius: 10 };
    case 'line':
      return { ...base, w: 666, color: '#d9dee3', thickness: 1 };
    default:
      return { ...base, w: 420, text: 'New text', fontSize: 16, color: '#1c1e21', align: 'left' };
  }
}

/** A sensible starting document so nobody faces a blank page. */
export function starterTemplate(): PdfTemplate {
  const mk = (e: Partial<PdfElement>): PdfElement =>
    ({ id: newEid(), type: 'text', x: 64, y: 0, ...e }) as PdfElement;
  return {
    width: PDF_A4.width,
    height: PDF_A4.height,
    background: '#ffffff',
    elements: [
      mk({ type: 'box', x: 0, y: 0, w: 794, h: 110, fill: '#0b6b33', radius: 0 }),
      mk({ y: 34, w: 500, text: '{{business_name}}', fontSize: 26, bold: true, color: '#ffffff' }),
      mk({ y: 70, w: 500, text: 'Order cancellation receipt', fontSize: 13, color: '#d6f0e0' }),

      mk({ y: 160, w: 300, text: 'CANCELLED ON', fontSize: 10, bold: true, color: '#8a949c' }),
      mk({ y: 178, w: 300, text: '{{cancelled_date}}', fontSize: 15 }),
      mk({ x: 430, y: 160, w: 300, text: 'ORDER ID', fontSize: 10, bold: true, color: '#8a949c' }),
      mk({ x: 430, y: 178, w: 300, text: '{{order_id}}', fontSize: 15, bold: true }),

      mk({ type: 'line', x: 64, y: 222, w: 666 }),

      mk({ y: 248, w: 300, text: 'CUSTOMER', fontSize: 10, bold: true, color: '#8a949c' }),
      mk({ y: 266, w: 300, text: '{{customer_name}}', fontSize: 14 }),
      mk({ y: 288, w: 300, text: '{{customer_phone}}', fontSize: 12, color: '#667781' }),

      mk({ x: 430, y: 248, w: 300, text: 'BOOKED WITH', fontSize: 10, bold: true, color: '#8a949c' }),
      mk({ x: 430, y: 266, w: 300, text: '{{member}}', fontSize: 14 }),
      mk({ x: 430, y: 288, w: 300, text: '{{category}}', fontSize: 12, color: '#667781' }),

      mk({ type: 'box', x: 64, y: 340, w: 666, h: 120, fill: '#f4f6f8', radius: 10 }),
      mk({ x: 88, y: 364, w: 300, text: 'Items', fontSize: 11, bold: true, color: '#8a949c' }),
      mk({ x: 88, y: 384, w: 400, text: '{{order_items}}', fontSize: 13 }),
      mk({ x: 88, y: 418, w: 300, text: 'Order total', fontSize: 11, bold: true, color: '#8a949c' }),
      mk({ x: 88, y: 436, w: 200, text: '{{order_total}}', fontSize: 15, bold: true }),
      mk({ x: 450, y: 418, w: 256, text: 'Payment', fontSize: 11, bold: true, color: '#8a949c', align: 'right' }),
      mk({ x: 450, y: 436, w: 256, text: '{{payment_status}}', fontSize: 15, bold: true, align: 'right' }),

      mk({ y: 510, w: 666, text: 'This order has been cancelled. Any amount already paid will be refunded to the original payment method within 5–7 working days.', fontSize: 12, color: '#667781', lineGap: 4 }),

      mk({ type: 'line', x: 64, y: 1010, w: 666 }),
      mk({ y: 1030, w: 666, text: 'Thank you for choosing {{business_name}} · Generated {{today}}', fontSize: 10, color: '#8a949c', align: 'center' }),
    ],
  };
}

/**
 * An order confirmation document, for the "Order confirmed (PDF)" block.
 *
 * Same grid as the cancellation slip, different story: what was ordered, what
 * it costs, how they're paying and where it's going. Every line is a token, so
 * a business that doesn't capture (say) a delivery address just gets an empty
 * element — the renderer skips text that resolves to nothing, so the layout
 * closes up on its own rather than printing a stray label.
 *
 * Money reads "Rs." rather than "₹" deliberately: the PDF uses the built-in
 * Helvetica, which has no rupee glyph. The backend substitutes it anyway, but
 * writing it this way keeps the designer preview honest.
 */
/** How the confirmation slip should be laid out for one business type. */
export interface ConfirmPdfOpts {
  /** Line under the business name, e.g. "Appointment confirmation". */
  title: string;
  /** Heading over the reference, e.g. "ORDER ID" or "REF". */
  refLabel: string;
  /** Heading over the date, e.g. "ORDER DATE" or "BOOKED ON". */
  dateLabel: string;
  /** Who it's for, e.g. "CUSTOMER" or "PATIENT". */
  customerLabel: string;
  /** Show the appointment rows (with whom, what for, day and time). */
  appointment: boolean;
  /** Show the delivery address block. */
  address: boolean;
  /** Show the cart panel and the subtotal / delivery / total rows. */
  items: boolean;
  /** Closing sentence above the footer rule. */
  note: string;
}

export const ORDER_PDF_OPTS: ConfirmPdfOpts = {
  title: 'Order confirmation',
  refLabel: 'ORDER ID',
  dateLabel: 'ORDER DATE',
  customerLabel: 'CUSTOMER',
  appointment: false,
  address: true,
  items: true,
  note: 'Your order is confirmed and is being prepared. We will message you on WhatsApp with every update.',
};

/**
 * Build the confirmation slip for a business type.
 *
 * Laid out with a running cursor rather than fixed coordinates, because the
 * sections differ per type: a clinic's slip has no cart, no delivery address
 * and no totals, and leaving those out as empty tokens left a third of the
 * page blank with stray headings. A clinic slip now runs
 * header → ref/date → patient/paying → with/for → day/time → note.
 */
export function confirmPdfTemplate(opts: ConfirmPdfOpts = ORDER_PDF_OPTS): PdfTemplate {
  const mk = (e: Partial<PdfElement>): PdfElement =>
    ({ id: newEid(), type: 'text', x: 64, y: 0, ...e }) as PdfElement;
  const els: PdfElement[] = [];
  const COL2 = 430;
  const LABEL = { fontSize: 10, bold: true, color: '#8a949c' } as const;

  els.push(
    mk({ type: 'box', x: 0, y: 0, w: 794, h: 110, fill: '#0b6b33', radius: 0 }),
    mk({ y: 34, w: 500, text: '{{business_name}}', fontSize: 26, bold: true, color: '#ffffff' }),
    mk({ y: 70, w: 500, text: opts.title, fontSize: 13, color: '#d6f0e0' }),
  );

  let y = 160;
  els.push(
    mk({ y, w: 300, text: opts.dateLabel, ...LABEL }),
    mk({ y: y + 18, w: 300, text: opts.appointment ? '{{today}}' : '{{order_date}}', fontSize: 15 }),
    mk({ x: COL2, y, w: 300, text: opts.refLabel, ...LABEL }),
    mk({ x: COL2, y: y + 18, w: 300, text: '{{order_id}}', fontSize: 15, bold: true }),
  );
  y += 62;
  els.push(mk({ type: 'line', x: 64, y, w: 666 }));
  y += 26;

  els.push(
    mk({ y, w: 300, text: opts.customerLabel, ...LABEL }),
    mk({ y: y + 18, w: 300, text: '{{customer_name}}', fontSize: 14 }),
    mk({ y: y + 40, w: 300, text: '{{customer_phone}}', fontSize: 12, color: '#667781' }),
    mk({ x: COL2, y, w: 300, text: 'PAYING BY', ...LABEL }),
    mk({ x: COL2, y: y + 18, w: 300, text: '{{payment_method}}', fontSize: 14 }),
    mk({ x: COL2, y: y + 40, w: 300, text: '{{category}}', fontSize: 12, color: '#667781' }),
  );
  y += 82;

  if (opts.appointment) {
    els.push(
      mk({ y, w: 300, text: 'WITH', ...LABEL }),
      mk({ y: y + 18, w: 340, text: '{{member}}', fontSize: 14 }),
      mk({ x: COL2, y, w: 300, text: 'AGE / GENDER', ...LABEL }),
      mk({ x: COL2, y: y + 18, w: 300, text: '{{age}}  ·  {{gender}}', fontSize: 14 }),
    );
    y += 70;
    els.push(
      mk({ type: 'box', x: 64, y, w: 666, h: 92, fill: '#eaf6ee', radius: 10 }),
      mk({ x: 88, y: y + 20, w: 300, text: 'DAY', ...LABEL }),
      mk({ x: 88, y: y + 42, w: 320, text: '{{appointment_date}}', fontSize: 19, bold: true }),
      mk({ x: COL2, y: y + 20, w: 300, text: 'TIME', ...LABEL }),
      mk({ x: COL2, y: y + 42, w: 300, text: '{{appointment_slot}}', fontSize: 19, bold: true }),
    );
    y += 124;
  }

  if (opts.address) {
    els.push(
      mk({ y, w: 300, text: 'DELIVER TO', ...LABEL }),
      mk({ y: y + 18, w: 440, text: '{{delivery_address}}', fontSize: 13, lineGap: 3 }),
    );
    y += 90;
  }

  if (opts.items) {
    els.push(
      mk({ type: 'box', x: 64, y, w: 666, h: 210, fill: '#f4f6f8', radius: 10 }),
      mk({ x: 88, y: y + 24, w: 400, text: 'ITEMS ({{cart_count}})', fontSize: 11, bold: true, color: '#8a949c' }),
      mk({ x: 88, y: y + 46, w: 618, text: '{{cart_items}}', fontSize: 13, lineGap: 5 }),
    );
    y += 240;
    els.push(
      mk({ type: 'line', x: 88, y, w: 618 }),
      mk({ x: 88, y: y + 20, w: 300, text: 'Items subtotal', fontSize: 12, color: '#667781' }),
      mk({ x: 450, y: y + 20, w: 256, text: '{{items_total}}', fontSize: 12, align: 'right' }),
      mk({ x: 88, y: y + 44, w: 300, text: 'Delivery', fontSize: 12, color: '#667781' }),
      mk({ x: 450, y: y + 44, w: 256, text: '{{delivery_fee}}', fontSize: 12, align: 'right' }),
    );
    y += 76;
    els.push(
      mk({ type: 'box', x: 64, y, w: 666, h: 52, fill: '#eaf6ee', radius: 8 }),
      mk({ x: 88, y: y + 16, w: 300, text: 'Total payable', fontSize: 14, bold: true }),
      mk({ x: 450, y: y + 14, w: 256, text: '{{total_payable}}', fontSize: 17, bold: true, align: 'right' }),
    );
    y += 94;
  }

  els.push(mk({ y, w: 666, text: opts.note, fontSize: 12, color: '#667781', lineGap: 4 }));

  els.push(
    mk({ type: 'line', x: 64, y: 1010, w: 666 }),
    mk({ y: 1030, w: 666, text: 'Thank you for choosing {{business_name}} · Generated {{today}}', fontSize: 10, color: '#8a949c', align: 'center' }),
  );

  return { width: PDF_A4.width, height: PDF_A4.height, background: '#ffffff', elements: els };
}

/** Kept for callers that want the shop slip specifically. */
export const orderConfirmTemplate = (): PdfTemplate => confirmPdfTemplate(ORDER_PDF_OPTS);

// Render text with {{tokens}} highlighted, previewed with sample values.
function TokenText({ text, preview }: { text: string; preview: boolean }) {
  const parts = (text || '').split(/(\{\{\s*[a-zA-Z0-9_]+\s*\}\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
        if (!m) return <span key={i}>{p}</span>;
        if (preview) return <span key={i}>{SAMPLE[m[1]] ?? m[1]}</span>;
        return (
          <span className="pdfd-token" key={i}>
            {m[1]}
          </span>
        );
      })}
    </>
  );
}

/** A whole A4 page drawn small, with sample values: the design gallery's cards. */
export function PdfPageThumb({ template, width = 150 }: { template: PdfTemplate; width?: number }) {
  const k = width / PDF_A4.width;
  return (
    <div className="pdfd-thumb" style={{ width, height: Math.round(PDF_A4.height * k), background: template.background || '#fff' }}>
      <div style={{ width: PDF_A4.width, height: PDF_A4.height, transform: `scale(${k})`, transformOrigin: 'top left', position: 'relative' }}>
        {template.elements.map((el) => {
          const st: React.CSSProperties = { position: 'absolute', left: el.x, top: el.y, width: el.w, ...(el.h ? { height: el.h } : {}) };
          if (el.type === 'text') {
            return (
              <div key={el.id} style={{ ...st, fontSize: el.fontSize, fontWeight: el.bold ? 700 : 400, fontStyle: el.italic ? 'italic' : 'normal', color: el.color, textAlign: el.align, lineHeight: 1.25, whiteSpace: 'pre-wrap' }}>
                <TokenText text={el.text || ''} preview />
              </div>
            );
          }
          if (el.type === 'box') {
            return (
              <div key={el.id} style={{ ...st, background: el.fill === 'none' ? 'transparent' : el.fill, border: el.stroke ? `${el.thickness || 1}px solid ${el.stroke}` : undefined, borderRadius: el.radius, boxSizing: 'border-box' }} />
            );
          }
          if (el.type === 'line') return <div key={el.id} style={{ ...st, height: el.thickness || 1, background: el.color || '#d9dee3' }} />;
          return el.src ? <img key={el.id} src={el.src} alt="" style={{ ...st, objectFit: 'contain' }} /> : null;
        })}
      </div>
    </div>
  );
}

interface Props {
  template: PdfTemplate | null | undefined;
  fileName?: string;
  /**
   * What the slip says for this business type (its sections and wording), so
   * a ready-made design can rebuild the same slip in another look.
   */
  designOpts?: ConfirmPdfOpts;
  /** Open on the design gallery. */
  startWithDesigns?: boolean;
  onClose: () => void;
  onSave: (template: PdfTemplate, fileName: string) => void;
}

export function PdfDesigner({ template, fileName = '', designOpts, startWithDesigns = false, onClose, onSave }: Props) {
  const { upload } = useMedia();
  const confirm = useConfirm();
  const [showDesigns, setShowDesigns] = useState(startWithDesigns);
  // Back closes the gallery first, then the designer.
  useBackHandler(true, () => (showDesigns ? setShowDesigns(false) : onClose()));
  const [els, setEls] = useState<PdfElement[]>(() =>
    template?.elements?.length ? JSON.parse(JSON.stringify(template.elements)) : starterTemplate().elements,
  );
  const [background, setBackground] = useState(template?.background || '#ffffff');
  const [design, setDesign] = useState<string>(template?.design || '');
  // Changed since the design was applied (or opened): picking another then asks first.
  const [edited, setEdited] = useState(false);
  const [name, setName] = useState(fileName || 'document-{{order_id}}');
  const [selId, setSelId] = useState<string>('');
  const opts = designOpts || ORDER_PDF_OPTS;
  const gallery = useMemo(() => PDF_DESIGNS.map((d) => ({ ...d, tpl: buildPdfDesign(d.id, opts) })), [opts]);

  async function applyDesign(id: PdfDesignId) {
    const d = gallery.find((g) => g.id === id);
    if (!d) return;
    if (edited) {
      const ok = await confirm({
        title: `Use the ${d.name} design?`,
        message: 'Its layout and colours replace this page, and text you changed goes back to the standard wording. Images you added (a logo, a stamp) are kept.',
        confirmLabel: `Use ${d.name}`,
        tone: 'primary',
      });
      if (!ok) return;
    }
    // A logo or signature the business added stays: designs have no images.
    const images = els.filter((e) => e.type === 'image');
    setEls([...JSON.parse(JSON.stringify(buildPdfDesign(id, opts).elements)), ...images]);
    setBackground(d.tpl.background || '#ffffff');
    setDesign(id);
    setEdited(false);
    setSelId('');
    setShowDesigns(false);
  }
  const [preview, setPreview] = useState(false);
  const [zoom, setZoom] = useState(0.62);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Tracks an in-progress drag/resize without re-rendering on every frame.
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);

  const sel = els.find((e) => e.id === selId) || null;
  const patch = (id: string, p: Partial<PdfElement>) => {
    setEdited(true);
    setEls((list) => list.map((e) => (e.id === id ? { ...e, ...p } : e)));
  };

  function add(type: PdfElementType) {
    const el = defaultElement(type);
    setEdited(true);
    setEls((l) => [...l, el]);
    setSelId(el.id);
    if (type === 'image') setTimeout(() => fileRef.current?.click(), 0);
  }
  function remove(id: string) {
    setEdited(true);
    setEls((l) => l.filter((e) => e.id !== id));
    if (selId === id) setSelId('');
  }
  function duplicate(id: string) {
    const src = els.find((e) => e.id === id);
    if (!src) return;
    const copy = { ...JSON.parse(JSON.stringify(src)), id: newEid(), x: src.x + 16, y: src.y + 16 };
    setEdited(true);
    setEls((l) => [...l, copy]);
    setSelId(copy.id);
  }
  // Stacking order matters: a background box must sit behind its text.
  function reorder(id: string, dir: -1 | 1) {
    setEdited(true);
    setEls((l) => {
      const i = l.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function onImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !sel) return;
    patch(sel.id, { src: URL.createObjectURL(f) }); // instant preview
    setUploading(true);
    upload(f)
      .then((url) => patch(sel.id, { src: url })) // persist to the CDN
      .catch(() => {})
      .finally(() => setUploading(false));
  }

  // ---- drag & resize -------------------------------------------------------
  function startDrag(e: React.PointerEvent, el: PdfElement, mode: 'move' | 'resize') {
    e.stopPropagation();
    setSelId(el.id);
    drag.current = {
      id: el.id, mode,
      sx: e.clientX, sy: e.clientY,
      ox: el.x, oy: el.y,
      ow: el.w || 100, oh: el.h || 40,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      // Mouse moves are screen px: undo the 90% view too, not just the preview zoom.
      const k = zoom * uiScale();
      const dx = (e.clientX - d.sx) / k;
      const dy = (e.clientY - d.sy) / k;
      if (d.mode === 'move') {
        patch(d.id, {
          x: Math.max(0, Math.round(d.ox + dx)),
          y: Math.max(0, Math.round(d.oy + dy)),
        });
      } else {
        patch(d.id, {
          w: Math.max(24, Math.round(d.ow + dx)),
          h: Math.max(8, Math.round(d.oh + dy)),
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zoom],
  );
  useEffect(() => {
    const up = () => {
      drag.current = null;
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', up);
    };
  }, [onPointerMove]);

  // Nudge with arrows, delete with Del — the usual canvas shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selId) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const step = e.shiftKey ? 10 : 1;
      const cur = els.find((x) => x.id === selId);
      if (!cur) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { remove(selId); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { patch(selId, { x: Math.max(0, cur.x - step) }); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { patch(selId, { x: cur.x + step }); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { patch(selId, { y: Math.max(0, cur.y - step) }); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { patch(selId, { y: cur.y + step }); e.preventDefault(); }
      else if (e.key === 'Escape') setSelId('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, els]);

  function insertToken(key: string) {
    if (!sel || sel.type !== 'text') return;
    patch(sel.id, { text: `${sel.text || ''}{{${key}}}` });
  }

  function save() {
    onSave(
      {
        width: PDF_A4.width,
        height: PDF_A4.height,
        background,
        elements: els,
        ...(design ? { design } : {}),
        ...(template?.slip ? { slip: template.slip } : {}),
      },
      name.trim(),
    );
  }

  return (
    <div className="pdfd-overlay">
      <header className="pdfd-head">
        <button className="icon-btn" onClick={onClose} aria-label="Close designer">
          <span className="material-icons">arrow_back</span>
        </button>
        <div className="pdfd-title">
          <strong>PDF document</strong>
          <small>A4 · live values fill in when it&apos;s sent</small>
        </div>

        <label className="pdfd-name">
          <span>File name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="document-{{order_id}}" />
        </label>

        <div className="pdfd-zoom">
          <button onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)))} title="Zoom out">
            <span className="material-icons">remove</span>
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(1.2, +(z + 0.1).toFixed(2)))} title="Zoom in">
            <span className="material-icons">add</span>
          </button>
        </div>

        <button className="k-btn ghost sm" onClick={() => setShowDesigns(true)} data-testid="pdfd-designs-btn" title="Choose a ready-made design">
          <span className="material-icons">palette</span>
          {design ? `Design: ${gallery.find((g) => g.id === design)?.name || 'Custom'}` : 'Designs'}
        </button>
        <button className={`k-btn ghost sm${preview ? ' on' : ''}`} onClick={() => setPreview((v) => !v)}>
          <span className="material-icons">{preview ? 'visibility_off' : 'visibility'}</span>
          {preview ? 'Show tokens' : 'Preview values'}
        </button>
        <button className="k-btn" onClick={save}>
          <span className="material-icons">save</span> Save document
        </button>
      </header>

      <div className="pdfd-body">
        {/* ---------------- Left: add elements + live values ---------------- */}
        <aside className="pdfd-side">
          <div className="pdfd-side-title">Add</div>
          <div className="pdfd-add">
            <button onClick={() => add('text')}><span className="material-icons">title</span> Text</button>
            <button onClick={() => add('image')}><span className="material-icons">image</span> Image / logo</button>
            <button onClick={() => add('box')}><span className="material-icons">crop_square</span> Box</button>
            <button onClick={() => add('line')}><span className="material-icons">horizontal_rule</span> Line</button>
          </div>

          <div className="pdfd-side-title">Live values</div>
          <p className="pdfd-hint">
            {sel?.type === 'text'
              ? 'Click to insert into the selected text.'
              : 'Select a text element to insert one.'}
          </p>
          <div className="pdfd-tokens">
            {PDF_TOKENS.map((t) => (
              <button
                key={t.key}
                className="pdfd-token-btn"
                disabled={sel?.type !== 'text'}
                onClick={() => insertToken(t.key)}
                title={`Insert {{${t.key}}}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="pdfd-side-title">Page</div>
          <label className="pdfd-row">
            <span>Background</span>
            <input type="color" value={background} onChange={(e) => { setEdited(true); setBackground(e.target.value); }} />
          </label>
        </aside>

        {/* ---------------- Centre: the A4 page ---------------- */}
        <div className="pdfd-canvas-wrap" onPointerDown={() => setSelId('')}>
          <div
            ref={canvasRef}
            className="pdfd-canvas"
            style={{
              width: PDF_A4.width,
              height: PDF_A4.height,
              background,
              transform: `scale(${zoom})`,
            }}
          >
            {els.map((el) => {
              const selected = el.id === selId;
              const common: React.CSSProperties = {
                left: el.x,
                top: el.y,
                width: el.w,
                ...(el.h ? { height: el.h } : {}),
              };
              return (
                <div
                  key={el.id}
                  className={`pdfd-el ${el.type}${selected ? ' sel' : ''}`}
                  style={common}
                  onPointerDown={(e) => startDrag(e, el, 'move')}
                >
                  {el.type === 'text' && (
                    <div
                      style={{
                        fontSize: el.fontSize,
                        fontWeight: el.bold ? 700 : 400,
                        fontStyle: el.italic ? 'italic' : 'normal',
                        color: el.color,
                        textAlign: el.align,
                        lineHeight: 1.25,
                      }}
                    >
                      <TokenText text={el.text || ''} preview={preview} />
                    </div>
                  )}
                  {el.type === 'image' &&
                    (el.src ? (
                      <img src={el.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <div className="pdfd-img-ph">
                        <span className="material-icons">image</span>
                      </div>
                    ))}
                  {el.type === 'box' && (
                    <div
                      style={{
                        width: '100%', height: '100%',
                        background: el.fill === 'none' ? 'transparent' : el.fill,
                        border: el.stroke ? `${el.thickness || 1}px solid ${el.stroke}` : undefined,
                        borderRadius: el.radius,
                      }}
                    />
                  )}
                  {el.type === 'line' && (
                    <div style={{ width: '100%', height: el.thickness || 1, background: el.color || '#d9dee3' }} />
                  )}

                  {selected && (
                    <span
                      className="pdfd-resize"
                      onPointerDown={(e) => startDrag(e, el, 'resize')}
                      title="Resize"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------------- Ready-made designs ---------------- */}
        {showDesigns && (
          <div className="pdfd-gallery-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setShowDesigns(false)}>
            <div className="pdfd-gallery" role="dialog" aria-modal="true" aria-label="Choose a design" data-testid="pdfd-gallery">
              <header className="pdfd-gallery-head">
                <div>
                  <h3>Choose a design</h3>
                  <p>Same details in every design: only the layout and colours change. You can still edit anything after.</p>
                </div>
                <button type="button" className="tpl-x" onClick={() => setShowDesigns(false)} aria-label="Close">
                  <span className="material-icons">close</span>
                </button>
              </header>
              <div className="pdfd-gallery-grid">
                {gallery.map((d) => (
                  <button
                    type="button"
                    key={d.id}
                    className={`pdfd-design${design === d.id ? ' on' : ''}`}
                    onClick={() => applyDesign(d.id)}
                    data-testid={`pdfd-design-${d.id}`}
                    title={`Use ${d.name}`}
                  >
                    <PdfPageThumb template={d.tpl} width={150} />
                    <span className="pdfd-design-name">
                      {d.name}
                      {design === d.id && <span className="material-icons" aria-label="In use">check_circle</span>}
                    </span>
                    <span className="pdfd-design-desc">{d.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ---------------- Right: selected element ---------------- */}
        <aside className="pdfd-props">
          {!sel ? (
            <p className="pdfd-hint pad">
              Select an element to edit it. Drag to move, use the corner to resize, arrow keys to
              nudge, Delete to remove.
            </p>
          ) : (
            <>
              <div className="pdfd-side-title">
                {sel.type === 'text' ? 'Text' : sel.type === 'image' ? 'Image' : sel.type === 'box' ? 'Box' : 'Line'}
                <div className="pdfd-prop-tools">
                  <button onClick={() => reorder(sel.id, -1)} title="Send backward"><span className="material-icons">flip_to_back</span></button>
                  <button onClick={() => reorder(sel.id, 1)} title="Bring forward"><span className="material-icons">flip_to_front</span></button>
                  <button onClick={() => duplicate(sel.id)} title="Duplicate"><CopyIcon /></button>
                  <button onClick={() => remove(sel.id)} title="Delete"><span className="material-icons">delete</span></button>
                </div>
              </div>

              {sel.type === 'text' && (
                <>
                  <label className="pdfd-field">
                    <span>Content</span>
                    <textarea
                      rows={4}
                      value={sel.text || ''}
                      onChange={(e) => patch(sel.id, { text: e.target.value })}
                      placeholder="Type text, or insert a live value"
                    />
                  </label>
                  <div className="pdfd-row2">
                    <label className="pdfd-field"><span>Size</span>
                      <input type="number" min={6} max={72} value={sel.fontSize || 16}
                        onChange={(e) => patch(sel.id, { fontSize: Number(e.target.value) || 16 })} />
                    </label>
                    <label className="pdfd-field"><span>Colour</span>
                      <input type="color" value={sel.color || '#1c1e21'}
                        onChange={(e) => patch(sel.id, { color: e.target.value })} />
                    </label>
                  </div>
                  <div className="pdfd-row2">
                    <label className="pdfd-field"><span>Align</span>
                      <select value={sel.align || 'left'}
                        onChange={(e) => patch(sel.id, { align: e.target.value as PdfElement['align'] })}>
                        <option value="left">Left</option>
                        <option value="center">Centre</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <div className="pdfd-field">
                      <span>Style</span>
                      <div className="pdfd-toggles">
                        <button className={sel.bold ? 'on' : ''} onClick={() => patch(sel.id, { bold: !sel.bold })}><b>B</b></button>
                        <button className={sel.italic ? 'on' : ''} onClick={() => patch(sel.id, { italic: !sel.italic })}><i>I</i></button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {sel.type === 'image' && (
                <>
                  <label className="k-btn ghost sm file-btn">
                    <span className="material-icons">upload</span>
                    {uploading ? 'Uploading…' : sel.src ? 'Replace image' : 'Choose image'}
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={onImageFile} />
                  </label>
                  <p className="pdfd-hint">Logos, stamps or signatures. PNG with transparency works well.</p>
                </>
              )}

              {sel.type === 'box' && (
                <div className="pdfd-row2">
                  <label className="pdfd-field"><span>Fill</span>
                    <input type="color" value={sel.fill && sel.fill !== 'none' ? sel.fill : '#f4f6f8'}
                      onChange={(e) => patch(sel.id, { fill: e.target.value })} />
                  </label>
                  <label className="pdfd-field"><span>Corner</span>
                    <input type="number" min={0} max={40} value={sel.radius || 0}
                      onChange={(e) => patch(sel.id, { radius: Number(e.target.value) || 0 })} />
                  </label>
                </div>
              )}

              {sel.type === 'line' && (
                <div className="pdfd-row2">
                  <label className="pdfd-field"><span>Colour</span>
                    <input type="color" value={sel.color || '#d9dee3'}
                      onChange={(e) => patch(sel.id, { color: e.target.value })} />
                  </label>
                  <label className="pdfd-field"><span>Thickness</span>
                    <input type="number" min={1} max={12} value={sel.thickness || 1}
                      onChange={(e) => patch(sel.id, { thickness: Number(e.target.value) || 1 })} />
                  </label>
                </div>
              )}

              <div className="pdfd-side-title">Position</div>
              <div className="pdfd-row2">
                <label className="pdfd-field"><span>X</span>
                  <input type="number" value={Math.round(sel.x)} onChange={(e) => patch(sel.id, { x: Number(e.target.value) || 0 })} />
                </label>
                <label className="pdfd-field"><span>Y</span>
                  <input type="number" value={Math.round(sel.y)} onChange={(e) => patch(sel.id, { y: Number(e.target.value) || 0 })} />
                </label>
              </div>
              <div className="pdfd-row2">
                <label className="pdfd-field"><span>Width</span>
                  <input type="number" value={Math.round(sel.w || 0)} onChange={(e) => patch(sel.id, { w: Number(e.target.value) || 0 })} />
                </label>
                {sel.type !== 'text' && sel.type !== 'line' && (
                  <label className="pdfd-field"><span>Height</span>
                    <input type="number" value={Math.round(sel.h || 0)} onChange={(e) => patch(sel.id, { h: Number(e.target.value) || 0 })} />
                  </label>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
