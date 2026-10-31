// ---------------------------------------------------------------------------
// Screen identifiers
//
// Meta's Flow JSON validator only accepts letters and underscores in a screen
// id — digits are rejected, and the same id appears in `routing_model` (as both
// a key and a navigation target), so one "SCREEN_2" produces several errors:
//
//   Property 'WELCOME/0' should only consist of alphabets and underscores.
//   'SCREEN_2' should only consist of alphabets and underscores.
//   Property 'id' should only consist of alphabets and underscores.
//
// (Verified against the live validator: component `name`s and option `id`s may
// contain digits, only screen ids may not.)
//
// Digits are spelled out rather than stripped, because stripping would collapse
// SCREEN_2 / SCREEN_3 into the same id and silently merge two screens.
// ---------------------------------------------------------------------------

const DIGIT_WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const MAX_LEN = 40;

/** A Meta-legal screen id: uppercase letters and underscores only. */
export function legalScreenId(raw) {
  const id = String(raw || '')
    .toUpperCase()
    .replace(/\d/g, (d) => `_${DIGIT_WORDS[Number(d)]}_`)
    .replace(/[^A-Z_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, MAX_LEN)
    .replace(/_+$/, '');
  return id || 'SCREEN';
}

/** `base`, suffixed with letters (…_B, …_C) until it isn't in `taken`. */
function uniqueId(taken, base) {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  const letters = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; ; i++) {
    const suffix = letters[i % letters.length].repeat(Math.floor(i / letters.length) + 1);
    const id = `${base.slice(0, MAX_LEN - suffix.length - 1)}_${suffix}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

const remapNode = (nodeId, rename) =>
  typeof nodeId === 'string' && nodeId.startsWith('screen_')
    ? `screen_${rename(nodeId.slice('screen_'.length))}`
    : nodeId;

/**
 * Rewrite every screen id in a flow definition to a Meta-legal form, carrying
 * all references with it so navigation keeps working: footer and per-option
 * `nextScreen`, block targets, the Start node's `entryTarget` and the saved map
 * layout keys.
 *
 * Mutates `flow` in place (a plain object — call on `doc.toObject()`).
 * @returns {{ changed: boolean, renames: Record<string,string> }}
 */
export function normalizeScreenIds(flow) {
  const screens = Array.isArray(flow?.screens) ? flow.screens : [];
  if (!screens.length) return { changed: false, renames: {} };

  const taken = new Set();
  const renames = {};
  for (const s of screens) {
    const before = String(s.id || '');
    const after = uniqueId(taken, legalScreenId(before));
    if (after !== before) renames[before] = after;
    s.id = after;
  }
  if (!Object.keys(renames).length) return { changed: false, renames };

  const rename = (id) => (id && Object.prototype.hasOwnProperty.call(renames, id) ? renames[id] : id);
  const node = (id) => remapNode(id, rename);

  for (const s of screens) {
    for (const c of s.components || []) {
      if (c.nextScreen) c.nextScreen = rename(c.nextScreen);
      for (const o of c.options || []) if (o.nextScreen) o.nextScreen = rename(o.nextScreen);
    }
  }
  for (const b of flow.blocks || []) {
    if (b.validTarget) b.validTarget = node(b.validTarget);
    if (b.invalidTarget) b.invalidTarget = node(b.invalidTarget);
    if (b.nextTarget) b.nextTarget = node(b.nextTarget);
    if (Array.isArray(b.buttonTargets)) b.buttonTargets = b.buttonTargets.map(node);
  }
  if (flow.entryTarget) flow.entryTarget = node(flow.entryTarget);
  if (flow.positions && typeof flow.positions === 'object') {
    const moved = {};
    for (const [key, value] of Object.entries(flow.positions)) moved[node(key)] = value;
    flow.positions = moved;
  }
  return { changed: true, renames };
}

export default { legalScreenId, normalizeScreenIds };
