// Meta's per-message WhatsApp rates for India, used by the pricing guide and
// the cost calculator. Meta bills these to the business's own WhatsApp
// account; they are not part of our plans. Check them against Meta's rate
// card (SOURCE) whenever Meta announces a change (usually 1 Jan / Apr / Jul / Oct).
export const META_RATES = {
  /** When this card took effect, as shown on the pages. */
  asOf: '1 October 2026',
  marketing: 0.8631,
  utility: 0.115,
  authentication: 0.115,
  /** Service messages (replies in the 24-hour window), after the free ones. */
  service: 0.115,
  /** Free service messages per business phone number per month. */
  freeService: 1000,
  gst: 0.18,
  source: 'https://developers.facebook.com/docs/whatsapp/pricing',
} as const;

export const inrRate = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
