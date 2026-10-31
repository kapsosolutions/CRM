import express from 'express';
import { requireBusiness, bizId } from '../middleware/auth.js';
import { uploadMedia } from '../middleware/upload.js';
import storage, { mediaFolder } from '../services/storage.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import catalog from '../services/catalog.js';
import { getClientForBusiness } from '../services/metaCloud.js';
import { CatalogError, startCatalogLogin, refreshCatalogLogin, connectCatalog } from '../services/metaCatalog.js';
import logger from '../services/logger.js';

const router = express.Router();
// A business login is required: every product and category below belongs to one
// tenant, and syncing to Meta needs that tenant's own catalog credentials.
router.use(requireBusiness);

// ---------------- Connect through Meta (Get started) ----------------
// services/metaCatalog.js. The login token never appears in a response.
function catalogFail(res, err, what) {
  if (err instanceof CatalogError) {
    if (err.meta) logger.warn(`${what} refused by Meta`, { code: err.code, metaCode: err.meta.code, error: err.meta.message });
    if (err.status === 429) res.set('Retry-After', '60');
    return res.status(err.status).json(err.toJSON());
  }
  logger.error(`${what} failed`, { error: err.message });
  return res.status(500).json({ success: false, code: 'CATALOG_FAILED', message: 'Something went wrong. Please try again.' });
}

// { code } from FB.login → { sessionId, catalogs, currentId }
router.post('/meta/login', async (req, res) => {
  try {
    res.json({ success: true, ...(await startCatalogLogin(req.business, req.body?.code)) });
  } catch (err) {
    catalogFail(res, err, 'Meta catalog login');
  }
});

// { sessionId } → the list again, after the business linked a catalog itself
// in WhatsApp Manager (shows which one is on WhatsApp now)
router.post('/meta/refresh', async (req, res) => {
  try {
    res.json({ success: true, ...(await refreshCatalogLogin(req.business, { sessionId: req.body?.sessionId })) });
  } catch (err) {
    catalogFail(res, err, 'Meta catalog refresh');
  }
});

// { sessionId, catalogId } → connects it to the WABA and saves it
router.post('/meta/connect', async (req, res) => {
  try {
    const b = req.body || {};
    res.json({ success: true, ...(await connectCatalog(req.business, { sessionId: b.sessionId, catalogId: b.catalogId })) });
  } catch (err) {
    catalogFail(res, err, 'Meta catalog connect');
  }
});

/** Tenant filter — spread into every query so nothing is reachable cross-tenant. */
const owner = (req) => ({ businessId: req.business._id });

// Parse JSON-ish fields that arrive as strings in multipart form data.
function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

// ---------------------------------------------------------------------------
// Images
//
// The editor used to send `URL.createObjectURL(file)` for variant images. A
// `blob:` URL only exists inside the browser tab that made it, so the picture
// disappeared on reload and Meta could never fetch it. Variant files now arrive
// as `variantImage_<index>` parts and are uploaded here like any other media;
// anything that isn't a real http(s) URL is discarded rather than stored.
// ---------------------------------------------------------------------------
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');
const fileNamed = (req, field) => (req.files || []).find((f) => f.fieldname === field);
// All new photos for variant `i`, in the order the editor added them.
const filesForVariant = (req, i) =>
  (req.files || [])
    .filter((f) => new RegExp(`^variantImage_${i}(_\\d+)?$`).test(f.fieldname))
    .sort((a, b) => a.fieldname.localeCompare(b.fieldname, undefined, { numeric: true }));

// Meta takes one main image plus up to 10 more on the detail carousel.
const MAX_VARIANT_IMAGES = 10;

async function uploadVariantImages(req, variants) {
  const folder = mediaFolder(bizId(req), 'products');
  return Promise.all(
    (variants || []).map(async (v, i) => {
      // Photos already hosted (the editor sends these back untouched), then the
      // newly picked files. Anything blob:/data: is dropped rather than stored.
      const kept = (Array.isArray(v.images) ? v.images : [v.imageUrl]).map(httpUrl).filter(Boolean);
      const added = await Promise.all(
        filesForVariant(req, i).map((f) => storage.uploadBuffer(f.buffer, folder, 'image')),
      );
      const images = [...new Set([...kept, ...added])].slice(0, MAX_VARIANT_IMAGES);
      // Accept the list, falling back to the old single value. De-duped
      // case-insensitively: Meta groups picker options by exact string, so
      // "Hot" and "hot" would otherwise show up twice.
      const rawSubs = Array.isArray(v.subVariants)
        ? v.subVariants
        : [v.subVariants, v.subVariant].filter(Boolean);
      const seen = new Set();
      const subVariants = rawSubs
        .map((s) => String(s || '').trim())
        .filter((s) => {
          const k = s.toLowerCase();
          if (!s || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      return {
        ...v,
        images,
        // imageUrl stays the primary photo so older readers keep working.
        imageUrl: images[0] || '',
        subVariants,
        subVariant: subVariants[0] || '',
      };
    }),
  );
}

/** Every image URL a product references, for storage cleanup. */
const allImageUrls = (product) =>
  [
    product?.imageUrl,
    ...(product?.variants || []).flatMap((v) => [v.imageUrl, ...(v.images || [])]),
  ].filter(Boolean);

// The product's own image: an uploaded file wins, then a hosted URL from the
// body, then the first variant that has one.
async function resolveProductImage(req, variants, bodyUrl) {
  const file = fileNamed(req, 'image');
  if (file) {
    return storage.uploadBuffer(file.buffer, mediaFolder(bizId(req), 'products'), 'image');
  }
  return httpUrl(bodyUrl) || variants.find((v) => v.imageUrl)?.imageUrl || '';
}

// Meta only accepts its own variant fields, so a free-text label can't be sent
// verbatim. Match it to the closest field when it's obvious, else fall back to
// 'color' — the label itself is still shown in our UI and the description.
const SUB_FIELDS = ['color', 'pattern', 'material'];
function subFieldFor(label) {
  const l = String(label || '').toLowerCase();
  if (/colour|color/.test(l)) return 'color';
  if (/material|fabric/.test(l)) return 'material';
  if (/pattern|print|design/.test(l)) return 'pattern';
  return 'color';
}
const pickSubField = (v, label) => (SUB_FIELDS.includes(String(v || '')) ? String(v) : subFieldFor(label));

// ---------------- Categories ----------------
router.get('/categories', async (req, res) => {
  const data = await Category.find(owner(req)).sort({ order: 1, name: 1 }).lean();
  res.json({ success: true, data });
});

router.post('/categories', uploadMedia.single('image'), async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'name required' });
    let imageUrl = '';
    if (req.file) {
      imageUrl = await storage.uploadBuffer(req.file.buffer, mediaFolder(bizId(req), 'categories'), 'image');
    }
    // Ordering is per tenant, so the count must be too — a global count made
    // one business's first category sort after another's whole list.
    const count = await Category.countDocuments(owner(req));
    const cat = await Category.create({ businessId: req.business._id, name, imageUrl, order: count + 1 });
    res.status(201).json({ success: true, data: cat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/categories/:id', uploadMedia.single('image'), async (req, res) => {
  try {
    const existing = await Category.findOne({ _id: req.params.id, ...owner(req) }).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });

    const update = {};
    const name = (req.body?.name || '').trim();
    if (name) update.name = name;
    if (req.file) {
      update.imageUrl = await storage.uploadBuffer(req.file.buffer, mediaFolder(bizId(req), 'categories'), 'image');
    }
    const cat = await Category.findOneAndUpdate(
      { _id: req.params.id, ...owner(req) },
      { $set: update },
      { new: true },
    );
    if (!cat) return res.status(404).json({ success: false, message: 'Not found' });
    // Image replaced → drop the old file (after the new one is safely stored).
    if (update.imageUrl && existing.imageUrl && existing.imageUrl !== update.imageUrl) {
      storage.deleteByUrl(existing.imageUrl).catch(() => {});
    }
    res.json({ success: true, data: cat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/categories/:id', async (req, res) => {
  const cat = await Category.findOne({ _id: req.params.id, ...owner(req) }).lean();
  if (cat) {
    await Category.deleteOne({ _id: req.params.id, ...owner(req) });
    if (cat.imageUrl) storage.deleteByUrl(cat.imageUrl).catch(() => {});
  }
  res.json({ success: true });
});

// ---------------- Products ----------------
router.get('/products', async (req, res) => {
  const data = await Product.find(owner(req)).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data });
});

router.post('/products', uploadMedia.any(), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim() || !Number(b.price)) {
      return res.status(400).json({ success: false, message: 'name and price are required' });
    }
    const variants = await uploadVariantImages(req, parseJson(b.variants, []));
    const imageUrl = await resolveProductImage(req, variants, b.imageUrl);

    const product = await Product.create({
      businessId: req.business._id,
      name: b.name.trim(),
      retailerId: slugify(b.name),
      description: b.description || '',
      categories: parseJson(b.categories, []),
      price: Number(b.price),
      mrp: Number(b.mrp) || 0,
      freeDelivery: b.freeDelivery === 'true' || b.freeDelivery === true,
      deliveryCharge: Number(b.deliveryCharge) || 0,
      unit: b.unit || 'unit',
      quantity: Number(b.quantity) || 0,
      imageUrl,
      variants,
      subVariantLabel: String(b.subVariantLabel || '').trim(),
      subVariantField: pickSubField(b.subVariantField, b.subVariantLabel),
      soldOutSchedule: parseJson(b.soldOutSchedule, { enabled: false, type: 'daily' }),
    });
    // Awaited and returned: a failed push used to be swallowed, so a product
    // could look saved while never reaching Meta.
    const sync = await catalog.syncProductToMeta(product, req.business);
    res.status(201).json({ success: true, data: await Product.findById(product._id).lean(), sync });
  } catch (err) {
    logger.error('create product failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/products/:id', uploadMedia.any(), async (req, res) => {
  try {
    const b = req.body || {};
    const existing = await Product.findOne({ _id: req.params.id, ...owner(req) }).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });

    const variants = await uploadVariantImages(req, parseJson(b.variants, []));
    const update = {
      name: b.name?.trim(),
      description: b.description || '',
      categories: parseJson(b.categories, []),
      price: Number(b.price),
      mrp: Number(b.mrp) || 0,
      freeDelivery: b.freeDelivery === 'true' || b.freeDelivery === true,
      deliveryCharge: Number(b.deliveryCharge) || 0,
      unit: b.unit || 'unit',
      quantity: Number(b.quantity) || 0,
      variants,
      subVariantLabel: String(b.subVariantLabel || '').trim(),
      subVariantField: pickSubField(b.subVariantField, b.subVariantLabel),
      soldOutSchedule: parseJson(b.soldOutSchedule, { enabled: false, type: 'daily' }),
      catalogSynced: false,
      imageUrl: await resolveProductImage(req, variants, b.imageUrl),
    };

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, ...owner(req) },
      { $set: update },
      { new: true },
    );
    if (!product) return res.status(404).json({ success: false, message: 'Not found' });
    // Reclaim every photo the product no longer references — a variant can now
    // hold up to 10, so comparing only the primary would leak the rest.
    const keep = new Set(allImageUrls({ imageUrl: update.imageUrl, variants }));
    for (const old of new Set(allImageUrls(existing))) {
      if (!keep.has(old)) storage.deleteByUrl(old).catch(() => {});
    }

    const sync = await catalog.syncProductToMeta(product, req.business);
    res.json({ success: true, data: await Product.findById(product._id).lean(), sync });
  } catch (err) {
    logger.error('update product failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/products/:id/availability', async (req, res) => {
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, ...owner(req) },
    { $set: { isPaused: !!req.body?.paused } },
    { new: true },
  );
  if (!product) return res.status(404).json({ success: false, message: 'Not found' });
  const sync = await catalog.syncProductToMeta(product, req.business);
  res.json({ success: true, data: await Product.findById(product._id).lean(), sync });
});

router.delete('/products/:id', async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, ...owner(req) });
  if (product) {
    const urls = allImageUrls(product);
    await catalog.deleteProductFromMeta(product, req.business).catch(() => {});
    await product.deleteOne();
    for (const u of new Set(urls)) storage.deleteByUrl(u).catch(() => {});
  }
  res.json({ success: true });
});

// Push the whole catalog to Meta.
router.post('/sync', async (req, res) => {
  const result = await catalog.syncAll(req.business);
  res.json({ success: !result.error, ...result });
});

// What Meta currently holds, so a mismatch is visible without leaving the CRM.
router.get('/meta-items', async (req, res) => {
  const catalogId = String(req.business.catalogId || '').trim();
  if (!catalogId) {
    return res.status(400).json({ success: false, message: 'No catalog ID is set for this business.' });
  }
  try {
    const meta = getClientForBusiness(req.business);
    const items = await meta.getCatalogProducts(catalogId, 100);
    res.json({ success: true, catalogId, count: items.length, data: items });
  } catch (err) {
    const message = err.response?.data?.error?.message || err.message;
    logger.error('meta catalog read failed', { catalogId, error: message });
    res.status(502).json({ success: false, message });
  }
});

export default router;
