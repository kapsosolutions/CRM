// Meta's template rejection codes, in plain words with what to do about them.
const REASONS: Record<string, { title: string; fix: string }> = {
  INCORRECT_CATEGORY: {
    title: 'Content doesn’t match the category',
    fix: 'WhatsApp reviewed the wording and decided it isn’t a real Marketing message (or isn’t Utility). Write it as a genuine promotion: say what you’re offering and why the customer should tap.',
  },
  INVALID_FORMAT: {
    title: 'Formatting problem',
    fix: 'Check the {{1}} variables (numbered in order, not at the very start or end), the button links and the media.',
  },
  ABUSIVE_CONTENT: {
    title: 'Against WhatsApp’s content rules',
    fix: 'Remove anything threatening, misleading or offensive.',
  },
  SCAM: {
    title: 'Looks like a scam',
    fix: 'Avoid urgent money requests, suspicious links and “confirm your number”-style wording.',
  },
  PROMOTIONAL: {
    title: 'Promotional content in a Utility template',
    fix: 'Pick the Marketing category, or remove the promotional wording.',
  },
  TAG_CONTENT_MISMATCH: {
    title: 'Content doesn’t match the category',
    fix: 'Pick the category that fits the message, or reword it.',
  },
};

export function templateReason(code?: string): { title: string; fix: string } | null {
  if (!code || code === 'NONE') return null;
  return REASONS[code] || { title: code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), fix: '' };
}
