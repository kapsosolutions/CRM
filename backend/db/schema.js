// ---------------------------------------------------------------------------
// A small Mongoose-compatible schema description for the Postgres data layer.
//
// The model files keep their Mongoose-style definitions (`{ type: String,
// default: '' }`, nested objects, arrays of sub-schemas) so the migration from
// MongoDB didn't have to touch what each field means. This module turns those
// definitions into a tree that knows how to:
//   • cast incoming values (strict: unknown keys are dropped, like Mongoose),
//   • apply defaults (on create, and on hydrate for non-lean documents),
//   • revive Dates stored inside JSON columns,
//   • validate `required` / `enum`,
// and tells the DDL layer which fields are plain columns and which are JSONB.
// ---------------------------------------------------------------------------
import crypto from 'crypto';

/** Sentinels standing in for mongoose.Schema.Types.* */
export const Types = {
  ObjectId: function ObjectId() {},
  Mixed: function Mixed() {},
};

/**
 * 24-hex ids shaped like Mongo ObjectIds: 4 bytes of seconds + 8 random bytes.
 * Migrated rows keep their original ids, and code elsewhere relies on the
 * 24-hex shape (flow tokens, slot ids), so new rows use the same format —
 * which also keeps them roughly time-ordered.
 */
export function newId() {
  const ts = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  return ts + crypto.randomBytes(8).toString('hex');
}

export class Schema {
  constructor(definition, options = {}) {
    this.definition = definition;
    this.options = options;
    this.methods = {};
    this.statics = {};
    this.indexes = []; // [{ fields: {a:1,b:-1}, options }]
    this.tree = parseObject(definition, false);
  }

  index(fields, options = {}) {
    this.indexes.push({ fields, options });
    return this;
  }
}
Schema.Types = Types;

// ----------------------------------------------------------------- parsing --

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) &&
  !(v instanceof Schema) && Object.getPrototypeOf(v) === Object.prototype;

function scalarType(t) {
  if (t === String || t === 'String') return 'string';
  if (t === Number || t === 'Number') return 'number';
  if (t === Boolean || t === 'Boolean') return 'boolean';
  if (t === Date || t === 'Date') return 'date';
  if (t === Types.ObjectId || t === 'ObjectId') return 'objectid';
  if (t === Types.Mixed || t === Object || t === 'Mixed') return 'mixed';
  return null;
}

/** Is `def` a field spec (`{ type: X, ... }`) rather than a nested object? */
function isSpec(def) {
  if (!isPlainObject(def) || !('type' in def)) return false;
  const t = def.type;
  return typeof t === 'function' || typeof t === 'string' || Array.isArray(t) || t instanceof Schema;
}

/** Parse an object of fields. `inArray` = these are sub-documents of an array. */
function parseObject(def, inArray) {
  const children = {};
  for (const [k, v] of Object.entries(def)) {
    if (k === '_id') continue;
    children[k] = parseNode(v);
  }
  return {
    kind: inArray ? 'subdoc' : 'nested',
    children,
    _id: inArray ? def._id !== false : false,
  };
}

function parseNode(def) {
  if (def instanceof Schema) {
    return { ...def.tree, kind: 'subdoc', _id: def.options._id !== false };
  }
  if (Array.isArray(def)) return arrayNode(def[0], {});
  if (typeof def === 'function' || typeof def === 'string') {
    return { kind: 'scalar', type: scalarType(def) || 'mixed', opts: {} };
  }
  if (isSpec(def)) {
    const { type, ...opts } = def;
    if (Array.isArray(type)) return arrayNode(type[0], opts);
    if (type instanceof Schema) return { ...parseNode(type), opts };
    return { kind: 'scalar', type: scalarType(type) || 'mixed', opts };
  }
  if (isPlainObject(def)) {
    // `{}` is Mongoose's shorthand for Mixed.
    if (!Object.keys(def).length) return { kind: 'scalar', type: 'mixed', opts: {} };
    return { ...parseObject(def, false), opts: {} };
  }
  return { kind: 'scalar', type: 'mixed', opts: {} };
}

function arrayNode(elDef, opts) {
  let of;
  if (elDef === undefined) of = { kind: 'scalar', type: 'mixed', opts: {} };
  else if (elDef instanceof Schema) of = parseNode(elDef);
  else if (isPlainObject(elDef) && !isSpec(elDef)) of = parseObject(elDef, true);
  else of = parseNode(elDef);
  return { kind: 'array', of, opts };
}

/** The SQL storage class for a top-level node. */
export function columnKind(node) {
  if (node.kind !== 'scalar') return 'json';
  switch (node.type) {
    case 'string': case 'objectid': return 'text';
    case 'number': return 'num';
    case 'boolean': return 'bool';
    case 'date': return 'date';
    default: return 'json';
  }
}

// Objects / arrays are stored as `json`, not `jsonb`: jsonb re-sorts object
// keys, while Mongo (and the CRM — e.g. form answers listed in the order they
// were asked) keeps them in insertion order. Queries cast to jsonb as needed.
export const SQL_TYPE = { text: 'text', num: 'double precision', bool: 'boolean', date: 'timestamptz', json: 'json' };

/** Find the node for a dotted path below a top-level node (null if unknown). */
export function nodeAt(node, parts) {
  let n = node;
  for (const p of parts) {
    if (!n) return null;
    if (n.kind === 'array') {
      if (/^\d+$/.test(p) || p === '$') { n = n.of; continue; }
      n = n.of;
    }
    if (n.kind === 'nested' || n.kind === 'subdoc') { n = n.children[p] || null; continue; }
    return null;
  }
  return n;
}

// ----------------------------------------------------------------- casting --

export class CastError extends Error {
  constructor(type, value, path) {
    super(`Cast to ${type} failed for value "${typeof value === 'object' ? JSON.stringify(value) : value}" at path "${path}"`);
    this.name = 'CastError';
    this.kind = type;
    this.path = path;
    this.value = value;
  }
}

export function castScalar(type, v, path = '') {
  if (v === null || v === undefined) return v;
  switch (type) {
    case 'string':
      if (typeof v === 'string') return v;
      if (typeof v === 'object' && !(v instanceof Date) && typeof v.toString !== 'function') throw new CastError('string', v, path);
      if (Array.isArray(v) || (isPlainObject(v))) throw new CastError('string', v, path);
      return String(v);
    case 'objectid':
      if (typeof v === 'string') return v;
      if (typeof v === 'object' && v._id !== undefined && !(typeof v.toHexString === 'function')) return String(v._id);
      return String(v);
    case 'number': {
      if (typeof v === 'number') { if (Number.isNaN(v)) throw new CastError('Number', v, path); return v; }
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'string' && v.trim() === '') return null;
      const n = Number(v);
      if (Number.isNaN(n)) throw new CastError('Number', v, path);
      return n;
    }
    case 'boolean':
      if (typeof v === 'boolean') return v;
      if (v === 'true' || v === 1 || v === '1' || v === 'yes') return true;
      if (v === 'false' || v === 0 || v === '0' || v === 'no') return false;
      throw new CastError('Boolean', v, path);
    case 'date': {
      if (v instanceof Date) { if (Number.isNaN(v.getTime())) throw new CastError('date', v, path); return v; }
      if (v === '') return null;
      const d = new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
      if (Number.isNaN(d.getTime())) throw new CastError('date', v, path);
      return d;
    }
    default:
      return v; // mixed: stored verbatim
  }
}

function defaultOf(node) {
  const d = node.opts?.default;
  if (d === undefined) {
    if (node.kind === 'array') return [];
    if (node.kind === 'nested') return castNode(node, {}, '', { defaults: true });
    return undefined;
  }
  const v = typeof d === 'function' ? d() : d;
  if (v === Date.now) return new Date();
  return castNode(node, v, '', { defaults: true, lenient: true });
}

/**
 * Cast a value against a node.
 * opts.defaults — fill missing fields with their defaults
 * opts.newIds   — give array sub-documents without an _id a fresh one
 * opts.lenient  — never throw (hydrating stored data)
 */
export function castNode(node, v, path, opts = {}) {
  if (v === undefined) return opts.defaults ? defaultOf(node) : undefined;
  if (v === null) return null;
  try {
    switch (node.kind) {
      case 'scalar':
        if (node.type === 'mixed') return v;
        if (node.type === 'date' && opts.lenient && typeof v === 'string') {
          const d = new Date(v);
          return Number.isNaN(d.getTime()) ? v : d;
        }
        return castScalar(node.type, v, path);
      case 'array': {
        const list = Array.isArray(v) ? v : [v];
        return list.map((el, i) => castNode(node.of, el, `${path}.${i}`, { ...opts, defaults: opts.defaults && node.of.kind !== 'scalar' }));
      }
      case 'nested':
      case 'subdoc': {
        if (typeof v !== 'object' || Array.isArray(v)) {
          if (opts.lenient) return v;
          throw new CastError('Embedded', v, path);
        }
        const out = {};
        if (node.kind === 'subdoc' && node._id) {
          if (v._id !== undefined && v._id !== null) out._id = String(v._id);
          else if (opts.newIds) out._id = newId();
        }
        for (const [k, child] of Object.entries(node.children)) {
          const c = castNode(child, v[k], path ? `${path}.${k}` : k, opts);
          if (c !== undefined) out[k] = c;
        }
        return out;
      }
      default:
        return v;
    }
  } catch (err) {
    if (opts.lenient) return v;
    throw err;
  }
}

// -------------------------------------------------------------- validation --

export class ValidationError extends Error {
  constructor(modelName, errors) {
    const parts = Object.entries(errors).map(([p, e]) => `${p}: ${e.message}`);
    super(`${modelName} validation failed: ${parts.join(', ')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/** Collect required / enum violations for `value` under `node`. */
export function validateNode(node, value, path, errors) {
  const o = node.opts || {};
  if (node.kind === 'scalar') {
    const missing = value === undefined || value === null || (node.type === 'string' && value === '');
    if (o.required && missing) {
      errors[path] = { message: `Path \`${path}\` is required.`, kind: 'required', path };
      return;
    }
    if (o.enum && value !== undefined && value !== null) {
      const allowed = Array.isArray(o.enum) ? o.enum : o.enum.values || [];
      if (!allowed.includes(value)) {
        errors[path] = { message: `\`${value}\` is not a valid enum value for path \`${path}\`.`, kind: 'enum', path };
      }
    }
    return;
  }
  if (node.kind === 'array') {
    if (Array.isArray(value)) value.forEach((el, i) => validateNode(node.of, el, `${path}.${i}`, errors));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, child] of Object.entries(node.children)) validateNode(child, value[k], `${path}.${k}`, errors);
  }
}

export default { Schema, Types, newId, castNode, castScalar, validateNode, columnKind, nodeAt, SQL_TYPE, CastError, ValidationError };
