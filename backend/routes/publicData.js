// ---------------------------------------------------------------------------
// The public API's data endpoints (mounted inside /api/v1 after the API key
// check): a business's catalog, categories, members (doctors, stylists,
// rooms… whatever its business type calls them), their free slots, live
// offers, and bookings — so its own website or app can show and use them.
//
//   GET   /business                       name, WhatsApp number, what it calls things
//   GET   /catalog/categories             categories
//   GET   /catalog/products               ?category= &q= &inStock= &limit= &offset=
//   GET   /catalog/products/:id           a product by id or SKU
//   PATCH /catalog/products/:id           price / mrp / inStock / active   (secret key)
//   GET   /offers                         live offers
//   GET   /members                        ?category= &limit= &offset=
//   GET   /members/:id
//   GET   /members/:id/slots              ?date=YYYY-MM-DD
//   GET   /members/:id/availability       ?from=YYYY-MM-DD &days=14
//   POST  /bookings                       book a slot                      (secret key)
//   GET   /bookings/:id                                                    (secret key)
//   POST  /bookings/:id/cancel                                             (secret key)
//
// Publishable keys (kp_pub_…) can call the GET endpoints except /bookings
// (middleware/apiKey.js). Every query is scoped to the key's business; a
// member's phone, email and absence reasons are never returned.
// ---------------------------------------------------------------------------
import express from 'express';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Member from '../models/Member.js';
import Offer from '../models/Offer.js';
import Registration from '../models/Registration.js';
import Order from '../models/Order.js';
import { assertFeature } from '../services/plans.js';
import { availabilityOf, variantLabel, subVariantsOf, syncProductToMeta } from '../services/catalog.js';
import { isLive, priceKey } from '../services/offers.js';
import { availableSlots, bookedCounts, scheduleOf, todayISO, to12h } from '../services/slots.js';
import { verticalConfig } from '../services/verticals.js';
import { makeOrderReference } from '../services/orders.js';
import { notify } from '../services/notifications.js';
import { ApiFail, respondCommon, requireSecret, once } from './apiShared.js';
import logger from '../services/logger.js';

const router = express.Router();

const ID_RE = /^[a-f0-9]{24}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLOT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_DAYS_AHEAD = 180;
const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

/** The API in the plan, plus the page the data belongs to. */
function allow(req, feature) {
  assertFeature(req.business, 'api');
  if (feature) assertFeature(req.business, feature);
}

/** Reads may be cached briefly by browsers and CDNs in front of the site. */
const cacheable = (res, seconds = 60) => res.set('Cache-Control', `public, max-age=${seconds}`);

function pageOf(req, max = 100) {
  const limit = Math.min(max, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  return { limit, offset };
}

/** 'YYYY-MM-DD' that is a real date, not in the past, within MAX_DAYS_AHEAD. */
function checkDate(raw, field = 'date') {
  const d = str(raw, 10);
  if (!DATE_RE.test(d) || Number.isNaN(new Date(`${d}T00:00:00`).getTime())) {
    throw new ApiFail(400, 'invalid_date', `"${field}" must be a date as YYYY-MM-DD, e.g. "2026-12-01".`);
  }
  const today = todayISO();
  if (d < today) throw new ApiFail(400, 'date_in_past', `"${field}" is in the past.`);
  const last = new Date(`${today}T00:00:00`);
  last.setDate(last.getDate() + MAX_DAYS_AHEAD);
  if (new Date(`${d}T00:00:00`) > last) throw new ApiFail(400, 'date_too_far', `"${field}" can be at most ${MAX_DAYS_AHEAD} days ahead.`);
  return d;
}

// ---------------------------------------------------------------- business

router.get('/business', (req, res) => {
  try {
    allow(req, null);
    const b = req.business;
    const v = verticalConfig(b.category, b.labels);
    const number = String(b.meta?.displayPhoneNumber || '').replace(/\D/g, '');
    cacheable(res, 300);
    res.json({
      name: b.meta?.verifiedName || b.name || '',
      category: { key: v.key, label: v.label },
      // What this business calls its members and categories ("Doctors",
      // "Specialisation"), so a website can label its pages the same way.
      labels: {
        member: v.memberSingular, members: v.memberLabel, category: v.categoryLabel, categories: v.categoryPlural, fee: v.feeLabel,
      },
      whatsapp: number ? { number: `+${number}`, link: `https://wa.me/${number}` } : null,
      currency: 'INR',
    });
  } catch (err) {
    respondCommon(res, err, 'business');
  }
});

// ---------------------------------------------------------------- categories

router.get('/catalog/categories', async (req, res) => {
  try {
    allow(req, 'categories');
    const rows = await Category.find({ businessId: req.business._id, active: { $ne: false } }).sort({ order: 1, name: 1 }).lean();
    cacheable(res);
    res.json({ data: rows.map((c) => ({ id: String(c._id), name: c.name, imageUrl: c.imageUrl || null, order: c.order || 0 })) });
  } catch (err) {
    respondCommon(res, err, 'categories');
  }
});

// ---------------------------------------------------------------- products

/** productId → Map(priceKey → lowest live offer price), for this business. */
async function liveOfferPrices(businessId) {
  const out = new Map();
  const offers = await Offer.find({ businessId, active: true }).select('active startsAt endsAt items').lean();
  for (const offer of offers) {
    if (!isLive(offer)) continue;
    for (const it of offer.items || []) {
      const price = Number(it.offerPrice);
      if (!(price > 0) || !it.product) continue;
      const pid = String(it.product);
      const sub = it.subIndex === undefined || it.subIndex === null ? -1 : Number(it.subIndex);
      const key = priceKey(Number(it.variantIndex) || 0, sub);
      const map = out.get(pid) || new Map();
      if (!map.has(key) || price < map.get(key)) map.set(key, price);
      out.set(pid, map);
    }
  }
  return out;
}

const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

/** A product as the API shows it. Offer prices only when they're a real reduction. */
export function productView(p, offers = new Map()) {
  const prices = offers.get(String(p._id)) || new Map();
  const sale = (keys, list) => {
    const c = keys.map((k) => Number(prices.get(k))).filter((n) => n > 0 && n < Number(list));
    return c.length ? Math.min(...c) : null;
  };
  const variants = (p.variants || []).map((v, i) => {
    const listPrice = Number(v.price) || Number(p.price) || 0;
    const imgs = [...new Set([v.imageUrl, ...(v.images || [])].map(httpUrl).filter(Boolean))];
    return {
      index: i,
      label: variantLabel(v) || `Option ${i + 1}`,
      price: listPrice,
      offerPrice: sale([priceKey(i, -1)], listPrice),
      imageUrl: imgs[0] || null,
      images: imgs,
      options: subVariantsOf(v).map((label, j) => ({ label, offerPrice: sale([priceKey(i, j), priceKey(i, -1)], listPrice) })),
    };
  });
  const images = [...new Set([p.imageUrl, ...(p.gallery || [])].map(httpUrl).filter(Boolean))];
  return {
    id: String(p._id),
    sku: p.retailerId || '',
    name: p.name,
    description: p.description || '',
    price: Number(p.price) || 0,
    mrp: Number(p.mrp) > Number(p.price) ? Number(p.mrp) : null,
    offerPrice: variants.length ? null : sale([priceKey(0, -1)], p.price),
    currency: 'INR',
    unit: p.unit || 'unit',
    quantity: Number(p.quantity) || 0,
    imageUrl: images[0] || null,
    images,
    categories: p.categories || [],
    availability: availabilityOf(p) === 'in stock' ? 'in_stock' : 'out_of_stock',
    delivery: p.freeDelivery ? { free: true, charge: 0 } : { free: false, charge: Number(p.deliveryCharge) || 0 },
    variants,
    variantOptionLabel: p.subVariantLabel || null,
    updatedAt: p.updatedAt || null,
  };
}

router.get('/catalog/products', async (req, res) => {
  try {
    allow(req, 'catalog');
    const { limit, offset } = pageOf(req);
    const filter = { businessId: req.business._id, active: { $ne: false } };
    const cat = str(req.query.category, 120);
    if (cat) filter.categories = cat;
    const q = str(req.query.q, 80);
    if (q) filter.name = { $regex: reEscape(q), $options: 'i' };
    if (String(req.query.inStock) === 'true') {
      filter.inStock = { $ne: false };
      filter.isPaused = { $ne: true };
    }
    const [rows, total, offers] = await Promise.all([
      Product.find(filter).sort({ name: 1 }).skip(offset).limit(limit).lean(),
      Product.countDocuments(filter),
      liveOfferPrices(req.business._id),
    ]);
    cacheable(res);
    res.json({
      data: rows.map((p) => productView(p, offers)),
      total, limit, offset, hasMore: offset + rows.length < total,
    });
  } catch (err) {
    respondCommon(res, err, 'products');
  }
});

async function findProduct(req) {
  const id = str(req.params.id, 120);
  const by = ID_RE.test(id) ? { _id: id } : { retailerId: id };
  const p = await Product.findOne({ businessId: req.business._id, ...by }).lean();
  if (!p) throw new ApiFail(404, 'product_not_found', 'No product with this id or SKU.');
  return p;
}

router.get('/catalog/products/:id', async (req, res) => {
  try {
    allow(req, 'catalog');
    const p = await findProduct(req);
    if (p.active === false) throw new ApiFail(404, 'product_not_found', 'No product with this id or SKU.');
    cacheable(res);
    res.json(productView(p, await liveOfferPrices(req.business._id)));
  } catch (err) {
    respondCommon(res, err, 'product');
  }
});

router.patch('/catalog/products/:id', async (req, res) => {
  try {
    requireSecret(req);
    allow(req, 'catalog');
    const p = await findProduct(req);
    const b = req.body || {};
    const set = {};
    if (b.price !== undefined) {
      const n = Number(b.price);
      if (!Number.isFinite(n) || n <= 0) throw new ApiFail(400, 'invalid_price', '"price" must be a number above 0.');
      set.price = Math.round(n * 100) / 100;
    }
    if (b.mrp !== undefined) {
      const n = Number(b.mrp);
      if (!Number.isFinite(n) || n < 0) throw new ApiFail(400, 'invalid_mrp', '"mrp" must be 0 or more.');
      set.mrp = Math.round(n * 100) / 100;
    }
    for (const k of ['inStock', 'active']) {
      if (b[k] !== undefined) {
        if (typeof b[k] !== 'boolean') throw new ApiFail(400, `invalid_${k.toLowerCase()}`, `"${k}" must be true or false.`);
        set[k] = b[k];
      }
    }
    if (!Object.keys(set).length) throw new ApiFail(400, 'nothing_to_update', 'Send at least one of "price", "mrp", "inStock", "active".');
    await Product.updateOne({ _id: p._id, businessId: req.business._id }, { $set: set });
    const fresh = await Product.findOne({ _id: p._id, businessId: req.business._id });
    // Keep the WhatsApp catalog in step; the answer doesn't wait for Meta.
    syncProductToMeta(fresh, req.business)
      .catch((e) => logger.warn('api product sync to Meta failed', { business: req.business.name, error: e.message }));
    logger.info('api product updated', { business: req.business.name, product: p.retailerId, fields: Object.keys(set), key: req.apiKey.prefix });
    res.json(productView(fresh.toObject ? fresh.toObject() : fresh, await liveOfferPrices(req.business._id)));
  } catch (err) {
    respondCommon(res, err, 'product update');
  }
});

// ---------------------------------------------------------------- offers

router.get('/offers', async (req, res) => {
  try {
    allow(req, 'offers');
    const rows = await Offer.find({ businessId: req.business._id, active: true }).sort({ createdAt: -1 }).lean();
    cacheable(res);
    res.json({
      data: rows.filter((o) => isLive(o)).map((o) => ({
        id: String(o._id),
        title: o.title || '',
        startsAt: o.startsAt || null,
        endsAt: o.endsAt || null,
        items: (o.items || []).map((it) => ({
          productId: it.product ? String(it.product) : null,
          productName: it.productName || '',
          imageUrl: httpUrl(it.productImageUrl),
          variantIndex: Number(it.variantIndex) || 0,
          option: it.subLabel || it.label || null,
          originalPrice: Number(it.originalPrice) || 0,
          offerPrice: Number(it.offerPrice) || 0,
          discount: { type: it.discountType === 'flat' ? 'flat' : 'percent', value: Number(it.discountValue) || 0 },
        })),
      })),
    });
  } catch (err) {
    respondCommon(res, err, 'offers');
  }
});

// ---------------------------------------------------------------- members

const DAY_NAMES = { mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday' };

/** A member as the API shows it: no phone, email or absence reasons. */
export function memberView(m) {
  const schedule = scheduleOf(m).map((d) => ({ day: DAY_NAMES[d.day] || d.day, windows: d.windows }));
  return {
    id: String(m._id),
    name: m.name,
    title: m.title || '',
    category: m.category || '',
    description: m.description || '',
    imageUrl: httpUrl(m.imageUrl),
    fee: Number(m.fee) || 0,
    currency: m.currency || 'INR',
    slotMinutes: Number(m.duration) > 0 ? Number(m.duration) : null,
    slotCapacity: Number(m.slotCapacity) > 0 ? Number(m.slotCapacity) : 1,
    experienceYears: Number(m.experience) || null,
    qualifications: m.qualifications || '',
    languages: m.languages || [],
    location: m.location || '',
    capacity: Number(m.capacity) || null,
    amenities: m.amenities || [],
    bookable: schedule.length > 0,
    schedule,
  };
}

router.get('/members', async (req, res) => {
  try {
    allow(req, 'members');
    const { limit, offset } = pageOf(req);
    const filter = { businessId: req.business._id, active: { $ne: false } };
    const cat = str(req.query.category, 120);
    if (cat) filter.category = cat;
    const [rows, total] = await Promise.all([
      Member.find(filter).sort({ order: 1, name: 1 }).skip(offset).limit(limit).lean(),
      Member.countDocuments(filter),
    ]);
    cacheable(res);
    res.json({ data: rows.map(memberView), total, limit, offset, hasMore: offset + rows.length < total });
  } catch (err) {
    respondCommon(res, err, 'members');
  }
});

async function findMember(req, id = req.params.id) {
  const mid = str(id, 40);
  if (!ID_RE.test(mid)) throw new ApiFail(400, 'invalid_id', 'That isn’t a member id.');
  const m = await Member.findOne({ _id: mid, businessId: req.business._id }).lean();
  if (!m || m.active === false) throw new ApiFail(404, 'member_not_found', 'No member with this id.');
  return m;
}

router.get('/members/:id', async (req, res) => {
  try {
    allow(req, 'members');
    const m = await findMember(req);
    cacheable(res);
    res.json(memberView(m));
  } catch (err) {
    respondCommon(res, err, 'member');
  }
});

router.get('/members/:id/slots', async (req, res) => {
  try {
    allow(req, 'members');
    const m = await findMember(req);
    const date = checkDate(req.query.date);
    const slots = await availableSlots({ member: m, isoDate: date, businessId: req.business._id });
    res.set('Cache-Control', 'no-store');
    res.json({ memberId: String(m._id), date, data: slots });
  } catch (err) {
    respondCommon(res, err, 'slots');
  }
});

router.get('/members/:id/availability', async (req, res) => {
  try {
    allow(req, 'members');
    const m = await findMember(req);
    const from = req.query.from ? checkDate(req.query.from, 'from') : todayISO();
    const days = Math.min(31, Math.max(1, Number.parseInt(req.query.days, 10) || 14));
    const out = [];
    const d = new Date(`${from}T00:00:00`);
    for (let i = 0; i < days; i += 1) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      // eslint-disable-next-line no-await-in-loop
      const slots = await availableSlots({ member: m, isoDate: iso, businessId: req.business._id });
      out.push({ date: iso, freeSlots: slots.length, firstSlot: slots[0]?.start || null });
      d.setDate(d.getDate() + 1);
    }
    res.set('Cache-Control', 'no-store');
    res.json({ memberId: String(m._id), from, days, data: out });
  } catch (err) {
    respondCommon(res, err, 'availability');
  }
});

// ---------------------------------------------------------------- bookings

const bookingView = (r, order) => ({
  id: String(r._id),
  memberId: r.memberId || null,
  member: r.memberName || '',
  category: r.category || '',
  date: r.date,
  slot: r.slot,
  slotLabel: r.slot ? to12h(r.slot) : '',
  name: r.name || '',
  phone: r.phone ? `+${r.phone}` : '',
  email: r.email || '',
  status: r.status === 'cancelled' ? 'cancelled' : r.status === 'done' ? 'completed' : 'confirmed',
  reference: order?.reference || r.orderRef || null,
  fee: order ? Number(order.total) || 0 : null,
  createdAt: r.createdAt || null,
});

router.post('/bookings', (req, res) => once(req, res, async () => {
  try {
    requireSecret(req);
    allow(req, 'orders');
    const b = req.body || {};
    const m = await findMember(req, b.memberId);
    const date = checkDate(b.date);
    const slot = str(b.slot, 5);
    if (!SLOT_RE.test(slot)) throw new ApiFail(400, 'invalid_slot', '"slot" must be a start time as HH:MM (24h), from GET /members/{id}/slots.');
    const name = str(b.name, 120);
    if (!name) throw new ApiFail(400, 'missing_name', '"name" is required: who the booking is for.');
    const phone = String(b.phone ?? '').replace(/[\s()+.-]/g, '');
    if (!/^\d{8,15}$/.test(phone)) throw new ApiFail(400, 'invalid_phone', '"phone" must be a phone number with country code, e.g. "+919876543210".');
    const email = str(b.email, 160).toLowerCase();
    if (email && !EMAIL_RE.test(email)) throw new ApiFail(400, 'invalid_email', '"email" isn’t a valid email address.');
    const notes = str(b.notes, 500);

    const free = await availableSlots({ member: m, isoDate: date, businessId: req.business._id });
    if (!free.some((s) => s.start === slot)) {
      throw new ApiFail(409, 'slot_unavailable', `${to12h(slot)} on ${date} isn’t free. Get the free times from GET /members/${m._id}/slots?date=${date}.`);
    }
    const reg = await Registration.create({
      businessId: req.business._id,
      phone,
      name,
      email,
      date,
      slot,
      category: m.category || '',
      memberId: String(m._id),
      memberName: m.name,
      action: 'register',
      status: 'new',
      fields: { source: 'api', ...(notes ? { notes } : {}), ...(email ? { email } : {}) },
      flowName: 'API',
    });
    // Two bookings racing for the last place: the later one gives it back.
    const capacity = Number(m.slotCapacity) > 0 ? Math.floor(Number(m.slotCapacity)) : 1;
    const taken = (await bookedCounts(req.business._id, m._id, date)).get(slot) || 0;
    if (taken > capacity) {
      await Registration.deleteOne({ _id: reg._id, businessId: req.business._id });
      throw new ApiFail(409, 'slot_unavailable', `${to12h(slot)} on ${date} was just taken. Pick another time.`);
    }
    // The Appointments list reads bookings from orders.
    const fee = Number(m.fee) || 0;
    const order = await Order.create({
      businessId: req.business._id,
      reference: makeOrderReference(req.business.name),
      kind: 'booking',
      scheduledAt: new Date(`${date}T${slot}:00`),
      registrationId: String(reg._id),
      member: m.name,
      customerName: name,
      phone,
      items: [{ name: m.name, qty: 1, price: fee }],
      total: fee,
      status: 'confirmed',
      paymentMethod: '',
      category: m.category || '',
      paid: false,
    });
    await Registration.updateOne({ _id: reg._id }, { $set: { orderId: String(order._id), orderRef: order.reference } });
    notify(req.business._id, {
      type: 'booking_new',
      title: 'New booking',
      body: [name, m.name, `${date} ${to12h(slot)}`, 'via API'].join(' · '),
      target: { view: 'orders', id: String(order._id), phone },
    }).catch(() => {});
    logger.info('api booking created', { business: req.business.name, member: m.name, date, slot, key: req.apiKey.prefix });
    res.status(201).json(bookingView({ ...reg.toObject?.() ?? reg, orderRef: order.reference }, order));
  } catch (err) {
    respondCommon(res, err, 'booking');
  }
}));

async function findBooking(req) {
  const id = str(req.params.id, 40);
  if (!ID_RE.test(id)) throw new ApiFail(400, 'invalid_id', 'That isn’t a booking id.');
  const r = await Registration.findOne({ _id: id, businessId: req.business._id }).lean();
  if (!r || !r.memberId) throw new ApiFail(404, 'booking_not_found', 'No booking with this id.');
  const order = r.orderId ? await Order.findOne({ _id: r.orderId, businessId: req.business._id }).lean() : null;
  return { r, order };
}

router.get('/bookings/:id', async (req, res) => {
  try {
    requireSecret(req);
    allow(req, 'orders');
    const { r, order } = await findBooking(req);
    res.json(bookingView(r, order));
  } catch (err) {
    respondCommon(res, err, 'booking status');
  }
});

router.post('/bookings/:id/cancel', async (req, res) => {
  try {
    requireSecret(req);
    allow(req, 'orders');
    const { r, order } = await findBooking(req);
    if (r.status === 'cancelled') return res.json(bookingView(r, order));
    if (r.status === 'done') throw new ApiFail(409, 'booking_completed', 'This booking is already completed.');
    const now = new Date();
    await Registration.updateOne({ _id: r._id, businessId: req.business._id }, { $set: { status: 'cancelled', cancelledAt: now } });
    if (order && order.status !== 'cancelled') {
      await Order.updateOne({ _id: order._id, businessId: req.business._id }, { $set: { status: 'cancelled', cancelledAt: now } });
    }
    notify(req.business._id, {
      type: 'booking_cancelled',
      title: `Booking cancelled${order?.reference ? ` ${order.reference}` : ''}`,
      body: [r.name, r.memberName, `${r.date} ${to12h(r.slot)}`, 'via API'].filter(Boolean).join(' · '),
      target: { view: 'orders', id: order ? String(order._id) : '', phone: r.phone },
    }).catch(() => {});
    logger.info('api booking cancelled', { business: req.business.name, booking: String(r._id), key: req.apiKey.prefix });
    res.json(bookingView({ ...r, status: 'cancelled' }, order ? { ...order, status: 'cancelled' } : null));
  } catch (err) {
    respondCommon(res, err, 'booking cancel');
  }
});

export default router;
