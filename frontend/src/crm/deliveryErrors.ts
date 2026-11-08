// Why WhatsApp didn't deliver a message, in plain words: Meta's error codes
// from the `failed` receipt (Message.error.code), for the chat's "Not
// delivered" line and the campaign results. Meta's own text stays in the tooltip.
const HINTS: Record<number, string> = {
  131049: 'WhatsApp held back this marketing message: it limits how many marketing messages each person gets. Wait a day or more before trying this contact again, or send a Utility template.',
  131050: 'This person has stopped marketing messages from your business on WhatsApp.',
  131026: 'This number can’t receive the message (not on WhatsApp, an old WhatsApp version, or it hasn’t accepted WhatsApp’s latest terms).',
  131047: 'More than 24 hours since this person last messaged you: only an approved template can be sent.',
  131056: 'Too many messages to this person in a short time. Wait a little before sending again.',
  131021: 'You can’t message your own business number.',
  130472: 'Meta held this marketing message back as part of a WhatsApp experiment for this person.',
  131042: 'Your WhatsApp account has a payment problem. Check the payment method in Meta Business Settings.',
  132000: 'The template’s values don’t match it (a variable is missing or extra).',
  132001: 'This template isn’t available in that language, or isn’t approved yet.',
};

/** The plain explanation for a Meta delivery error code, or '' when we have none. */
export function deliveryHint(code?: number | string | null): string {
  const n = Number(code);
  return Number.isFinite(n) ? HINTS[n] || '' : '';
}
