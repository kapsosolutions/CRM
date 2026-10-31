// ---------------------------------------------------------------------------
// Mongoose-compatible models on top of Postgres (Supabase).
//
// The CRM was written against Mongoose — ~270 call sites of find / findOne /
// updateOne / findOneAndUpdate / save with Mongo-style filters and update
// operators. Rewriting every one of them as SQL would have been a large,
// risky change for no behavioural gain, so instead each model keeps the same
// API and this module translates it:
//
//   • every top-level field is a real, typed column (snake_case) — strings are
//     text, numbers double precision, booleans boolean, Dates timestamptz, and
//     nested objects / arrays / Mixed values jsonb — so the tables read
//     naturally in the Supabase dashboard;
//   • filters compile to SQL WHERE clauses ($eq $ne $in $nin $gt $gte $lt $lte
//     $exists $regex $or $and $nor $not, dotted paths into jsonb via jsonpath,
//     which also matches inside arrays the way Mongo does);
//   • updates compile to a single UPDATE where possible ($set / $unset / $inc
//     / $push on columns and one level into jsonb), and otherwise run as a
//     read-modify-write inside a transaction with the row locked;
//   • documents are plain objects carrying non-enumerable save() / toObject()
//     and the schema's methods, so `doc.x = 1; await doc.save()` still works.
//
// Only what the codebase actually uses is implemented; anything else throws
// loudly rather than silently doing the wrong thing.
// ---------------------------------------------------------------------------
import { query, withTransaction } from './pool.js';
import {
  Schema, castNode, castScalar, validateNode, columnKind, nodeAt, SQL_TYPE, newId,
  ValidationError, CastError,
} from './schema.js';

export const registry = [];

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const qi = (s) => `"${String(s).replace(/"/g, '""')}"`;
const isPlainObject = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};
const isOperatorObject = (v) =>
  isPlainObject(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => k.startsWith('$'));
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const SNAPSHOT = new WeakMap();

class Params {
  constructor() { this.values = []; }
  add(v, cast) {
    this.values.push(v);
    return `$${this.values.length}${cast ? `::${cast}` : ''}`;
  }
}

// ------------------------------------------------------------- jsonpath --

function jsonPathLiteral(parts) {
  let s = 'lax $';
  for (const p of parts) {
    if (/^\d+$/.test(p)) s += `[${p}]`;
    else s += `."${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** A value as it is stored inside jsonb (Dates become ISO strings). */
const toJsonValue = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

// ------------------------------------------------------------------ model --

class ModelMeta {
  constructor(name, schema, table) {
    this.name = name;
    this.schema = schema;
    this.table = table;
    this.timestamps = !!schema.options.timestamps;
    this.fields = new Map(); // fieldName -> { name, col, node, kind }
    this.byCol = new Map();
    const add = (name, col, node) => {
      const f = { name, col, node, kind: columnKind(node) };
      this.fields.set(name, f);
      this.byCol.set(col, f);
      return f;
    };
    this.idField = add('_id', 'id', { kind: 'scalar', type: 'objectid', opts: {} });
    if (this.timestamps) {
      add('createdAt', 'created_at', { kind: 'scalar', type: 'date', opts: {} });
      add('updatedAt', 'updated_at', { kind: 'scalar', type: 'date', opts: {} });
    }
    for (const [k, node] of Object.entries(schema.tree.children)) {
      if (k === 'createdAt' || k === 'updatedAt') continue;
      add(k, snake(k), node);
    }
    // Fields the application owns (everything except id + timestamps).
    this.dataFields = [...this.fields.values()].filter((f) => !['_id', 'createdAt', 'updatedAt'].includes(f.name));
  }

  colRef(f, alias) {
    return alias ? `${alias}.${qi(f.col)}` : qi(f.col);
  }

  /** Bind a top-level value as a typed parameter. */
  param(f, v, P) {
    if (v === null || v === undefined) return `NULL::${SQL_TYPE[f.kind]}`;
    if (f.kind === 'json') return P.add(JSON.stringify(v), 'json');
    return P.add(castScalar(f.node.type, v, f.name), SQL_TYPE[f.kind]);
  }

  // ------------------------------------------------------------ filters --

  compileFilter(filter, P, alias = '') {
    if (!filter || typeof filter !== 'object') return 'TRUE';
    const parts = [];
    for (const [key, val] of Object.entries(filter)) {
      if (key === '$or' || key === '$and' || key === '$nor') {
        const subs = (Array.isArray(val) ? val : []).map((f) => `(${this.compileFilter(f, P, alias)})`);
        if (key === '$and') parts.push(subs.length ? subs.join(' AND ') : 'TRUE');
        else if (key === '$or') parts.push(subs.length ? subs.join(' OR ') : 'FALSE');
        else parts.push(subs.length ? `NOT coalesce(${subs.join(' OR ')}, false)` : 'TRUE');
        continue;
      }
      if (key === '$comment') continue;
      if (key.startsWith('$')) throw new Error(`${key} is not supported by the Postgres model layer (${this.name})`);
      parts.push(this.compileField(key, val, P, alias));
    }
    return parts.length ? parts.map((p) => `(${p})`).join(' AND ') : 'TRUE';
  }

  compileField(key, val, P, alias) {
    const parts = key.split('.');
    const f = this.fields.get(parts[0]);
    const path = parts.slice(1);
    // A field the schema doesn't have can only ever be "missing".
    if (!f || (f.kind !== 'json' && path.length)) {
      const wantsMissing = val === null || val === undefined ||
        (isOperatorObject(val) && (val.$exists === false || val.$eq === null));
      return wantsMissing ? 'TRUE' : 'FALSE';
    }
    // Object columns are stored as json (key order preserved); query as jsonb.
    const col = f.kind === 'json' ? `(${this.colRef(f, alias)})::jsonb` : this.colRef(f, alias);
    if (val instanceof RegExp) return this.regexCond(f, col, path, val.source, val.flags, P);
    if (!isOperatorObject(val)) return this.eqCond(f, col, path, val, P);

    const conds = [];
    for (const [op, arg] of Object.entries(val)) {
      switch (op) {
        case '$eq': conds.push(this.eqCond(f, col, path, arg, P)); break;
        case '$ne': conds.push(this.neCond(f, col, path, arg, P)); break;
        case '$in': conds.push(this.inCond(f, col, path, arg, P)); break;
        case '$nin': conds.push(`NOT coalesce(${this.inCond(f, col, path, arg, P)}, false)`); break;
        case '$gt': case '$gte': case '$lt': case '$lte':
          conds.push(this.cmpCond(f, col, path, op, arg, P)); break;
        case '$exists': conds.push(this.existsCond(f, col, path, arg, P)); break;
        case '$regex': {
          const src = arg instanceof RegExp ? arg.source : String(arg);
          const flags = (arg instanceof RegExp ? arg.flags : '') + (val.$options || '');
          conds.push(this.regexCond(f, col, path, src, flags, P));
          break;
        }
        case '$options': break;
        case '$not': {
          const inner = arg instanceof RegExp
            ? this.regexCond(f, col, path, arg.source, arg.flags, P)
            : this.compileField(key, arg, P, alias);
          conds.push(`NOT coalesce(${inner}, false)`);
          break;
        }
        case '$all': {
          const list = Array.isArray(arg) ? arg : [arg];
          conds.push(list.length ? list.map((v) => `(${this.eqCond(f, col, path, v, P)})`).join(' AND ') : 'FALSE');
          break;
        }
        case '$size': {
          if (f.kind !== 'json') { conds.push('FALSE'); break; }
          const target = path.length ? `(${col} #> ${P.add(path, 'text[]')})` : col;
          conds.push(`(jsonb_typeof(${target}) = 'array' AND jsonb_array_length(${target}) = ${P.add(Number(arg), 'int')})`);
          break;
        }
        default:
          throw new Error(`Query operator ${op} is not supported by the Postgres model layer (${this.name}.${key})`);
      }
    }
    return conds.length ? conds.map((c) => `(${c})`).join(' AND ') : 'TRUE';
  }

  /** Cast a filter value for the field/path it is compared against. */
  castFor(f, path, v) {
    if (v === null || v === undefined) return v;
    if (!path.length && f.kind !== 'json') return castScalar(f.node.type, v, f.name);
    const node = path.length ? nodeAt(f.node, path) : f.node;
    let n = node;
    if (n && n.kind === 'array') n = n.of; // equality against an element
    if (n && n.kind === 'scalar' && n.type !== 'mixed' && !isPlainObject(v) && !Array.isArray(v)) {
      try { return castScalar(n.type, v, f.name); } catch { return v; }
    }
    return v;
  }

  jsonNullCond(col, path, P) {
    if (!path.length) return `(${col} IS NULL OR ${col} = 'null'::jsonb)`;
    const p = P.add(path, 'text[]');
    return `(${col} #> ${p} IS NULL OR ${col} #> ${p} = 'null'::jsonb)`;
  }

  /** jsonpath filter over the field (matches inside arrays, like Mongo). */
  jsonPathCond(col, path, predicate, vars, P) {
    const jp = `${jsonPathLiteral(path)} ? (${predicate})`;
    return `jsonb_path_exists(coalesce(${col}, 'null'::jsonb), ${P.add(jp, 'jsonpath')}, ${P.add(JSON.stringify(vars), 'jsonb')})`;
  }

  eqCond(f, col, path, raw, P) {
    if (f.kind !== 'json') {
      // A whole document passed where an id is expected (Mongoose casts it).
      if (f.node.type === 'objectid' && isPlainObject(raw) && raw._id !== undefined) raw = raw._id;
      if (raw === null || raw === undefined) return `${col} IS NULL`;
      if (Array.isArray(raw) || isPlainObject(raw)) return 'FALSE';
      return `${col} = ${this.param(f, raw, P)}`;
    }
    if (raw === null || raw === undefined) return this.jsonNullCond(col, path, P);
    const v = toJsonValue(this.castFor(f, path, raw));
    if (v !== null && typeof v === 'object') {
      // Whole-object / whole-array equality.
      const target = path.length ? `(${col} #> ${P.add(path, 'text[]')})` : col;
      return `coalesce(${target} = ${P.add(JSON.stringify(v), 'jsonb')}, false)`;
    }
    return this.jsonPathCond(col, path, '@ == $v', { v }, P);
  }

  neCond(f, col, path, raw, P) {
    if (f.kind !== 'json') {
      if (raw === null || raw === undefined) return `${col} IS NOT NULL`;
      return `${col} IS DISTINCT FROM ${this.param(f, raw, P)}`;
    }
    return `NOT coalesce(${this.eqCond(f, col, path, raw, P)}, false)`;
  }

  inCond(f, col, path, arg, P) {
    const list = Array.isArray(arg) ? arg : [arg];
    const hasNull = list.some((v) => v === null || v === undefined);
    const vals = list.filter((v) => v !== null && v !== undefined);
    const ors = [];
    if (f.kind !== 'json') {
      if (vals.length) {
        const cast = vals.map((v) => castScalar(f.node.type, v, f.name));
        ors.push(`coalesce(${col} = ANY(${P.add(cast, `${SQL_TYPE[f.kind]}[]`)}), false)`);
      }
      if (hasNull) ors.push(`${col} IS NULL`);
    } else {
      const scalars = [];
      for (const raw of vals) {
        const v = toJsonValue(this.castFor(f, path, raw));
        if (v !== null && typeof v === 'object') ors.push(this.eqCond(f, col, path, raw, P));
        else scalars.push(v);
      }
      if (scalars.length) {
        const vars = {};
        const pred = scalars.map((v, i) => { vars[`v${i}`] = v; return `@ == $v${i}`; }).join(' || ');
        ors.push(this.jsonPathCond(col, path, pred, vars, P));
      }
      if (hasNull) ors.push(this.jsonNullCond(col, path, P));
    }
    return ors.length ? `(${ors.join(' OR ')})` : 'FALSE';
  }

  cmpCond(f, col, path, op, raw, P) {
    const sqlOp = { $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' }[op];
    if (raw === null || raw === undefined) return 'FALSE';
    if (f.kind !== 'json') return `${col} ${sqlOp} ${this.param(f, raw, P)}`;
    const v = toJsonValue(this.castFor(f, path, raw));
    return this.jsonPathCond(col, path, `@ ${sqlOp} $v`, { v }, P);
  }

  existsCond(f, col, path, want, P) {
    let cond;
    if (!path.length) cond = `${col} IS NOT NULL`;
    else {
      const jp = jsonPathLiteral(path);
      cond = `jsonb_path_exists(coalesce(${col}, 'null'::jsonb), ${P.add(jp, 'jsonpath')})`;
    }
    return want ? cond : `NOT ${cond}`;
  }

  regexCond(f, col, path, source, flags, P) {
    const op = String(flags || '').includes('i') ? '~*' : '~';
    let target;
    if (f.kind === 'json') target = path.length ? `(${col} #>> ${P.add(path, 'text[]')})` : `(${col} #>> '{}')`;
    else target = f.kind === 'text' ? col : `${col}::text`;
    return `coalesce(${target} ${op} ${P.add(source, 'text')}, false)`;
  }

  // --------------------------------------------------- sort / projection --

  compileSort(sort, P) {
    if (!sort) return '';
    let entries = [];
    if (typeof sort === 'string') {
      entries = sort.split(/\s+/).filter(Boolean).map((t) => (t.startsWith('-') ? [t.slice(1), -1] : [t.replace(/^\+/, ''), 1]));
    } else entries = Object.entries(sort);
    const out = [];
    let firstDir = 'ASC';
    for (const [key, dirRaw] of entries) {
      const dir = (dirRaw === -1 || dirRaw === '-1' || /^desc/i.test(String(dirRaw))) ? 'DESC' : 'ASC';
      const parts = key.split('.');
      const f = this.fields.get(parts[0]);
      if (!f) continue;
      if (!out.length) firstDir = dir;
      const col = qi(f.col);
      const expr = parts.length > 1 && f.kind === 'json' ? `(${col}::jsonb #>> ${P.add(parts.slice(1), 'text[]')})` : col;
      out.push(`${expr} ${dir} ${dir === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST'}`);
      if (f.name === '_id') return ` ORDER BY ${out.join(', ')}`;
    }
    if (!out.length) return '';
    out.push(`"id" ${firstDir}`);
    return ` ORDER BY ${out.join(', ')}`;
  }

  /** Normalise a Mongoose projection into the set of top-level fields to return. */
  parseProjection(proj) {
    if (!proj) return null;
    let include = [];
    let exclude = [];
    if (typeof proj === 'string') {
      for (const t of proj.split(/\s+/).filter(Boolean)) {
        if (t.startsWith('-')) exclude.push(t.slice(1));
        else if (t.startsWith('+')) continue; // force-include select:false fields — none here
        else include.push(t);
      }
    } else if (Array.isArray(proj)) {
      include = proj.map(String);
    } else if (typeof proj === 'object') {
      for (const [k, v] of Object.entries(proj)) {
        if (v === 0 || v === false) exclude.push(k);
        else include.push(k);
      }
    }
    const top = (k) => k.split('.')[0];
    include = include.map(top);
    exclude = exclude.map(top);
    const all = [...this.fields.keys()];
    let fields;
    const idExcluded = exclude.includes('_id');
    if (include.filter((k) => k !== '_id').length) {
      fields = new Set(['_id', ...include.filter((k) => this.fields.has(k))]);
    } else if (exclude.length) {
      fields = new Set(all.filter((k) => !exclude.includes(k) || k === '_id'));
    } else return null;
    return { fields, idExcluded };
  }

  selectList(projection) {
    if (!projection) return '*';
    return [...projection.fields].map((k) => qi(this.fields.get(k).col)).join(', ');
  }

  // ---------------------------------------------------------- hydration --

  /** A DB row → plain object (lean shape: SQL NULL columns are omitted). */
  rowToObject(row, projection, { defaults = false } = {}) {
    const out = {};
    for (const [col, raw] of Object.entries(row)) {
      const f = this.byCol.get(col);
      if (!f) continue;
      if (projection && !projection.fields.has(f.name)) continue;
      if (f.name === '_id' && projection?.idExcluded) continue;
      if (raw === null) continue;
      out[f.name] = f.kind === 'json'
        ? castNode(f.node, raw, f.name, { lenient: true, defaults })
        : raw;
    }
    if (defaults) {
      for (const f of this.dataFields) {
        if (projection && !projection.fields.has(f.name)) continue;
        if (out[f.name] !== undefined) continue;
        const d = castNode(f.node, undefined, f.name, { defaults: true, lenient: true });
        if (d !== undefined) out[f.name] = d;
      }
    }
    return out;
  }

  // --------------------------------------------------------- insertion --

  /** Cast + default + validate a document for INSERT. */
  prepareInsert(raw, { validate = true } = {}) {
    const src = raw || {};
    const doc = {};
    const errors = {};
    for (const f of this.dataFields) {
      try {
        const v = castNode(f.node, src[f.name], f.name, { defaults: true, newIds: true });
        if (v !== undefined) doc[f.name] = v;
      } catch (err) {
        if (err instanceof CastError) errors[err.path || f.name] = { message: err.message, kind: 'cast', path: err.path || f.name };
        else throw err;
      }
      if (validate) validateNode(f.node, doc[f.name], f.name, errors);
    }
    if (Object.keys(errors).length) throw new ValidationError(this.name, errors);
    doc._id = src._id ? String(src._id) : newId();
    if (this.timestamps) {
      const now = new Date();
      doc.createdAt = src.createdAt ? castScalar('date', src.createdAt) : now;
      doc.updatedAt = src.updatedAt ? castScalar('date', src.updatedAt) : doc.createdAt;
    }
    return doc;
  }

  insertSql(docs, P) {
    const fields = [...this.fields.values()];
    const cols = fields.map((f) => qi(f.col)).join(', ');
    const rows = docs.map((d) => `(${fields.map((f) => this.param(f, d[f.name], P)).join(', ')})`);
    return `INSERT INTO ${qi(this.table)} (${cols}) VALUES ${rows.join(', ')} RETURNING *`;
  }

  // ------------------------------------------------------------ updates --

  /** `{ a: 1 }` → `{ $set: { a: 1 } }`; drops attempts to change _id. */
  normalizeUpdate(update) {
    if (Array.isArray(update)) throw new Error('Aggregation-pipeline updates are not supported');
    const out = {};
    for (const [k, v] of Object.entries(update || {})) {
      if (k.startsWith('$')) out[k] = { ...(out[k] || {}), ...v };
      else out.$set = { ...(out.$set || {}), [k]: v };
    }
    for (const op of Object.keys(out)) {
      if (out[op] && typeof out[op] === 'object') delete out[op]._id;
    }
    return out;
  }

  /**
   * Compile an update into SET clauses. Returns null when it needs the
   * read-modify-write path (deep paths, array operators on nested fields).
   */
  compileUpdateSets(upd, P, alias) {
    const top = new Map(); // col -> sql
    const jsonOps = new Map(); // field -> [{ op, key, sql }]
    const pushJson = (f, entry) => {
      if (!jsonOps.has(f)) jsonOps.set(f, []);
      jsonOps.get(f).push(entry);
    };
    const SIMPLE_KEY = /^[^.$\d][^.$]*$|^[^.$\d]$/;
    for (const [op, obj] of Object.entries(upd)) {
      if (op === '$setOnInsert') continue;
      for (const [key, val] of Object.entries(obj || {})) {
        const parts = key.split('.');
        const f = this.fields.get(parts[0]);
        if (!f || f.name === '_id') continue; // strict: unknown paths are dropped
        const ref = f.kind === 'json' ? `(${this.colRef(f, alias)})::jsonb` : this.colRef(f, alias);
        if (parts.length > 2 || (parts.length === 2 && (f.kind !== 'json' || !SIMPLE_KEY.test(parts[1])))) return null;
        switch (op) {
          case '$set': {
            if (val === undefined) break;
            if (parts.length === 1) {
              top.set(f.col, this.param(f, castNode(f.node, val, key, { newIds: true }), P));
            } else {
              const node = nodeAt(f.node, [parts[1]]);
              const v = node ? castNode(node, val, key, { newIds: true }) : val;
              pushJson(f, { op: 'set', key: parts[1], sql: P.add(JSON.stringify(v === undefined ? null : v), 'jsonb') });
            }
            break;
          }
          case '$unset':
            if (parts.length === 1) top.set(f.col, `NULL::${SQL_TYPE[f.kind]}`);
            else pushJson(f, { op: 'unset', key: parts[1] });
            break;
          case '$inc': {
            const n = Number(val);
            if (Number.isNaN(n)) throw new CastError('Number', val, key);
            if (parts.length === 1) {
              if (f.kind !== 'num') return null;
              top.set(f.col, `coalesce(${ref}, 0) + ${P.add(n, 'double precision')}`);
            } else {
              pushJson(f, {
                op: 'set',
                key: parts[1],
                sql: `to_jsonb(coalesce((${ref} ->> ${P.add(parts[1], 'text')})::double precision, 0) + ${P.add(n, 'double precision')})`,
              });
            }
            break;
          }
          case '$push': {
            if (parts.length !== 1 || f.kind !== 'json') return null;
            const each = isPlainObject(val) && Array.isArray(val.$each) ? val.$each : [val];
            if (isPlainObject(val) && Object.keys(val).some((k) => k.startsWith('$') && k !== '$each')) return null;
            const el = f.node.kind === 'array' ? f.node.of : null;
            const cast = each.map((v) => (el ? castNode(el, v, key, { defaults: el.kind !== 'scalar', newIds: true }) : v));
            top.set(f.col, `(coalesce(${ref}, '[]'::jsonb) || ${P.add(JSON.stringify(cast), 'jsonb')})::json`);
            break;
          }
          default:
            return null; // $addToSet, $pull, $min, $max, ... → JS path
        }
      }
    }
    for (const [f, ops] of jsonOps) {
      if (top.has(f.col)) continue; // whole-field set wins (Mongo would reject the conflict)
      const ref = `(${this.colRef(f, alias)})::jsonb`;
      let expr = `(CASE WHEN jsonb_typeof(${ref}) = 'object' THEN ${ref} ELSE '{}'::jsonb END)`;
      for (const o of ops) {
        if (o.op === 'set') expr = `jsonb_set(${expr}, ${P.add([o.key], 'text[]')}, ${o.sql}, true)`;
        else expr = `(${expr} - ${P.add(o.key, 'text')})`;
      }
      top.set(f.col, `(${expr})::json`);
    }
    if (this.timestamps && !top.has('updated_at')) top.set('updated_at', 'now()');
    return [...top.entries()].map(([col, sql]) => `${qi(col)} = ${sql}`);
  }
}

// --------------------------------------------- JS update application --

function getPath(obj, parts) {
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(obj, parts, value) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] === null || cur[p] === undefined || typeof cur[p] !== 'object') {
      cur[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function unsetPath(obj, parts) {
  const parent = getPath(obj, parts.slice(0, -1));
  if (parent && typeof parent === 'object') delete parent[parts[parts.length - 1]];
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Apply Mongo update operators to a plain object, in place. */
export function applyUpdate(doc, upd, { insert = false } = {}) {
  for (const [op, obj] of Object.entries(upd)) {
    for (const [key, val] of Object.entries(obj || {})) {
      const parts = key.split('.');
      switch (op) {
        case '$set': if (val !== undefined) setPath(doc, parts, clone(val)); break;
        case '$setOnInsert': if (insert && val !== undefined) setPath(doc, parts, clone(val)); break;
        case '$unset': unsetPath(doc, parts); break;
        case '$inc': setPath(doc, parts, (Number(getPath(doc, parts)) || 0) + Number(val)); break;
        case '$min': { const c = getPath(doc, parts); if (c === undefined || val < c) setPath(doc, parts, val); break; }
        case '$max': { const c = getPath(doc, parts); if (c === undefined || val > c) setPath(doc, parts, val); break; }
        case '$currentDate': setPath(doc, parts, new Date()); break;
        case '$push': case '$addToSet': {
          const each = isPlainObject(val) && Array.isArray(val.$each) ? val.$each : [val];
          const arr = Array.isArray(getPath(doc, parts)) ? getPath(doc, parts) : [];
          for (const v of each) {
            if (op === '$addToSet' && arr.some((x) => sameJson(x, v))) continue;
            arr.push(clone(v));
          }
          setPath(doc, parts, arr);
          break;
        }
        case '$pull': {
          const arr = getPath(doc, parts);
          if (Array.isArray(arr)) {
            const list = isPlainObject(val) && Array.isArray(val.$in) ? val.$in : [val];
            setPath(doc, parts, arr.filter((x) => !list.some((v) => sameJson(x, v))));
          }
          break;
        }
        default:
          throw new Error(`Update operator ${op} is not supported by the Postgres model layer`);
      }
    }
  }
  return doc;
}

/** Equality fields of a filter, used to seed an upserted document. */
function seedFromFilter(filter, doc = {}) {
  for (const [k, v] of Object.entries(filter || {})) {
    if (k === '$and' && Array.isArray(v)) { v.forEach((f) => seedFromFilter(f, doc)); continue; }
    if (k.startsWith('$')) continue;
    if (v instanceof RegExp) continue;
    if (isOperatorObject(v)) {
      if ('$eq' in v) setPath(doc, k.split('.'), clone(v.$eq));
      continue;
    }
    if (v === undefined) continue;
    setPath(doc, k.split('.'), clone(v));
  }
  return doc;
}

// ------------------------------------------------------------------ query --

class Query {
  constructor(model, op, { filter = {}, update, options = {}, projection, field } = {}) {
    this.model = model;
    this.op = op;
    this.filter = filter || {};
    this.update = update;
    this.options = { ...options };
    this.field = field;
    this._sort = options.sort;
    this._limit = options.limit;
    this._skip = options.skip;
    this._lean = !!options.lean;
    this._projection = projection ?? options.projection ?? options.select;
  }

  sort(s) { this._sort = s; return this; }
  limit(n) { this._limit = n; return this; }
  skip(n) { this._skip = n; return this; }
  select(p) { this._projection = p; return this; }
  lean(v = true) { this._lean = v !== false; return this; }
  where(f) { Object.assign(this.filter, f || {}); return this; }
  session() { return this; }
  populate() { throw new Error('populate() is not supported by the Postgres model layer'); }
  exec() { return this.model._exec(this); }
  then(res, rej) { return this.exec().then(res, rej); }
  catch(rej) { return this.exec().catch(rej); }
  finally(fn) { return this.exec().finally(fn); }
}

// ------------------------------------------------------------- the model --

export function defineModel(name, schema, table) {
  if (!(schema instanceof Schema)) throw new Error(`defineModel(${name}): expected a Schema`);
  const meta = new ModelMeta(name, schema, table);
  const T = qi(table);

  function hydrate(row, projection, lean) {
    if (!row) return null;
    if (lean) return meta.rowToObject(row, projection);
    const doc = meta.rowToObject(row, projection, { defaults: true });
    return makeDocument(doc, projection);
  }

  function makeDocument(doc, projection) {
    const props = {
      save: { value: () => saveDocument(doc), writable: true, configurable: true },
      toObject: { value: () => clone(doc), writable: true, configurable: true },
      toJSON: { value: () => clone(doc), writable: true, configurable: true },
      markModified: { value: () => {}, writable: true, configurable: true },
      isModified: {
        value: (p) => {
          const snap = SNAPSHOT.get(doc);
          if (!snap) return true;
          const keys = p ? [p.split('.')[0]] : [...snap.keys()];
          return keys.some((k) => JSON.stringify(doc[k]) !== snap.get(k));
        },
        writable: true,
        configurable: true,
      },
      get: { value: (p) => getPath(doc, String(p).split('.')), writable: true, configurable: true },
      set: {
        value: (p, v) => {
          if (isPlainObject(p)) Object.entries(p).forEach(([k, val]) => setPath(doc, k.split('.'), val));
          else setPath(doc, String(p).split('.'), v);
          return doc;
        },
        writable: true,
        configurable: true,
      },
      deleteOne: {
        value: async () => {
          await query(`DELETE FROM ${T} WHERE "id" = $1`, [String(doc._id)]);
          return doc;
        },
        writable: true,
        configurable: true,
      },
      id: { get: () => (doc._id == null ? null : String(doc._id)), configurable: true },
      isNew: { value: false, writable: true, configurable: true },
    };
    for (const [k, fn] of Object.entries(schema.methods)) {
      props[k] = { value: fn.bind(doc), writable: true, configurable: true };
    }
    Object.defineProperties(doc, props);
    snapshot(doc, projection);
    return doc;
  }

  function snapshot(doc, projection) {
    const snap = new Map();
    for (const f of meta.dataFields) {
      if (projection && !projection.fields.has(f.name)) continue;
      snap.set(f.name, JSON.stringify(doc[f.name]));
    }
    SNAPSHOT.set(doc, snap);
  }

  async function saveDocument(doc) {
    const snap = SNAPSHOT.get(doc) || new Map();
    const changed = [];
    const errors = {};
    for (const f of meta.dataFields) {
      const tracked = snap.has(f.name);
      if (!tracked && !Object.prototype.hasOwnProperty.call(doc, f.name)) continue;
      let v;
      try {
        v = castNode(f.node, doc[f.name], f.name, { defaults: true, newIds: true });
      } catch (err) {
        if (err instanceof CastError) { errors[err.path || f.name] = { message: err.message, kind: 'cast', path: f.name }; continue; }
        throw err;
      }
      const json = JSON.stringify(v);
      if (tracked && json === snap.get(f.name)) continue;
      validateNode(f.node, v, f.name, errors);
      if (v === undefined) delete doc[f.name];
      else doc[f.name] = v;
      changed.push(f);
    }
    if (Object.keys(errors).length) throw new ValidationError(name, errors);
    if (!changed.length) return doc;
    const P = new Params();
    const sets = changed.map((f) => `${qi(f.col)} = ${meta.param(f, doc[f.name], P)}`);
    if (meta.timestamps) sets.push('"updated_at" = now()');
    const { rows } = await query(
      `UPDATE ${T} SET ${sets.join(', ')} WHERE "id" = ${P.add(String(doc._id), 'text')} RETURNING "updated_at"`,
      P.values,
    );
    if (rows[0]?.updated_at) doc.updatedAt = rows[0].updated_at;
    for (const f of changed) snap.set(f.name, JSON.stringify(doc[f.name]));
    SNAPSHOT.set(doc, snap);
    return doc;
  }

  // --------------------------------------------------------- reading --

  async function runFind(q, one) {
    const P = new Params();
    const projection = meta.parseProjection(q._projection);
    const where = meta.compileFilter(q.filter, P);
    let sort = meta.compileSort(q._sort, P);
    if (!sort) sort = meta.timestamps ? ' ORDER BY "created_at" ASC, "id" ASC' : ' ORDER BY "id" ASC';
    const limit = one ? 1 : q._limit;
    let sql = `SELECT ${meta.selectList(projection)} FROM ${T} WHERE ${where}${sort}`;
    if (limit) sql += ` LIMIT ${Math.max(0, Math.floor(Number(limit)))}`;
    if (q._skip) sql += ` OFFSET ${Math.max(0, Math.floor(Number(q._skip)))}`;
    const { rows } = await query(sql, P.values);
    const docs = rows.map((r) => hydrate(r, projection, q._lean));
    return one ? docs[0] || null : docs;
  }

  // -------------------------------------------------------- updating --

  /**
   * Update matching rows. `returning`: 'none' | 'before' | 'after'.
   * Returns { rows, upserted } where rows are raw DB rows.
   */
  async function runUpdate(filter, rawUpdate, { multi, upsert, sort, returning }) {
    const upd = meta.normalizeUpdate(rawUpdate);
    const P = new Params();
    const sets = meta.compileUpdateSets(upd, P, 'x');
    let rows;
    if (sets) {
      const where = meta.compileFilter(filter, P);
      const order = meta.compileSort(sort, P);
      const tgtCols = returning === 'before' ? '*' : '"id"';
      const sql =
        `WITH tgt AS (SELECT ${tgtCols} FROM ${T} WHERE ${where}${order}${multi ? '' : ' LIMIT 1'} FOR UPDATE) ` +
        `UPDATE ${T} AS x SET ${sets.join(', ')} FROM tgt WHERE x."id" = tgt."id" ` +
        `RETURNING ${returning === 'before' ? 'tgt.*' : 'x.*'}`;
      ({ rows } = await query(sql, P.values));
    } else {
      rows = await updateInJs(filter, upd, { multi, sort, returning });
    }
    if (rows.length || !upsert) return { rows, upserted: null };

    // Nothing matched: insert, seeded from the filter's equality fields.
    const seed = seedFromFilter(filter);
    applyUpdate(seed, upd, { insert: true });
    try {
      const doc = meta.prepareInsert(seed, { validate: false });
      const P2 = new Params();
      const { rows: ins } = await query(meta.insertSql([doc], P2), P2.values);
      return { rows: returning === 'before' ? [] : ins, upserted: ins[0] };
    } catch (err) {
      // Lost a race with a concurrent upsert of the same key — update it instead.
      if (err.code === 11000) return runUpdate(filter, rawUpdate, { multi, upsert: false, sort, returning });
      throw err;
    }
  }

  /** Read-modify-write with the rows locked, for updates SQL can't express. */
  async function updateInJs(filter, upd, { multi, sort, returning }) {
    return withTransaction(async (c) => {
      const P = new Params();
      const where = meta.compileFilter(filter, P);
      const order = meta.compileSort(sort, P);
      const { rows } = await c.query(
        `SELECT * FROM ${T} WHERE ${where}${order}${multi ? '' : ' LIMIT 1'} FOR UPDATE`,
        P.values,
      );
      const out = [];
      for (const row of rows) {
        const before = meta.rowToObject(row, null);
        const after = applyUpdate(clone(before), upd);
        const P2 = new Params();
        const sets = [];
        for (const f of meta.dataFields) {
          if (sameJson(before[f.name], after[f.name])) continue;
          const v = castNode(f.node, after[f.name], f.name, { newIds: true });
          sets.push(`${qi(f.col)} = ${meta.param(f, v, P2)}`);
        }
        if (meta.timestamps) sets.push('"updated_at" = now()');
        const { rows: upd2 } = await c.query(
          `UPDATE ${T} SET ${sets.join(', ')} WHERE "id" = ${P2.add(row.id, 'text')} RETURNING *`,
          P2.values,
        );
        out.push(returning === 'before' ? row : upd2[0]);
      }
      return out;
    });
  }

  async function runDelete(filter, { multi, returning }) {
    const P = new Params();
    const where = meta.compileFilter(filter, P);
    const sql = multi
      ? `DELETE FROM ${T} WHERE ${where} RETURNING "id"`
      : `DELETE FROM ${T} WHERE "id" = (SELECT "id" FROM ${T} WHERE ${where} ORDER BY ${meta.timestamps ? '"created_at", ' : ''}"id" LIMIT 1) RETURNING ${returning ? '*' : '"id"'}`;
    const { rows } = await query(sql, P.values);
    return rows;
  }

  // -------------------------------------------------------- dispatch --

  async function exec(q) {
    const o = q.options;
    switch (q.op) {
      case 'find': return runFind(q, false);
      case 'findOne': return runFind(q, true);
      case 'countDocuments': {
        const P = new Params();
        const { rows } = await query(`SELECT count(*) AS n FROM ${T} WHERE ${meta.compileFilter(q.filter, P)}`, P.values);
        return rows[0].n;
      }
      case 'distinct': {
        const f = meta.fields.get(q.field);
        if (!f) return [];
        const P = new Params();
        const colExpr = f.kind === 'json' ? `${qi(f.col)}::jsonb` : qi(f.col);
        const { rows } = await query(
          `SELECT DISTINCT ${colExpr} AS v FROM ${T} WHERE ${meta.compileFilter(q.filter, P)} AND ${qi(f.col)} IS NOT NULL`,
          P.values,
        );
        const vals = rows.flatMap((r) => (Array.isArray(r.v) ? r.v : [r.v]));
        return [...new Map(vals.map((v) => [JSON.stringify(v), v])).values()];
      }
      case 'exists': {
        const P = new Params();
        const { rows } = await query(`SELECT "id" FROM ${T} WHERE ${meta.compileFilter(q.filter, P)} LIMIT 1`, P.values);
        return rows[0] ? { _id: rows[0].id } : null;
      }
      case 'updateOne':
      case 'updateMany': {
        const { rows, upserted } = await runUpdate(q.filter, q.update, {
          multi: q.op === 'updateMany', upsert: !!o.upsert, sort: o.sort, returning: 'none',
        });
        const matched = upserted ? 0 : rows.length;
        return {
          acknowledged: true,
          matchedCount: matched,
          modifiedCount: matched,
          upsertedCount: upserted ? 1 : 0,
          upsertedId: upserted ? upserted.id : null,
          // Legacy names some callers still read.
          n: matched + (upserted ? 1 : 0),
          nModified: matched,
        };
      }
      case 'findOneAndUpdate': {
        const after = o.new === true || o.returnDocument === 'after' || o.returnOriginal === false;
        const { rows } = await runUpdate(q.filter, q.update, {
          multi: false, upsert: !!o.upsert, sort: q._sort ?? o.sort, returning: after ? 'after' : 'before',
        });
        return hydrate(rows[0], meta.parseProjection(q._projection), q._lean);
      }
      case 'deleteOne':
      case 'deleteMany': {
        const rows = await runDelete(q.filter, { multi: q.op === 'deleteMany' });
        return { acknowledged: true, deletedCount: rows.length };
      }
      case 'findOneAndDelete': {
        const rows = await runDelete(q.filter, { multi: false, returning: true });
        return hydrate(rows[0], meta.parseProjection(q._projection), q._lean);
      }
      default:
        throw new Error(`Unknown query op ${q.op}`);
    }
  }

  // --------------------------------------------------------- inserts --

  async function insertDocs(list, { lean = false } = {}) {
    if (!list.length) return [];
    const docs = list.map((d) => meta.prepareInsert(d && typeof d.toObject === 'function' ? d.toObject() : d));
    const out = [];
    for (let i = 0; i < docs.length; i += 200) {
      const P = new Params();
      const { rows } = await query(meta.insertSql(docs.slice(i, i + 200), P), P.values);
      out.push(...rows.map((r) => hydrate(r, null, lean)));
    }
    return out;
  }

  const idFilter = (id) => ({ _id: id === undefined ? null : (isPlainObject(id) && id._id !== undefined ? id._id : id) });

  const Model = {
    modelName: name,
    collectionName: table,
    table,
    schema,
    meta,
    _exec: exec,

    find: (filter, projection, options) => new Query(Model, 'find', { filter, projection, options }),
    findOne: (filter, projection, options) => new Query(Model, 'findOne', { filter, projection, options }),
    findById: (id, projection, options) => new Query(Model, 'findOne', { filter: idFilter(id), projection, options }),
    countDocuments: (filter) => new Query(Model, 'countDocuments', { filter }),
    estimatedDocumentCount: () => new Query(Model, 'countDocuments', { filter: {} }),
    distinct: (field, filter) => new Query(Model, 'distinct', { field, filter }),
    exists: (filter) => new Query(Model, 'exists', { filter }),

    updateOne: (filter, update, options) => new Query(Model, 'updateOne', { filter, update, options }),
    updateMany: (filter, update, options) => new Query(Model, 'updateMany', { filter, update, options }),
    findOneAndUpdate: (filter, update, options = {}) =>
      new Query(Model, 'findOneAndUpdate', { filter, update, options, projection: options.projection }),
    findByIdAndUpdate: (id, update, options = {}) =>
      new Query(Model, 'findOneAndUpdate', { filter: idFilter(id), update, options, projection: options.projection }),

    deleteOne: (filter) => new Query(Model, 'deleteOne', { filter }),
    deleteMany: (filter) => new Query(Model, 'deleteMany', { filter }),
    findOneAndDelete: (filter, options = {}) => new Query(Model, 'findOneAndDelete', { filter, options }),
    findByIdAndDelete: (id, options = {}) => new Query(Model, 'findOneAndDelete', { filter: idFilter(id), options }),

    async create(docOrList, ...rest) {
      if (Array.isArray(docOrList)) return insertDocs(docOrList);
      if (rest.length && rest.every((d) => d && typeof d === 'object' && !Array.isArray(d))) {
        return insertDocs([docOrList, ...rest]);
      }
      const [doc] = await insertDocs([docOrList]);
      return doc;
    },
    insertMany: (list, options = {}) => insertDocs(Array.isArray(list) ? list : [list], { lean: !!options.lean }),

    async bulkWrite(ops = []) {
      const r = { insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0 };
      for (const op of ops) {
        const [kind, a] = Object.entries(op)[0] || [];
        if (kind === 'insertOne') { await insertDocs([a.document]); r.insertedCount += 1; }
        else if (kind === 'updateOne' || kind === 'updateMany') {
          const res = await Model[kind](a.filter, a.update, { upsert: !!a.upsert });
          r.matchedCount += res.matchedCount; r.modifiedCount += res.modifiedCount; r.upsertedCount += res.upsertedCount;
        } else if (kind === 'deleteOne' || kind === 'deleteMany') {
          r.deletedCount += (await Model[kind](a.filter)).deletedCount;
        } else throw new Error(`bulkWrite op ${kind} is not supported`);
      }
      return r;
    },

    aggregate() {
      throw new Error(`${name}.aggregate() is not supported — write the query in SQL`);
    },

    /** Raw rows → documents (for hand-written SQL). */
    hydrate: (row, { lean = true } = {}) => hydrate(row, null, lean),

    /** DDL: create the table, add any new columns, build indexes, lock it down. */
    ddl() {
      const stmts = [
        `CREATE TABLE IF NOT EXISTS ${T} ("id" text PRIMARY KEY` +
          (meta.timestamps
            ? ', "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now()'
            : '') +
          ')',
      ];
      for (const f of meta.dataFields) {
        stmts.push(`ALTER TABLE ${T} ADD COLUMN IF NOT EXISTS ${qi(f.col)} ${SQL_TYPE[f.kind]}`);
      }
      const indexes = [];
      for (const f of meta.dataFields) {
        const o = f.node.opts || {};
        if (f.kind === 'json') continue;
        if (o.unique) indexes.push({ cols: [[f.col, 1]], unique: true, nullsNotDistinct: false });
        else if (o.index) indexes.push({ cols: [[f.col, 1]], unique: false });
      }
      for (const { fields, options } of schema.indexes) {
        const cols = Object.entries(fields).map(([k, d]) => [meta.fields.get(k)?.col, d]).filter(([c]) => c);
        if (cols.length) indexes.push({ cols, unique: !!options.unique, nullsNotDistinct: !!options.unique && cols.length > 1 });
      }
      const seen = new Set();
      for (const ix of indexes) {
        const nm = `${table}_${ix.cols.map(([c]) => c).join('_')}_${ix.unique ? 'key' : 'idx'}`.slice(0, 63);
        if (seen.has(nm)) continue;
        seen.add(nm);
        const cols = ix.cols.map(([c, d]) => `${qi(c)}${d === -1 ? ' DESC' : ''}`).join(', ');
        stmts.push(
          `CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${qi(nm)} ON ${T} (${cols})` +
            (ix.nullsNotDistinct ? ' NULLS NOT DISTINCT' : ''),
        );
      }
      // Nothing in the browser talks to these tables directly: RLS on, with no
      // policies, and no grants for the public API roles.
      stmts.push(`ALTER TABLE ${T} ENABLE ROW LEVEL SECURITY`);
      stmts.push(`REVOKE ALL ON TABLE ${T} FROM anon, authenticated`);
      return stmts;
    },

    async ensureTable() {
      await query(this.ddl().join(';\n'));
    },
  };

  registry.push(Model);
  return Model;
}

export { Schema };
export default { defineModel, Schema, registry, applyUpdate };
