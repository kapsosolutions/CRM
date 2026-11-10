import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import Flow from '../models/Flow.js';
import FlowTemplate from '../models/FlowTemplate.js';
import { verticalConfig } from '../services/verticals.js';
import { getClientForBusiness } from '../services/metaCloud.js';
import { buildFlowJson, isEndpointMode, danglingTargets } from '../services/flowJson.js';
import { embedFlowImages } from '../services/flowImages.js';
import { normalizeScreenIds } from '../services/flowIds.js';
import { ensureFlowKeys } from '../services/flowCrypto.js';
import storage from '../services/storage.js';
import logger from '../services/logger.js';

const ENDPOINT_URI = () =>
  `${(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')}/api/whatsapp/flow-endpoint`;

/**
 * A name for a new flow on Meta that no flow on the WABA has, deprecated ones
 * included: "Bookings", else "Bookings (2)", "Bookings (3)"…
 */
export function metaFlowName(name, existing = []) {
  const taken = new Set(existing.map((f) => String(f?.name || '').trim().toLowerCase()));
  const base = String(name || 'Flow').trim().slice(0, 180) || 'Flow';
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i += 1) {
    const n = `${base} (${i})`;
    if (!taken.has(n.toLowerCase())) return n;
  }
  return `${base} · ${Date.now().toString(36)}`;
}

// Meta's top-level `message` is often uselessly generic ("Updating attempt
// failed"); the actionable text lives in error_user_msg / error_data. Pull the
// whole lot out so a failure is diagnosable from one log line.
function metaError(err) {
  const e = err.response?.data?.error || {};
  return {
    message: e.error_user_msg || e.message || err.message,
    type: e.type,
    code: e.code,
    subcode: e.error_subcode,
    title: e.error_user_title,
    data: e.error_data,
    trace: e.fbtrace_id,
  };
}

const router = express.Router();
router.use(requireBusiness);

/** Tenant filter — spread into every query so no flow is reachable cross-tenant. */
const owner = (req) => ({ businessId: req.business._id });
/**
 * Meta client bound to the logged-in tenant's WABA. Publishing through the
 * shared default client created the flow on whichever business happened to be
 * oldest, so one tenant's publish landed in another tenant's WhatsApp account.
 */
const client = (req) => getClientForBusiness(req.business);

// The chat-message fields, shared by the full save and the message-only PATCH.
const HEADERS = ['none', 'image', 'video', 'pdf'];
const pickMessage = (b) => ({
  cta: b.cta || 'Open',
  msgHeader: HEADERS.includes(b.msgHeader) ? b.msgHeader : 'none',
  msgHeaderMediaUrl: typeof b.msgHeaderMediaUrl === 'string' ? b.msgHeaderMediaUrl : '',
  msgHeaderFileName: typeof b.msgHeaderFileName === 'string' ? b.msgHeaderFileName : '',
  msgBody: typeof b.msgBody === 'string' ? b.msgBody : '',
  msgFooter: typeof b.msgFooter === 'string' ? b.msgFooter : '',
});

const pick = (b) => {
  const flow = {
    name: (b.name || '').trim(),
    categories: Array.isArray(b.categories) && b.categories.length ? b.categories : ['OTHER'],
    ...pickMessage(b),
    screens: Array.isArray(b.screens) ? b.screens : [],
    blocks: Array.isArray(b.blocks) ? b.blocks : [],
    flowLinks: Array.isArray(b.flowLinks) ? b.flowLinks : [],
    entryTarget: typeof b.entryTarget === 'string' ? b.entryTarget : '',
    positions: b.positions && typeof b.positions === 'object' ? b.positions : {},
  };
  // Meta rejects digits in screen ids. Fix them at the point of storage so the
  // stored id and the published id are always the same string — the runtime
  // looks screens up by the id Meta echoes back.
  normalizeScreenIds(flow);
  return flow;
};

// ===========================================================================
// Flow templates — a shared library of flow blueprints, filtered by archetype.
//
// Declared BEFORE the "/:id" routes so "/templates" isn't swallowed as an id.
// The content copied in and out is a verbatim snapshot of a Flow's screens and
// blocks, minus everything tenant-specific (businessId, metaFlowId, status).
// ===========================================================================
/**
 * Which templates a tenant sees: ones made for its EXACT business category.
 *
 * Scoping by archetype was too broad — a restaurant and a shop are both
 * "catalog" businesses, so a restaurant's ordering template showed up in a
 * shop's list. Templates saved before `category` was recorded only carry the
 * author's category label, so those are matched on that instead.
 */
const templateScope = (req) => {
  const v = verticalConfig(req.business.category);
  return {
    $or: [
      { category: v.key },
      { category: { $in: ['', null] }, categoryLabel: v.label },
    ],
  };
};
/** Its author, or a session opened with the platform master password. */
const mayDeleteTemplate = (tpl, req) =>
  !!req.auth?.master || String(tpl.createdByBusiness) === String(req.business._id);
const templateFitsTenant = (tpl, req) => {
  const v = verticalConfig(req.business.category);
  return tpl.category ? tpl.category === v.key : tpl.categoryLabel === v.label;
};

// Only the blueprint, never the owning tenant's identifiers.
const templateContent = (f) => ({
  categories: Array.isArray(f.categories) && f.categories.length ? f.categories : ['OTHER'],
  screens: Array.isArray(f.screens) ? f.screens : [],
  blocks: Array.isArray(f.blocks) ? f.blocks : [],
  flowLinks: Array.isArray(f.flowLinks) ? f.flowLinks : [],
  entryTarget: typeof f.entryTarget === 'string' ? f.entryTarget : '',
  positions: f.positions && typeof f.positions === 'object' ? f.positions : {},
});

// List the templates this tenant can use: ones made for its own business
// category. A shop never sees a restaurant's flow, a clinic never a salon's.
router.get('/templates', async (req, res) => {
  try {
    const data = await FlowTemplate.find(templateScope(req))
      .sort({ updatedAt: -1 })
      .lean();
    // Who may delete each one, so the list only offers Delete where it works.
    res.json({
      success: true,
      data: data.map((t) => ({
        ...t,
        own: String(t.createdByBusiness) === String(req.business._id),
        canDelete: mayDeleteTemplate(t, req),
      })),
    });
  } catch (err) {
    logger.error('list flow templates failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// Save one of this tenant's flows as a shared template.
router.post('/templates', async (req, res) => {
  try {
    const { flowId, name, description } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'A template name is required' });
    }
    const flow = await Flow.findOne({ _id: flowId, ...owner(req) }).lean();
    if (!flow) return res.status(404).json({ success: false, message: 'Flow not found' });
    const v = verticalConfig(req.business.category);
    const tpl = await FlowTemplate.create({
      name: String(name).trim(),
      description: String(description || '').trim(),
      archetype: v.archetype,
      category: v.key,
      categoryLabel: v.label,
      createdByBusiness: req.business._id,
      createdByName: req.business.name || '',
      ...templateContent(flow),
    });
    logger.info('flow template saved', {
      template: tpl.name, category: tpl.category, by: req.business.name,
    });
    res.status(201).json({ success: true, data: tpl });
  } catch (err) {
    logger.error('save flow template failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// Start a new flow in THIS tenant from a template. The new flow is a plain
// draft owned by this business — never published, never linked to Meta.
router.post('/templates/:id/use', async (req, res) => {
  try {
    const tpl = await FlowTemplate.findById(req.params.id).lean();
    if (!tpl) return res.status(404).json({ success: false, message: 'Template not found' });
    // Guard against using a template meant for a different kind of business.
    if (!templateFitsTenant(tpl, req)) {
      return res.status(403).json({ success: false, message: 'This template is for a different business type' });
    }
    const content = pick({ name: req.body?.name || tpl.name, ...templateContent(tpl) });
    const flow = await Flow.create({ ...content, businessId: req.business._id, status: 'DRAFT' });
    await FlowTemplate.updateOne({ _id: tpl._id }, { $inc: { usedCount: 1 } });
    logger.info('flow created from template', { template: tpl.name, flow: flow.name, by: req.business.name });
    res.status(201).json({ success: true, data: flow });
  } catch (err) {
    logger.error('use flow template failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// Remove a template. Its author can; so can the platform owner, signed in to
// any tenant with the master password (to clear out the shared library).
// One tenant can't delete another's.
router.delete('/templates/:id', async (req, res) => {
  try {
    const tpl = await FlowTemplate.findById(req.params.id).lean();
    if (!tpl) return res.status(404).json({ success: false, message: 'Not found' });
    if (!mayDeleteTemplate(tpl, req)) {
      return res.status(403).json({ success: false, message: 'Only the business that saved this template can delete it' });
    }
    await FlowTemplate.deleteOne({ _id: tpl._id });
    if (req.auth?.master && String(tpl.createdByBusiness) !== String(req.business._id)) {
      logger.warn('flow template deleted with the platform master password', {
        template: tpl.name, author: tpl.createdByName || String(tpl.createdByBusiness || ''), signedInAs: req.business.name, ip: req.ip,
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/', async (req, res) => {
  const data = await Flow.find(owner(req)).sort({ updatedAt: -1 }).lean();
  // `flowsActive` travels with the list so the Flows page can show the header
  // toggle in the right state without a second request.
  res.json({ success: true, data, flowsActive: !!req.business.flowsActive });
});

// ---------- Switch native Flows on/off as the conversation driver ----------
// A single tenant-level switch, not per flow: on → the flow map drives inbound
// conversations; off (the default) → the tenant's journeys do. Kept off the
// PUT path so it never touches a flow's published status.
router.patch('/active', async (req, res) => {
  try {
    const flowsActive = !!req.body?.active;
    req.business.flowsActive = flowsActive;
    await req.business.save();
    logger.info('flows driver toggled', { flowsActive, business: req.business.name });
    res.json({ success: true, flowsActive });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = pick(req.body || {});
    if (!b.name) return res.status(400).json({ success: false, message: 'name required' });
    const flow = await Flow.create({ ...b, businessId: req.business._id, status: 'DRAFT' });
    res.status(201).json({ success: true, data: flow });
  } catch (err) {
    logger.error('create flow failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const b = pick(req.body || {});
    const before = await Flow.findOne({ _id: req.params.id, ...owner(req) }).lean();
    // Editing drops a published flow back to draft until it's republished.
    const flow = await Flow.findOneAndUpdate(
      { _id: req.params.id, ...owner(req) },
      { $set: { ...b, status: 'DRAFT' } },
      { new: true },
    );
    if (!flow) return res.status(404).json({ success: false, message: 'Not found' });

    // Media that this flow referenced before but no longer does (the user
    // replaced or removed an image/video/pdf) is now orphaned — delete it.
    if (before) {
      const after = storage.collectCdnUrls(flow.toObject());
      const dropped = [...storage.collectCdnUrls(before)].filter((u) => !after.has(u));
      if (dropped.length) {
        storage.deleteMany(dropped, String(req.business?._id || ''))
          .then((n) => logger.info('flow media cleaned', { flow: String(flow._id), removed: n }))
          .catch(() => {});
      }
    }
    res.json({ success: true, data: flow });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------- Update only the chat message that opens the flow ----------
// Deliberately separate from PUT: these fields aren't part of the Flow JSON, so
// changing them must NOT drop a published flow back to draft.
router.patch('/:id/message', async (req, res) => {
  try {
    const before = await Flow.findOne({ _id: req.params.id, ...owner(req) }).lean();
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    const msg = pickMessage(req.body || {});
    const flow = await Flow.findOneAndUpdate(
      { _id: req.params.id, ...owner(req) },
      { $set: msg },
      { new: true },
    );

    // A replaced header image/video/pdf leaves the old file orphaned.
    if (before.msgHeaderMediaUrl && before.msgHeaderMediaUrl !== flow.msgHeaderMediaUrl) {
      storage.deleteByUrl(before.msgHeaderMediaUrl, String(req.business?._id || '')).catch(() => {});
    }
    res.json({ success: true, data: flow });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const flow = await Flow.findOne({ _id: req.params.id, ...owner(req) });
  if (flow) {
    const media = [...storage.collectCdnUrls(flow.toObject())];
    // Best-effort cleanup on Meta (published flows are deprecated, not deleted).
    if (flow.metaFlowId) {
      try {
        const wa = client(req);
        if (flow.status === 'PUBLISHED') await wa.deprecateFlow(flow.metaFlowId);
        else await wa.deleteFlow(flow.metaFlowId);
      } catch (e) {
        logger.warn('meta flow cleanup failed', { error: e.response?.data?.error?.message || e.message });
      }
    }
    await flow.deleteOne();
    if (media.length) storage.deleteMany(media, String(req.business?._id || '')).catch(() => {});
  }
  res.json({ success: true });
});

// Create (if needed) -> upload JSON -> publish, using the tenant's WABA creds.
// Re-running republishes the updated JSON to the same flow id.
router.post('/:id/publish', async (req, res) => {
  try {
    const flow = await Flow.findOne({ _id: req.params.id, ...owner(req) });
    if (!flow) return res.status(404).json({ success: false, message: 'Not found' });

    const wa = client(req);
    const plain = flow.toObject();

    // Meta only allows letters and underscores in a screen id. A flow saved
    // before this was enforced (or edited outside the builder) can still hold
    // ids like "SCREEN_2", which fails validation and blocks the publish.
    // Rename and persist first, so the published id and the id the runtime
    // matches on are the same string.
    const { changed: idsChanged, renames } = normalizeScreenIds(plain);
    if (idsChanged) {
      flow.screens = plain.screens;
      flow.blocks = plain.blocks;
      flow.entryTarget = plain.entryTarget;
      flow.positions = plain.positions;
      flow.markModified('positions');
      await flow.save();
      logger.info('renamed screen ids to a Meta-legal form', { flow: flow.name, renames });
    }

    const endpointMode = isEndpointMode(plain);
    const endpointUri = endpointMode && process.env.PUBLIC_BASE_URL ? ENDPOINT_URI() : null;
    // Collected and returned so the builder can show exactly what went wrong
    // rather than just a count of warnings.
    const warnings = [];
    if (idsChanged) {
      const list = Object.entries(renames).map(([from, to]) => `${from} → ${to}`).join(', ');
      warnings.push(`Screen IDs may only contain letters and underscores, so these were renamed: ${list}`);
    }

    // Navigation to a deleted screen. Left in, Meta refuses the whole publish
    // with "Invalid screens found in the routing model" and names an id the
    // builder no longer shows, which is impossible to act on. The reference is
    // dropped from the published JSON and reported here instead.
    const dangling = danglingTargets(plain);
    for (const d of dangling) {
      warnings.push(
        `On ${d.from}, ${d.via} pointed at "${d.to}", which no longer exists — that route was left out. Re-wire it if it's still needed.`,
      );
    }
    if (dangling.length) {
      logger.warn('flow has navigation to missing screens', {
        flow: flow.name, dangling: dangling.map((d) => `${d.from}->${d.to}`),
      });
    }

    // 1) Resolve a *usable* Meta flow id on the CURRENT tenant's WABA.
    //
    // A stored id can go stale: the flow may have been deprecated (deprecated
    // flows can't be updated or published — Meta just answers "Updating
    // attempt failed"), or it may belong to a different WABA entirely, which
    // happens when the tenant is replaced but the flow definition is kept.
    // Both cases used to wedge publish permanently, because a new flow was
    // only ever created when metaFlowId was empty.
    const onThisWaba = await wa.getFlows().catch(() => []);
    const DEAD = new Set(['DEPRECATED', 'BLOCKED', 'THROTTLED']);
    let flowId = flow.metaFlowId;

    if (flowId) {
      const mine = onThisWaba.find((f) => f.id === flowId);
      if (!mine) {
        warnings.push('This flow was created on a different WhatsApp account, so a fresh one was created here.');
        logger.warn('stored metaFlowId is not on this WABA, recreating', { flow: flow.name, flowId });
        flowId = '';
      } else if (DEAD.has(String(mine.status || '').toUpperCase())) {
        warnings.push(`The previous Meta flow was ${String(mine.status).toLowerCase()} and cannot be republished, so a fresh one was created.`);
        logger.warn('stored metaFlowId is unusable, recreating', { flow: flow.name, flowId, status: mine.status });
        flowId = '';
      }
    }

    if (!flowId) {
      // Reuse a healthy same-named flow on this WABA before making another.
      const match = onThisWaba.find(
        (f) => f.name === flow.name && !DEAD.has(String(f.status || '').toUpperCase()),
      );
      if (match) flowId = match.id;
      else {
        // Meta keeps a deleted flow's name: a published flow is only
        // deprecated, never removed, and its name stays taken on the WABA. So
        // "create, delete, create again" was refused with "Flow name should be
        // unique within one WhatsApp business account". The Meta-side name is
        // internal, so a taken one gets a suffix; the CRM name is unchanged.
        const categories = flow.categories?.length ? flow.categories : ['OTHER'];
        const opts = endpointUri ? { endpointUri } : {};
        let metaName = metaFlowName(flow.name, onThisWaba);
        let created;
        try {
          created = await wa.createFlow(metaName, categories, opts);
        } catch (e) {
          // A name on the WABA that the list didn't show (more than one page).
          if (!/unique/i.test(metaError(e).message || '')) throw e;
          metaName = `${String(flow.name).slice(0, 180)} · ${Date.now().toString(36)}`;
          created = await wa.createFlow(metaName, categories, opts);
        }
        if (metaName !== flow.name) logger.info('flow name taken on Meta, created under another', { flow: flow.name, metaName });
        flowId = created.id;
      }
      flow.metaFlowId = flowId;
      await flow.save();
    }
    // Ensure endpoint_uri is set on endpoint-mode flows (e.g. reused drafts).
    if (endpointUri) {
      try {
        await wa.updateFlowEndpoint(flowId, endpointUri);
      } catch (e) {
        const detail = metaError(e);
        logger.warn('set endpoint_uri failed', detail);
        // Without this the flow has no data endpoint, so branching and dynamic
        // lists won't work — the operator needs to know, not just the log.
        warnings.push(`Could not set the flow's data endpoint at Meta: ${detail.message}`);
      }
    }

    // Endpoint-mode flows are health-checked by Meta at publish time: it posts
    // an encrypted probe to our endpoint. That only works once Meta holds our
    // public key, so register it here instead of leaving it as manual setup.
    if (endpointMode) {
      try {
        const publicKey = ensureFlowKeys();
        if (publicKey) {
          await wa.setBusinessEncryptionKey(publicKey);
          logger.info('flow endpoint public key registered with Meta');
        } else {
          warnings.push('Flow endpoint encryption key is not configured on the server.');
        }
      } catch (e) {
        const m = e.response?.data?.error?.message || e.message;
        logger.error('could not register flow encryption key', { error: m });
        warnings.push(`Could not register the endpoint encryption key with Meta: ${m}`);
      }
      if (!process.env.PUBLIC_BASE_URL) {
        warnings.push('PUBLIC_BASE_URL is not set, so Meta cannot reach this flow\'s data endpoint.');
      }
    }

    // 2) Embed images as resized base64 (Flows reject remote URLs), then build
    //    and upload the generated Flow JSON (the draft).
    const droppedImages = await embedFlowImages(plain);
    if (droppedImages.length) {
      logger.warn('flow images could not be embedded', { flow: flow.name, dropped: droppedImages });
      warnings.push(
        `Could not load ${droppedImages.length} image(s), so they were left out: ${droppedImages.join(', ')}.`,
      );
    }
    const json = buildFlowJson(plain);
    const upd = await wa.updateFlowJSON(flowId, json);
    const validationErrors = upd?.validation_errors || [];
    // Log the detail so a failed publish is diagnosable from the server logs.
    if (validationErrors.length) {
      logger.warn('flow JSON validation reported issues', {
        flow: flow.name,
        count: validationErrors.length,
        errors: validationErrors.map((e) => `${e.error_type || e.error || ''}: ${e.message || ''}`.trim()),
      });
    }

    // 3) Publish (leave as draft if publish is rejected, e.g. validation).
    let published = false;
    let publishError = '';
    try {
      await wa.publishFlow(flowId);
      published = true;
    } catch (pubErr) {
      const detail = metaError(pubErr);
      publishError = detail.message;
      logger.error('publish failed (left as draft)', { flow: flow.name, endpointMode, ...detail });
    }

    flow.status = published ? 'PUBLISHED' : 'DRAFT';
    await flow.save();
    // A successful publish used to log nothing at all, which made a slow or
    // stuck request indistinguishable from a silent success.
    if (published) {
      logger.info('flow published', {
        flow: flow.name,
        metaFlowId: flowId,
        endpointMode,
        warnings: warnings.length,
      });
    }
    res.json({
      success: true,
      data: flow,
      published,
      publishError,
      // Readable lines for the builder: Meta's own validation messages first,
      // then anything we noticed about the endpoint setup.
      validationErrors,
      warnings: [
        ...validationErrors.map((e) => e.message || e.error_type || String(e)),
        ...warnings,
      ],
    });
  } catch (err) {
    const detail = metaError(err);
    logger.error('publish flow failed', detail);
    res.status(500).json({ success: false, message: detail.message, detail });
  }
});

export default router;
