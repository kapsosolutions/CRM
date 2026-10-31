// ---------------------------------------------------------------------------
// Sync CRM products to the Meta Commerce catalog.
//
// Variants: no variants -> a single item (retailer_id = product.retailerId).
// With variants -> one item per size, retailer_id = `${base}__v${i}`, all
// sharing item_group_id = base AND each carrying a distinct `size` label.
// Both parts matter: item_group_id groups them, `size` is what Meta uses to
// label the options, so without it you get several lookalike products instead
// of one with a size picker.
//
// The catalog belongs to the tenant, not the server — each business has its own
// catalogId and access token, so every entry point takes the business.
// ---------------------------------------------------------------------------
import Product from '../models/Product.js';
import { getClientForBusiness } from './metaCloud.js';
import { offerPricesForProduct, priceKey } from './offers.js';
import logger from './logger.js';

const catalogIdOf = (business) => String(business?.catalogId || '').trim();

export function isEnabled(business) {
  return !!catalogIdOf(business);
}

// Effective availability: active AND in stock AND not manually paused.
export function availabilityOf(p) {
  return p.active !== false && p.inStock !== false && !p.isPaused ? 'in stock' : 'out of stock';
}

export const variantLabel = (v) => v.label || `${v.quantity || ''} ${v.unit || ''}`.trim();

// Second-axis options for a size, tolerating the older single-value shape.
export const subVariantsOf = (v) => {
  const list = Array.isArray(v?.subVariants) && v.subVariants.length
    ? v.subVariants
    : [v?.subVariant];
  return list.map((s) => String(s || '').trim()).filter(Boolean);
};

// A browser object URL that leaked through from the editor. Meta can't fetch it
// and it dies with the tab, so treat it as no image at all.
const usableUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');

function buildDescription(p) {
  const parts = [];
  if (p.quantity > 0) parts.push(`Pack: ${p.quantity} ${p.unit || 'unit'}`);
  if (Array.isArray(p.variants) && p.variants.length) {
    parts.push(
      'Available sizes:\n' +
        p.variants.map((v) => `${variantLabel(v)} - Rs.${v.price}`).join('\n'),
    );
    // The business's own wording for the second axis. WhatsApp labels the
    // picker itself (localised, not overridable), so spelling it out here is
    // the only way the customer sees what the options actually mean.
    const subs = [...new Set(p.variants.flatMap(subVariantsOf))];
    if (subs.length) {
      parts.push(`${String(p.subVariantLabel || '').trim() || 'Options'}: ${subs.join(', ')}`);
    }
  }
  parts.push(p.description || p.name);
  return parts.join('\n\n').slice(0, 5000);
}

// Every usable photo for a variant: its own gallery, falling back to the
// product image. First one is the main image, the rest become the ‹ › carousel.
function variantImages(v, productImage) {
  const list = (Array.isArray(v?.images) && v.images.length ? v.images : [v?.imageUrl])
    .map(usableUrl)
    .filter(Boolean);
  const unique = [...new Set(list)];
  return unique.length ? unique : [productImage].filter(Boolean);
}

/**
 * Build the catalog items for a product.
 *
 * @param {object} p product document
 * @param {object} business owning tenant
 * @param {Map<string, number>} [offerPrices] keys from services/offers.js
 *   `priceKey`: "1" for a whole size, "1:0" for one of its sub-variants.
 *   Becomes Meta's `sale_price`, which is what draws the struck-through
 *   original in WhatsApp. An item with no entry has its sale price cleared.
 */
export function expandToCatalogItems(p, business, offerPrices = null) {
  /**
   * The sale price for one catalog item.
   *
   * A discount on the exact sub-variant and one on the whole size are both
   * candidates — the cheaper wins, the same rule as two overlapping offers.
   * Only a genuine reduction is sent: an "offer" at or above the list price
   * would draw a strikethrough with nothing saved, which looks like a bug.
   */
  const saleFor = (idx, sub, listPrice) => {
    if (!offerPrices) return undefined;
    const list = Number(listPrice);
    const candidates = [priceKey(idx, sub), priceKey(idx, -1)]
      .map((k) => Number(offerPrices.get(k)))
      .filter((n) => n > 0 && n < list);
    return candidates.length ? Math.min(...candidates) : undefined;
  };
  const base = {
    description: buildDescription(p),
    currency: 'INR',
    availability: availabilityOf(p),
    groupId: p.retailerId,
    brand: business?.name || undefined,
  };
  const productImage = usableUrl(p.imageUrl);

  if (Array.isArray(p.variants) && p.variants.length) {
    // Each size crossed with its sub-variants: 2 sizes x 2 spice levels is 4
    // selectable items, which is what makes WhatsApp show two pickers.
    return p.variants.flatMap((v, i) => {
      const photos = variantImages(v, productImage);
      const size = variantLabel(v) || `Option ${i + 1}`;
      const subs = subVariantsOf(v);
      const listPrice = v.price || p.price;
      const row = (sub, j) => ({
        ...base,
        // Suffix keeps ids stable per combination; a size with no sub-variant
        // keeps its original __v<i> id so existing catalog items aren't churned.
        retailerId: sub ? `${p.retailerId}__v${i}s${j}` : `${p.retailerId}__v${i}`,
        // Both axes in the title, so the listing reads clearly too.
        name: [p.name, size, sub].filter(Boolean).join(' - '),
        size,
        // The sub-variant always goes into Meta's `color` field — see the
        // comment in metaCloud.batchUpsertCatalogProducts for why it isn't
        // chosen from the wording any more.
        ...(sub ? { subValue: sub } : {}),
        price: listPrice,
        // A size with no sub-variants can only be priced as a whole size.
        salePrice: saleFor(i, sub ? j : -1, listPrice),
        imageUrl: photos[0] || '',
        additionalImages: photos.slice(1, 11),
      });
      return subs.length ? subs.map(row) : [row('', 0)];
    });
  }
  return [
    {
      ...base,
      retailerId: p.retailerId,
      name: p.name,
      price: p.price,
      // The offer editor stores a variant-less product under index 0.
      salePrice: saleFor(0, -1, p.price),
      imageUrl: productImage,
      additionalImages: (p.gallery || []).map(usableUrl).filter(Boolean).slice(0, 10),
    },
  ];
}

/**
 * Every retailer id this product owns on the catalog — the bare id plus
 * anything suffixed `__…` (`__v1`, `__v1s0`).
 *
 * Discovered from the catalog rather than read from `catalogItemIds`, because
 * ids minted under an earlier naming scheme are no longer in that list. Such an
 * orphan is invisible to cleanup and keeps its old variant attribute alive on
 * the product group, which is what makes WhatsApp grey out a size: the group
 * ends up advertising an axis none of the current items carry.
 */
function ownedCatalogIds(allIds, retailerId) {
  const base = String(retailerId || '');
  if (!base) return [];
  return allIds.filter((id) => id === base || String(id).startsWith(`${base}__`));
}

/** Ids to remove: everything this product owns that the new push won't cover. */
async function staleIdsFor(meta, catalogId, product, newIds) {
  const remembered = (product.catalogItemIds || []).filter((id) => !newIds.includes(id));
  try {
    const all = await meta.listCatalogRetailerIds(catalogId);
    const owned = ownedCatalogIds(all, product.retailerId).filter((id) => !newIds.includes(id));
    return [...new Set([...remembered, ...owned])];
  } catch (err) {
    // Fall back to what we remember rather than skipping the push entirely.
    logger.warn('could not list catalog items; cleaning up remembered ids only', {
      retailerId: product.retailerId,
      error: err.response?.data?.error?.message || err.message,
    });
    return remembered;
  }
}

/**
 * Meta rejects an item outright if a required feed field is missing, so check
 * before pushing — a clear message beats a silently absent product.
 */
function validateItems(items) {
  const problems = [];
  for (const it of items) {
    if (!it.imageUrl) problems.push(`"${it.name}" has no image (Meta requires image_link)`);
    if (!(Number(it.price) > 0)) problems.push(`"${it.name}" has no price`);
  }
  return [...new Set(problems)];
}

/** Sync one product to this tenant's Meta catalog: upsert, clean up, persist. */
export async function syncProductToMeta(product, business) {
  const catalogId = catalogIdOf(business);
  if (!catalogId) {
    const reason = 'No catalog ID is set for this business — add it in the admin panel.';
    await Product.updateOne({ _id: product._id }, { $set: { catalogSynced: false, catalogError: reason } });
    return { synced: false, reason };
  }

  // Live offers become `sale_price`, so saving a product also republishes
  // whatever discount is currently running on it.
  const offerPrices = await offerPricesForProduct(product._id);
  const items = expandToCatalogItems(product, business, offerPrices);
  const problems = validateItems(items);
  if (problems.length) {
    const reason = problems.join('; ');
    logger.warn('catalog sync skipped: incomplete item', { retailerId: product.retailerId, reason });
    await Product.updateOne({ _id: product._id }, { $set: { catalogSynced: false, catalogError: reason } });
    return { synced: false, reason };
  }

  try {
    const meta = getClientForBusiness(business);
    const newIds = items.map((it) => it.retailerId);
    // Drop items this product used to own (a removed variant, or an id from an
    // older naming scheme). Deleting first matters: a leftover item is what
    // keeps a phantom variant axis on the product group.
    const stale = await staleIdsFor(meta, catalogId, product, newIds);
    if (stale.length) {
      try {
        await meta.deleteCatalogProducts(catalogId, stale);
        logger.info('removed stale catalog items', { retailerId: product.retailerId, stale });
      } catch (err) {
        // Previously swallowed, which made a failed cleanup indistinguishable
        // from a clean one while the variant picker quietly stayed broken.
        logger.error('could not remove stale catalog items', {
          retailerId: product.retailerId,
          stale,
          error: err.response?.data?.error?.message || err.message,
        });
      }
    }

    const res = await meta.batchUpsertCatalogProducts(catalogId, items);
    await Product.updateOne(
      { _id: product._id },
      { $set: { catalogItemIds: newIds, catalogSynced: true, catalogError: '', catalogSyncedAt: new Date() } },
    );
    logger.info('catalog product synced', { retailerId: product.retailerId, items: newIds.length, handles: res?.handles?.length });
    return { synced: true, items: newIds.length };
  } catch (err) {
    const reason = err.response?.data?.error?.message || err.message;
    logger.error('syncProductToMeta failed', { retailerId: product.retailerId, error: reason });
    await Product.updateOne({ _id: product._id }, { $set: { catalogSynced: false, catalogError: reason } });
    return { synced: false, reason };
  }
}

export async function deleteProductFromMeta(product, business) {
  const catalogId = catalogIdOf(business);
  if (!catalogId) return null;
  const meta = getClientForBusiness(business);
  // Same discovery as the sync: deleting only the remembered ids would leave
  // variants from an older naming scheme on the catalog for ever.
  const ids = [...new Set([
    ...(product.catalogItemIds || []),
    product.retailerId,
    ...(await staleIdsFor(meta, catalogId, product, [])),
  ].filter(Boolean))];
  if (!ids.length) return null;
  return meta.deleteCatalogProducts(catalogId, ids).catch((err) => {
    logger.error('deleteProductFromMeta failed', { ids, error: err.response?.data?.error?.message || err.message });
    return null;
  });
}

/**
 * Re-push specific products — used after an offer changes.
 *
 * Takes ids rather than documents so a caller can pass the union of the
 * products an offer used to cover and the ones it covers now: a product dropped
 * from an offer has to be pushed too, otherwise its sale price would stay on
 * the catalog after the discount ended.
 *
 * @param {string[]} productIds
 * @param {object} business owning tenant
 */
export async function syncProducts(productIds, business) {
  const ids = [...new Set((productIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { pushed: 0, failed: 0, total: 0 };
  if (!catalogIdOf(business)) {
    return { pushed: 0, failed: 0, total: ids.length, error: 'No catalog ID is set for this business.' };
  }

  // Scoped to the tenant: the ids come from an offer, and pushing a product
  // this business doesn't own into its Meta catalog would leak the other
  // tenant's item (name, price and photo) into a stranger's shop.
  const products = await Product.find({ _id: { $in: ids }, businessId: business._id });
  let pushed = 0;
  const errors = [];
  for (const p of products) {
    // eslint-disable-next-line no-await-in-loop
    const r = await syncProductToMeta(p, business);
    if (r.synced) pushed += 1;
    else errors.push(`${p.name}: ${r.reason}`);
  }
  logger.info('offer change re-synced products', { products: products.length, pushed, failed: errors.length });
  return { pushed, failed: errors.length, total: products.length, ...(errors.length ? { errors } : {}) };
}

/** Push every active product for this tenant. */
export async function syncAll(business) {
  if (!catalogIdOf(business)) {
    return { pushed: 0, failed: 0, total: 0, error: 'No catalog ID is set for this business.' };
  }
  // Tenant-scoped. Unscoped, "Sync catalog" uploaded *every* business's
  // products into whichever tenant pressed the button — their WhatsApp shop
  // would fill up with other companies' items.
  const products = await Product.find({ active: true, businessId: business._id });
  let pushed = 0;
  const errors = [];
  for (const p of products) {
    // eslint-disable-next-line no-await-in-loop
    const r = await syncProductToMeta(p, business);
    if (r.synced) pushed += 1;
    else errors.push(`${p.name}: ${r.reason}`);
  }
  return { pushed, failed: errors.length, total: products.length, errors };
}

/**
 * Build `product_list` sections for a native catalog message.
 *
 * A variant product is several catalog items sharing an item_group_id, so the
 * list references the first variant (`<retailerId>__v0`) — that's the card Meta
 * expands into the size picker. Only items we actually pushed are referenced,
 * because Meta silently drops retailer ids it doesn't recognise (which is what
 * an unsynced product looks like: an empty catalog message).
 *
 * @param {object} business the owning tenant
 * @param {string} [categoryName] restrict to one category; omit for everything
 * @returns {Promise<{sections: {title: string, productRetailerIds: string[]}[], total: number, title: string}|null>}
 */
export async function buildCategorySections(business, categoryName = '') {
  if (!catalogIdOf(business)) return null;

  const query = { active: true, businessId: business._id };
  if (categoryName) query.categories = categoryName;

  const products = await Product.find(query)
    .select('retailerId variants catalogSynced catalogItemIds subVariantLabel')
    .sort({ createdAt: -1 })
    .lean();

  const ids = [];
  for (const p of products) {
    if (!p.retailerId) continue;
    // Reference whatever was actually pushed — with sub-variants the first item
    // is `__v0s0`, not `__v0`, and Meta silently drops ids it doesn't know
    // (which renders as a card with nothing in it).
    const pushed = p.catalogItemIds || [];
    const id = pushed[0] || (p.variants?.length ? `${p.retailerId}__v0` : p.retailerId);
    if (p.catalogSynced === false && !pushed.length) continue;
    ids.push(id);
  }
  if (!ids.length) return null;

  const title = categoryName || 'Products';
  return {
    title,
    total: ids.length,
    sections: [{ title: title.slice(0, 24), productRetailerIds: ids.slice(0, 30) }],
  };
}

export default {
  isEnabled,
  syncProductToMeta,
  syncProducts,
  deleteProductFromMeta,
  syncAll,
  expandToCatalogItems,
  availabilityOf,
  buildCategorySections,
};
