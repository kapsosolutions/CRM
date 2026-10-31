// Renders a tenant-designed A4 document (receipt / cancellation slip / ticket)
// into a real PDF and hosts it on Bunny so WhatsApp can attach it.
//
// The template comes from the flow builder's PDF designer and is just a list of
// absolutely-positioned elements. Coordinates are stored in CSS pixels at 96dpi
// (A4 = 794 × 1123) because that's what the designer canvas works in; we scale
// them to PDF points (72dpi) on render, so what the business arranges on screen
// is what comes out of the PDF.
//
// Any text may contain {{tokens}} — they're filled from the live order /
// member / category values, which is what makes one template work for every
// business and every flow.
import PDFDocument from 'pdfkit';
import axios from 'axios';
import storage, { mediaFolder } from './storage.js';
import { fillTokens } from './tokens.js';
import logger from './logger.js';

// A4 in the designer's pixel space (96dpi) and in PDF points (72dpi).
// 794×1123 px is the rounded 96dpi size, which isn't *exactly* A4, so we scale
// per axis to the true point size rather than using a flat 0.75 factor —
// otherwise the page comes out a fraction over A4 and printers rescale it.
export const A4_PX = { width: 794, height: 1123 };
export const A4_PT = { width: 595.28, height: 841.89 };

const DEFAULTS = {
  fontSize: 14,
  color: '#1c1e21',
  align: 'left',
};

// Only fetch each referenced image once per render.
async function loadImage(url, cache) {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url);
  let buf = null;
  try {
    if (url.startsWith('data:')) {
      buf = Buffer.from(url.replace(/^data:[^;]+;base64,/, ''), 'base64');
    } else {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxContentLength: 10 * 1024 * 1024,
      });
      buf = Buffer.from(res.data);
    }
  } catch (err) {
    logger.warn('pdf image fetch failed', { url, error: err.message });
    buf = null;
  }
  cache.set(url, buf);
  return buf;
}

const fontFor = (el) => {
  if (el.bold && el.italic) return 'Helvetica-BoldOblique';
  if (el.bold) return 'Helvetica-Bold';
  if (el.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
};

// Characters the built-in Helvetica can't draw, with readable stand-ins. We use
// pdfkit's standard fonts (no embedded font file), which are limited to WinAnsi
// — so a rupee sign or a box-drawing rule from a WhatsApp message body would
// either throw or come out as rubbish. Chat text and documents share the same
// {{tokens}}, so this has to be handled rather than avoided.
const CHAR_SUBS = [
  [/\u20B9/g, 'Rs.'], // ₹
  [/[\u2500-\u257F]/g, '-'], // box drawing, e.g. the ━ payment rule
  [/[\u2022\u2023\u25CF\u25AA]/g, '\u00b7'], // bullets → middle dot
  [/\u20AC/g, 'EUR'], // € is in WinAnsi, but spell it out for safety
  [/[\u2018\u2019\u201A]/g, "'"],
  [/[\u201C\u201D\u201E]/g, '"'],
  [/[\u2012\u2013\u2014\u2015]/g, '-'],
  [/\u2026/g, '...'],
  [/\u00D7/g, 'x'],
];

/**
 * Make text safe for the standard PDF fonts.
 * Known characters are swapped for equivalents; anything else outside Latin-1
 * (emoji, Devanagari, Telugu…) is dropped rather than left to break the render.
 */
function pdfSafe(text) {
  let out = String(text || '');
  for (const [re, to] of CHAR_SUBS) out = out.replace(re, to);
  // eslint-disable-next-line no-control-regex
  return out.replace(/[^\u0000-\u00FF]/g, '');
}

/**
 * Render a template into a PDF buffer.
 * @param {object} template { width, height, background, elements[] }
 * @param {object} tokens   live values for {{…}} substitution
 */
export async function renderPdfBuffer(template = {}, tokens = {}) {
  const W = Number(template.width) || A4_PX.width;
  const H = Number(template.height) || A4_PX.height;
  // Map the designer's pixel grid onto an exact A4 page.
  const sx = A4_PT.width / W;
  const sy = A4_PT.height / H;
  const px = (v) => Number(v || 0) * sx; // horizontal (and font sizes)
  const py = (v) => Number(v || 0) * sy; // vertical
  const elements = Array.isArray(template.elements) ? template.elements : [];
  const imgCache = new Map();

  // Pre-load images before we start streaming the document.
  for (const el of elements) {
    if (el.type === 'image' && el.src) await loadImage(el.src, imgCache);
  }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Page background
      if (template.background && template.background !== '#ffffff') {
        doc.rect(0, 0, A4_PT.width, A4_PT.height).fill(template.background);
      }

      for (const el of elements) {
        const x = px(el.x);
        const y = py(el.y);
        const w = el.w ? px(el.w) : undefined;
        const h = el.h ? py(el.h) : undefined;

        switch (el.type) {
          case 'box': {
            doc.save();
            const r = Number(el.radius) || 0;
            if (r > 0) doc.roundedRect(x, y, w || 0, h || 0, px(r));
            else doc.rect(x, y, w || 0, h || 0);
            if (el.fill && el.fill !== 'none') doc.fillColor(el.fill).fill();
            else if (el.stroke) doc.strokeColor(el.stroke).lineWidth(px(el.thickness || 1)).stroke();
            doc.restore();
            break;
          }
          case 'line': {
            doc.save()
              .moveTo(x, y)
              .lineTo(x + (w || 0), y)
              .strokeColor(el.color || '#d9dee3')
              .lineWidth(py(el.thickness || 1))
              .stroke()
              .restore();
            break;
          }
          case 'image': {
            const buf = imgCache.get(el.src);
            if (!buf) break;
            try {
              doc.image(buf, x, y, {
                ...(w ? { width: w } : {}),
                ...(h ? { height: h } : {}),
              });
            } catch (err) {
              logger.warn('pdf image draw failed', { error: err.message });
            }
            break;
          }
          case 'text':
          default: {
            // Live values are substituted here — this is what makes the same
            // template work across businesses and flows.
            const value = pdfSafe(fillTokens(el.text || '', tokens));
            if (!value) break;
            doc.save()
              .font(fontFor(el))
              .fontSize(px(Number(el.fontSize) || DEFAULTS.fontSize))
              .fillColor(el.color || DEFAULTS.color)
              .text(value, x, y, {
                width: w || A4_PT.width - x - px(32),
                align: el.align || DEFAULTS.align,
                lineGap: py(Number(el.lineGap) || 2),
              })
              .restore();
            break;
          }
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

const slugName = (s) =>
  String(s || 'document').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'document';

/**
 * Render a block's PDF template and host it, returning { url, filename }.
 * Returns null when the block has nothing to render.
 */
export async function renderBlockPdf(block, tokens = {}, businessId = '') {
  const template = block?.pdfTemplate;
  if (!template || !Array.isArray(template.elements) || template.elements.length === 0) return null;
  try {
    const buffer = await renderPdfBuffer(template, tokens);
    const url = await storage.uploadBuffer(buffer, mediaFolder(businessId, 'documents'), 'raw');
    // Give the customer a meaningful filename, e.g. "Cancellation-DVN-B2C-1AA1F8.pdf".
    const base = fillTokens(block.pdfFileName || 'document-{{order_id}}', tokens) || 'document';
    const filename = `${slugName(base)}.pdf`;
    logger.info('pdf generated', { filename, kb: Math.round(buffer.length / 1024) });
    return { url, filename };
  } catch (err) {
    logger.warn('pdf render failed', { error: err.message });
    return null;
  }
}

export { pdfSafe };
export default { renderPdfBuffer, renderBlockPdf, pdfSafe, A4_PX };
