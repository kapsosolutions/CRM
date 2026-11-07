/**
 * A link target that is safe to put in href: http(s), mailto and tel only.
 * Anything else (javascript:, data:, vbscript:, a typo) becomes undefined, so
 * the link renders without a target instead of running script when clicked.
 */
export function safeUrl(url: unknown): string | undefined {
  const s = String(url ?? '').trim();
  if (!s) return undefined;
  try {
    const u = new URL(s, window.location.origin);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(u.protocol) ? s : undefined;
  } catch {
    return undefined;
  }
}
