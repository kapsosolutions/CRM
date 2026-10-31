// ---------------------------------------------------------------------------
// What a sent template actually looked like, for the CRM chat.
//
// Meta's send payload only names the template and lists parameter values, so
// the chat used to show "Template: demo_offer". This rebuilds the message the
// customer saw — header, body with its {{n}} filled in, footer, buttons, and a
// carousel's cards or an offer's code — from the template's components plus
// the values that went out with it.
// ---------------------------------------------------------------------------

const VAR = /\{\{\s*(\d+)\s*\}\}/g;

/** Body text with each {{n}} replaced by the value sent for it. */
export function fillPlaceholders(text, params = []) {
  return String(text || '').replace(VAR, (m, n) => {
    const v = params[Number(n) - 1];
    return v === undefined || v === null || v === '' ? m : String(v);
  });
}

/** Meta button → the chat card's button shape ({ text, kind, url }). */
function chatButton(b) {
  const type = String(b?.type || '').toUpperCase();
  if (type === 'URL') return { text: b.text || 'Open', kind: 'cta', url: b.url || '' };
  if (type === 'PHONE_NUMBER') return { text: b.text || 'Call', kind: 'call', url: b.phone_number || b.phone || '' };
  if (type === 'COPY_CODE') return { text: 'Copy code', kind: 'copy' };
  // Authentication templates: our stored create shape (OTP), or Meta's copy
  // where the OTP button became a URL button pointing at its otp link.
  if (type === 'OTP' || (type === 'URL' && /\/otp\//.test(String(b.url || '')))) {
    return { text: b.text || 'Copy code', kind: 'copy' };
  }
  if (type === 'CATALOG' || type === 'MPM') return { text: b.text || 'View catalog', kind: 'catalog' };
  if (type === 'FLOW') return { text: b.text || 'Open', kind: 'flow' };
  return { text: b.text || 'Reply', kind: 'reply' };
}

const findComp = (comps, type) => (comps || []).find((c) => String(c?.type).toUpperCase() === type);

/**
 * @param {object} template  our stored Template, or Meta's template object
 *                           (anything with `components`)
 * @param {object} sent      what went out: { bodyParams, lto: { code, expiresAtMs } }
 * @returns {object|null} { header, body, footer, buttons, cards?, lto? }
 */
export function renderTemplate(template, sent = {}) {
  const comps = template?.components;
  if (!Array.isArray(comps) || !comps.length) return null;
  const params = Array.isArray(sent.bodyParams) ? sent.bodyParams : [];

  const h = findComp(comps, 'HEADER');
  const fmt = String(h?.format || '').toUpperCase();
  let header = null;
  if (fmt === 'TEXT' && h?.text) header = { format: 'text', text: h.text };
  else if (fmt === 'IMAGE' || fmt === 'VIDEO' || fmt === 'DOCUMENT') {
    header = {
      format: fmt.toLowerCase(),
      // Our stored copy; Meta's own example link expires, so it's only a fallback.
      url: template.headerMediaUrl || h?.example?.header_handle?.[0] || '',
      ...(fmt === 'DOCUMENT' ? { fileName: template.headerFileName || 'Document.pdf' } : {}),
    };
  }

  const out = {
    name: template.name || '',
    header,
    body: fillPlaceholders(findComp(comps, 'BODY')?.text || template.bodyText || '', params),
    // Authentication templates store no footer text (Meta writes it); our row keeps the wording.
    footer: findComp(comps, 'FOOTER')?.text || template.footerText || '',
    buttons: (findComp(comps, 'BUTTONS')?.buttons || []).map(chatButton),
  };

  // Carousel: card media comes from our stored copies, in order.
  const carousel = findComp(comps, 'CAROUSEL');
  if (carousel?.cards?.length) {
    out.cards = carousel.cards.map((card, i) => {
      const cc = card.components || [];
      const ch = findComp(cc, 'HEADER');
      const stored = template.cards?.[i];
      return {
        mediaUrl: stored?.mediaUrl || ch?.example?.header_handle?.[0] || '',
        mediaFormat: String(ch?.format || stored?.mediaFormat || 'image').toLowerCase() === 'video' ? 'video' : 'image',
        body: findComp(cc, 'BODY')?.text || stored?.body || '',
        buttons: (findComp(cc, 'BUTTONS')?.buttons || []).map(chatButton),
      };
    });
  }

  // Limited-time offer: the label from the template, the code and end time
  // from this particular send.
  const offer = findComp(comps, 'LIMITED_TIME_OFFER');
  if (offer) {
    out.lto = {
      text: offer.limited_time_offer?.text || template.lto?.text || 'Offer',
      code: sent.lto?.code || '',
      expiresAtMs: sent.lto?.expiresAtMs || null,
    };
  }
  return out;
}

/** One line for the chat list ("hi Riya, your order…" rather than the name). */
export function renderedPreview(r, fallbackName = '') {
  const text = (r?.body || r?.header?.text || '').replace(/\s+/g, ' ').trim();
  return text || (fallbackName ? `[template] ${fallbackName}` : '[template]');
}

export default { renderTemplate, renderedPreview, fillPlaceholders };
