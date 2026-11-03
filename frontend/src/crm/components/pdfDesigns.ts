// Ready-made looks for the flow builder's "PDF document" block.
//
// Every design builds the same document (the confirmation or cancellation
// slip for this business type: confirmPdfTemplate's sections and wording) in
// its own layout and colours. So switching design never changes what the slip
// says, and a clinic's slip still has no cart in any of them.
//
// Only text, boxes and lines are used, all the server's renderer draws
// (services/pdfDoc.js, Helvetica), so the PDF a customer gets looks like the
// preview. No images: a design can't know the business's logo, and the
// business can add one in the designer.
import type { PdfElement, PdfTemplate } from '../types';
import { confirmPdfTemplate, PDF_A4, type ConfirmPdfOpts } from './PdfDesigner';

export type PdfDesignId =
  | 'classic' | 'minimal' | 'ocean' | 'sidebar' | 'receipt'
  | 'bold' | 'elegant' | 'card' | 'corporate' | 'midnight';

interface Theme {
  page: string;
  primary: string;
  onPrimary: string;
  onPrimarySoft: string;
  label: string;
  text: string;
  muted: string;
  rule: string;
  /** Items panel: filled, or outlined when `panelFill` is 'none'. */
  panelFill: string;
  panelStroke?: string;
  /** Highlight panels (day / time, total payable). */
  soft: string;
  /** Text inside the highlights. */
  strong: string;
  radius: number;
  /** "Order ID" rather than "ORDER ID". */
  softLabels?: boolean;
}

type Header = 'band' | 'minimal' | 'stripe' | 'centered' | 'sidebar' | 'card' | 'bold' | 'receipt' | 'darkband';

interface Design {
  id: PdfDesignId;
  name: string;
  description: string;
  header: Header;
  theme: Theme;
}

export const PDF_DESIGNS: Design[] = [
  {
    id: 'classic', name: 'Classic', description: 'Green header band, grey panels', header: 'band',
    theme: { page: '#ffffff', primary: '#0b6b33', onPrimary: '#ffffff', onPrimarySoft: '#d6f0e0', label: '#8a949c', text: '#1c1e21', muted: '#667781', rule: '#d9dee3', panelFill: '#f4f6f8', soft: '#eaf6ee', strong: '#1c1e21', radius: 10 },
  },
  {
    id: 'minimal', name: 'Minimal', description: 'Black and white, thin outlines', header: 'minimal',
    theme: { page: '#ffffff', primary: '#111827', onPrimary: '#ffffff', onPrimarySoft: '#d1d5db', label: '#6b7280', text: '#111827', muted: '#6b7280', rule: '#e5e7eb', panelFill: 'none', panelStroke: '#e5e7eb', soft: '#f3f4f6', strong: '#111827', radius: 4, softLabels: true },
  },
  {
    id: 'ocean', name: 'Ocean', description: 'Blue header, soft blue cards', header: 'band',
    theme: { page: '#ffffff', primary: '#0b5cad', onPrimary: '#ffffff', onPrimarySoft: '#cfe3fa', label: '#5b7a99', text: '#13263b', muted: '#5b7a99', rule: '#d6e4f2', panelFill: '#f2f7fd', soft: '#e1eefc', strong: '#0b5cad', radius: 14 },
  },
  {
    id: 'sidebar', name: 'Sidebar', description: 'Dark side panel with the business name', header: 'sidebar',
    theme: { page: '#ffffff', primary: '#1e293b', onPrimary: '#ffffff', onPrimarySoft: '#94a3b8', label: '#6366f1', text: '#0f172a', muted: '#64748b', rule: '#e2e8f0', panelFill: '#f8fafc', soft: '#eef2ff', strong: '#3730a3', radius: 8 },
  },
  {
    id: 'receipt', name: 'Receipt', description: 'Narrow till slip, one line per detail', header: 'receipt',
    theme: { page: '#f1f3f5', primary: '#111111', onPrimary: '#ffffff', onPrimarySoft: '#cccccc', label: '#6b6b6b', text: '#111111', muted: '#6b6b6b', rule: '#dddddd', panelFill: '#ffffff', soft: '#f1f3f5', strong: '#111111', radius: 6 },
  },
  {
    id: 'bold', name: 'Bold', description: 'Big orange title, warm panels', header: 'bold',
    theme: { page: '#ffffff', primary: '#ea580c', onPrimary: '#ffffff', onPrimarySoft: '#ffedd5', label: '#c2410c', text: '#1c1917', muted: '#78716c', rule: '#fed7aa', panelFill: '#fff7ed', soft: '#ffedd5', strong: '#9a3412', radius: 12 },
  },
  {
    id: 'elegant', name: 'Elegant', description: 'Cream page, gold lines, centred', header: 'centered',
    theme: { page: '#fbf8f1', primary: '#8a6d3b', onPrimary: '#ffffff', onPrimarySoft: '#f4ecdc', label: '#a08a5c', text: '#3b3222', muted: '#8c7b5c', rule: '#e4d9c3', panelFill: 'none', panelStroke: '#e4d9c3', soft: '#f4ecdc', strong: '#6b532a', radius: 2, softLabels: true },
  },
  {
    id: 'card', name: 'Card', description: 'White card on a violet page', header: 'card',
    theme: { page: '#f1effa', primary: '#7c3aed', onPrimary: '#ffffff', onPrimarySoft: '#e4d8fd', label: '#7c6aa6', text: '#1f1535', muted: '#6b6185', rule: '#e7e1f7', panelFill: '#f7f5fd', soft: '#efe9fd', strong: '#5b21b6', radius: 12 },
  },
  {
    id: 'corporate', name: 'Corporate', description: 'Teal top stripe, outlined sections', header: 'stripe',
    theme: { page: '#ffffff', primary: '#0f766e', onPrimary: '#ffffff', onPrimarySoft: '#ccfbf1', label: '#0f766e', text: '#0f172a', muted: '#64748b', rule: '#cbd5e1', panelFill: 'none', panelStroke: '#cbd5e1', soft: '#e6f4f2', strong: '#115e59', radius: 4 },
  },
  {
    id: 'midnight', name: 'Midnight', description: 'Charcoal bands with a teal accent', header: 'darkband',
    theme: { page: '#ffffff', primary: '#1f2933', onPrimary: '#ffffff', onPrimarySoft: '#9fb3c8', label: '#0f766e', text: '#1f2933', muted: '#52606d', rule: '#d9e2ec', panelFill: '#f5f7fa', soft: '#e6fffb', strong: '#0f766e', radius: 8 },
  },
];

const byId = new Map(PDF_DESIGNS.map((d) => [d.id, d]));
export const pdfDesignName = (id?: string) => byId.get(id as PdfDesignId)?.name || '';

let seq = 1;
const eid = () => `d${Date.now().toString(36)}${seq++}`;

/** "ORDER ID" → "Order ID" (ID and REF stay capitals). */
const soften = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])([a-z]*)\b/g, (w, a: string, b: string) => (w === 'id' || w === 'ref' ? w.toUpperCase() : a.toUpperCase() + b));

/** Build design `id` for a slip described by `opts`. */
export function buildPdfDesign(id: PdfDesignId, opts: ConfirmPdfOpts): PdfTemplate {
  const d = byId.get(id) || PDF_DESIGNS[0];
  // Classic is the original slip, exactly.
  if (d.id === 'classic') return { ...confirmPdfTemplate(opts), design: 'classic' };
  const t = d.theme;
  const els: PdfElement[] = [];
  const text = (e: Partial<PdfElement>) => els.push({ id: eid(), type: 'text', x: 0, y: 0, color: t.text, ...e } as PdfElement);
  const box = (x: number, y: number, w: number, h: number, fill: string, radius = 0, stroke?: string) =>
    els.push({ id: eid(), type: 'box', x, y, w, h, fill, radius, ...(stroke ? { stroke, thickness: 1 } : {}) } as PdfElement);
  const line = (x: number, y: number, w: number, color = t.rule, thickness = 1) =>
    els.push({ id: eid(), type: 'line', x, y, w, color, thickness } as PdfElement);
  const lab = (s: string) => (t.softLabels ? soften(s) : s);

  // ---- frame: header, footer, and the area the details go in ----
  let x0 = 64;
  let w = 666;
  let y = 160;
  let footer: 'rule' | 'none' = 'rule';
  let footerX = 64;
  let footerW = 666;
  const page = PDF_A4.height;
  switch (d.header) {
    case 'minimal':
      text({ x: 64, y: 58, w: 666, text: '{{business_name}}', fontSize: 28, bold: true });
      text({ x: 64, y: 100, w: 666, text: opts.title, fontSize: 13, color: t.muted });
      line(64, 134, 666, t.primary, 3);
      y = 172;
      break;
    case 'stripe':
      box(0, 0, 794, 12, t.primary);
      text({ x: 64, y: 46, w: 400, text: '{{business_name}}', fontSize: 24, bold: true, color: t.primary });
      text({ x: 430, y: 54, w: 300, text: opts.title, fontSize: 13, color: t.muted, align: 'right' });
      line(64, 100, 666);
      y = 136;
      break;
    case 'centered':
      text({ x: 64, y: 62, w: 666, text: '{{business_name}}', fontSize: 28, bold: true, color: t.primary, align: 'center' });
      text({ x: 64, y: 104, w: 666, text: opts.title, fontSize: 12, color: t.muted, align: 'center' });
      line(297, 136, 200, t.primary, 2);
      line(337, 142, 120, t.rule, 1);
      y = 180;
      break;
    case 'sidebar':
      box(0, 0, 250, page, t.primary);
      text({ x: 32, y: 56, w: 190, text: opts.title, fontSize: 11, bold: true, color: t.onPrimarySoft });
      text({ x: 32, y: 80, w: 190, text: '{{business_name}}', fontSize: 22, bold: true, color: t.onPrimary, lineGap: 3 });
      text({ x: 32, y: 1050, w: 190, text: 'Generated {{today}}', fontSize: 10, color: t.onPrimarySoft });
      x0 = 290;
      w = 440;
      text({ x: x0, y: 56, w, text: opts.title, fontSize: 24, bold: true });
      y = 116;
      footer = 'none';
      text({ x: x0, y: 1050, w, text: 'Thank you for choosing {{business_name}}', fontSize: 10, color: t.muted });
      break;
    case 'card':
      box(40, 40, 714, 1043, '#ffffff', 18);
      box(40, 40, 714, 130, t.primary, 18);
      box(40, 130, 714, 40, t.primary, 0);
      text({ x: 80, y: 78, w: 560, text: '{{business_name}}', fontSize: 25, bold: true, color: t.onPrimary });
      text({ x: 80, y: 114, w: 560, text: opts.title, fontSize: 13, color: t.onPrimarySoft });
      x0 = 80;
      w = 634;
      y = 206;
      footerX = 80;
      footerW = 634;
      break;
    case 'bold':
      text({ x: 64, y: 44, w: 666, text: '{{business_name}}', fontSize: 13, bold: true, color: t.muted });
      text({ x: 64, y: 66, w: 666, text: opts.title, fontSize: 36, bold: true, color: t.primary });
      box(64, 124, 90, 8, t.primary, 4);
      y = 166;
      break;
    case 'receipt':
      box(167, 40, 460, 1043, '#ffffff', 6);
      text({ x: 197, y: 78, w: 400, text: '{{business_name}}', fontSize: 22, bold: true, align: 'center' });
      text({ x: 197, y: 110, w: 400, text: opts.title, fontSize: 12, color: t.muted, align: 'center' });
      line(197, 144, 400, t.text, 1);
      x0 = 197;
      w = 400;
      y = 166;
      footerX = 197;
      footerW = 400;
      break;
    case 'darkband':
      box(0, 0, 794, 128, t.primary);
      box(0, 128, 794, 6, t.label);
      text({ x: 64, y: 38, w: 600, text: '{{business_name}}', fontSize: 26, bold: true, color: t.onPrimary });
      text({ x: 64, y: 80, w: 600, text: opts.title, fontSize: 13, color: '#5eead4' });
      box(0, 1063, 794, 60, t.primary);
      text({ x: 64, y: 1086, w: 666, text: 'Thank you for choosing {{business_name}} · Generated {{today}}', fontSize: 10, color: t.onPrimarySoft, align: 'center' });
      footer = 'none';
      y = 178;
      break;
    default: // band
      box(0, 0, 794, 110, t.primary);
      text({ x: 64, y: 34, w: 500, text: '{{business_name}}', fontSize: 26, bold: true, color: t.onPrimary });
      text({ x: 64, y: 70, w: 500, text: opts.title, fontSize: 13, color: t.onPrimarySoft });
      y = 160;
  }

  const dateToken = opts.appointment ? '{{today}}' : '{{order_date}}';
  const L = { fontSize: 10, bold: true, color: t.label } as const;

  if (d.header === 'receipt') {
    // ---- one detail per line: label left, value right ----
    const row = (label: string, value: string, strong = false) => {
      text({ x: x0, y, w: 190, text: lab(label), fontSize: 11, color: t.muted });
      text({ x: x0 + 150, y, w: w - 150, text: value, fontSize: strong ? 15 : 12, bold: strong, align: 'right' });
      y += strong ? 30 : 26;
    };
    const block = (label: string, value: string, h: number) => {
      text({ x: x0, y, w, text: lab(label), fontSize: 11, color: t.muted });
      text({ x: x0, y: y + 18, w, text: value, fontSize: 12, lineGap: 4 });
      y += h;
    };
    row(opts.dateLabel, dateToken);
    row(opts.refLabel, '{{order_id}}', true);
    line(x0, y, w); y += 16;
    row(opts.customerLabel, '{{customer_name}}');
    row('PHONE', '{{customer_phone}}');
    row('PAYING BY', '{{payment_method}}');
    if (opts.appointment) {
      row('FOR', '{{category}}');
      row('WITH', '{{member}}');
      row('AGE / GENDER', '{{age}}  ·  {{gender}}');
      line(x0, y, w); y += 16;
      row('DAY', '{{appointment_date}}', true);
      row('TIME', '{{appointment_slot}}', true);
    }
    if (opts.address) {
      line(x0, y, w); y += 16;
      block('DELIVER TO', '{{delivery_address}}', 70);
    }
    if (opts.items) {
      line(x0, y, w); y += 16;
      block('ITEMS ({{cart_count}})', '{{cart_items}}', 150);
      line(x0, y, w); y += 16;
      row('Items subtotal', '{{items_total}}');
      row('Delivery', '{{delivery_fee}}');
      line(x0, y, w, t.text); y += 14;
      row('Total payable', '{{total_payable}}', true);
    }
    line(x0, y + 4, w); y += 28;
    text({ x: x0, y, w, text: opts.note, fontSize: 11, color: t.muted, align: 'center', lineGap: 4 });
  } else {
    // ---- two columns, like the classic slip ----
    const col2 = x0 + Math.round(w * 0.55);
    const cw = Math.round(w * 0.45) - 8;
    const panel = (py: number, h: number) =>
      (t.panelFill === 'none' ? box(x0, py, w, h, 'none', t.radius, t.panelStroke || t.rule) : box(x0, py, w, h, t.panelFill, t.radius));

    text({ x: x0, y, w: cw, text: lab(opts.dateLabel), ...L });
    text({ x: x0, y: y + 18, w: cw, text: dateToken, fontSize: 15 });
    text({ x: col2, y, w: cw, text: lab(opts.refLabel), ...L });
    text({ x: col2, y: y + 18, w: cw, text: '{{order_id}}', fontSize: 15, bold: true });
    y += 62;
    line(x0, y, w);
    y += 26;

    text({ x: x0, y, w: cw, text: lab(opts.customerLabel), ...L });
    text({ x: x0, y: y + 18, w: cw, text: '{{customer_name}}', fontSize: 14 });
    text({ x: x0, y: y + 40, w: cw, text: '{{customer_phone}}', fontSize: 12, color: t.muted });
    text({ x: col2, y, w: cw, text: lab('PAYING BY'), ...L });
    text({ x: col2, y: y + 18, w: cw, text: '{{payment_method}}', fontSize: 14 });
    text({ x: col2, y: y + 40, w: cw, text: '{{category}}', fontSize: 12, color: t.muted });
    y += 82;

    if (opts.appointment) {
      text({ x: x0, y, w: cw, text: lab('WITH'), ...L });
      text({ x: x0, y: y + 18, w: Math.round(w * 0.52), text: '{{member}}', fontSize: 14 });
      text({ x: col2, y, w: cw, text: lab('AGE / GENDER'), ...L });
      text({ x: col2, y: y + 18, w: cw, text: '{{age}}  ·  {{gender}}', fontSize: 14 });
      y += 70;
      box(x0, y, w, 92, t.soft, t.radius);
      text({ x: x0 + 24, y: y + 20, w: cw, text: lab('DAY'), ...L });
      text({ x: x0 + 24, y: y + 42, w: Math.round(w * 0.5), text: '{{appointment_date}}', fontSize: 19, bold: true, color: t.strong });
      text({ x: col2, y: y + 20, w: cw, text: lab('TIME'), ...L });
      text({ x: col2, y: y + 42, w: cw, text: '{{appointment_slot}}', fontSize: 19, bold: true, color: t.strong });
      y += 124;
    }

    if (opts.address) {
      text({ x: x0, y, w: cw, text: lab('DELIVER TO'), ...L });
      text({ x: x0, y: y + 18, w: Math.round(w * 0.66), text: '{{delivery_address}}', fontSize: 13, lineGap: 3 });
      y += 90;
    }

    if (opts.items) {
      panel(y, 210);
      text({ x: x0 + 24, y: y + 24, w: w - 48, text: lab('ITEMS ({{cart_count}})'), fontSize: 11, bold: true, color: t.label });
      text({ x: x0 + 24, y: y + 46, w: w - 48, text: '{{cart_items}}', fontSize: 13, lineGap: 5 });
      y += 240;
      line(x0 + 24, y, w - 48);
      text({ x: x0 + 24, y: y + 20, w: cw, text: 'Items subtotal', fontSize: 12, color: t.muted });
      text({ x: col2, y: y + 20, w: x0 + w - 24 - col2, text: '{{items_total}}', fontSize: 12, align: 'right' });
      text({ x: x0 + 24, y: y + 44, w: cw, text: 'Delivery', fontSize: 12, color: t.muted });
      text({ x: col2, y: y + 44, w: x0 + w - 24 - col2, text: '{{delivery_fee}}', fontSize: 12, align: 'right' });
      y += 76;
      box(x0, y, w, 52, t.soft, Math.min(t.radius, 10));
      text({ x: x0 + 24, y: y + 16, w: cw, text: 'Total payable', fontSize: 14, bold: true, color: t.strong });
      text({ x: col2, y: y + 14, w: x0 + w - 24 - col2, text: '{{total_payable}}', fontSize: 17, bold: true, align: 'right', color: t.strong });
      y += 94;
    }

    text({ x: x0, y, w, text: opts.note, fontSize: 12, color: t.muted, lineGap: 4, align: d.header === 'centered' ? 'center' : 'left' });
  }

  if (footer === 'rule') {
    line(footerX, 1010, footerW);
    text({ x: footerX, y: 1030, w: footerW, text: 'Thank you for choosing {{business_name}} · Generated {{today}}', fontSize: 10, color: t.label === t.muted ? t.muted : '#8a949c', align: 'center' });
  }

  return { width: PDF_A4.width, height: PDF_A4.height, background: t.page, elements: els, design: d.id };
}
