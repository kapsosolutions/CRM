// Offers view: a promotion that can target multiple products. Each selected
// variant (size) gets its own discount (percent or flat); checking a whole
// product selects all its sizes. Cards show the original price struck through
// next to the offer price. Tap + to build a new offer (full-page editor below).
import { useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type { CatalogSyncResult, Offer, OfferItem, Product, ProductVariant } from '../types';
import { CatalogPhonePreview, deliveryNoteOf, phoneVariantsFromProduct } from './CatalogPhonePreview';
import { useConfirm, useFlash } from './Dialogs';
import { useBackHandler } from '../useBackHandler';
import { CrmPageHero } from './CrmPageHero';
import { OffersRailSvg } from './NavRail';
import { offersHero } from '../emptyPages';
import { BladeSpinner } from './BladeSpinner';
import { CARD_PAGE_SIZES, Pager, usePaged } from './Pager';
import { WhatsAppConnectRequired } from './WhatsAppConnectRequired';
import type { BusinessProfile } from '../types';

interface Props {
  api: CrmApi;
  business?: BusinessProfile;
  demo?: boolean;
  onConnected?: (b: BusinessProfile) => void;
}

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/**
 * What to tell the business after an offer write.
 *
 * An offer is only real once Meta has it as a sale price, so a failed catalog
 * push is reported rather than hidden behind a cheerful "Saved".
 */
function syncMessage(sync: CatalogSyncResult | undefined, done: string): string {
  if (!sync) return done;
  if (sync.error) return `${done} The WhatsApp catalog was not updated: ${sync.error}`;
  if (sync.failed) {
    return `${done} ${sync.failed} product${sync.failed === 1 ? '' : 's'} failed to update in WhatsApp.`;
  }
  if (sync.pushed) {
    return `${done} ${sync.pushed} product${sync.pushed === 1 ? '' : 's'} updated in WhatsApp.`;
  }
  return done;
}

/**
 * One thing an offer can target: a whole size, or a single sub-variant of it.
 * `sub` is -1 for the whole size. Products with no variants are a single
 * target at index 0 using the base price.
 */
interface Selectable {
  index: number;
  sub: number;
  label: string; // the size, e.g. "500 piece"
  subLabel: string; // the sub-variant, e.g. "spicy" ('' for a whole size)
  price: number;
  imageUrl?: string;
}

const sizeLabelOf = (v: ProductVariant, i: number) =>
  v.label || `${v.quantity || ''} ${v.unit || ''}`.trim() || `Size ${i + 1}`;

const subsOf = (v?: ProductVariant): string[] =>
  (v?.subVariants || []).map((s) => String(s || '').trim()).filter(Boolean);

/** One target per size (the whole size, every sub-variant included). */
function sizeSelectables(p: Product): Selectable[] {
  if (p.variants && p.variants.length) {
    return p.variants.map((v: ProductVariant, i) => ({
      index: i,
      sub: -1,
      label: sizeLabelOf(v, i),
      subLabel: '',
      price: v.price || p.price || 0,
      imageUrl: v.imageUrl || p.imageUrl,
    }));
  }
  return [{ index: 0, sub: -1, label: p.unit || 'Default', subLabel: '', price: p.price || 0, imageUrl: p.imageUrl }];
}

/** One target per sub-variant of a given size. */
function subSelectables(p: Product, index: number): Selectable[] {
  const v = (p.variants || [])[index];
  if (!v) return [];
  return subsOf(v).map((s, j) => ({
    index,
    sub: j,
    label: sizeLabelOf(v, index),
    subLabel: s,
    price: v.price || p.price || 0,
    imageUrl: v.imageUrl || p.imageUrl,
  }));
}

function allSelectables(p: Product): Selectable[] {
  return sizeSelectables(p).flatMap((s) => [s, ...subSelectables(p, s.index)]);
}

/** "500 piece · spicy", or just the size when the whole size is targeted. */
const targetLabel = (it: { label: string; subLabel?: string }) =>
  it.subLabel ? `${it.label} · ${it.subLabel}` : it.label;

// Final price after a discount, clamped at ₹0 and rounded to whole rupees.
function computeOfferPrice(original: number, type: 'percent' | 'flat', value: number): number {
  const off = type === 'percent' ? (original * value) / 100 : value;
  return Math.max(0, Math.round(original - off));
}

const keyOf = (productId: string, index: number, sub: number) => `${productId}#${index}#${sub}`;

// Group an offer's items by product for display.
function groupByProduct(items: OfferItem[]) {
  const map = new Map<string, { name: string; image?: string; items: OfferItem[] }>();
  for (const it of items) {
    if (!map.has(it.productId)) {
      map.set(it.productId, { name: it.productName, image: it.productImageUrl, items: [] });
    }
    map.get(it.productId)!.items.push(it);
  }
  return [...map.values()];
}

export function OffersPage({ api, business, demo, onConnected }: Props) {
  const flash = useFlash();
  const confirm = useConfirm();

  if (!demo && business && !business.whatsappConnected) {
    return <WhatsAppConnectRequired page="offers" api={api} business={business} onConnected={onConnected} />;
  }

  const [offers, setOffers] = useState<Offer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Offer | null | 'new'>(null);

  function load() {
    setLoading(true);
    Promise.all([api.getOffers(), api.getProducts()])
      .then(([o, p]) => {
        setOffers(o.data || []);
        setProducts(p.data || []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A failed catalog push turns the toast red rather than a cheerful green. */
  const report = (sync: CatalogSyncResult | undefined, done: string) =>
    flash(syncMessage(sync, done), sync?.error || sync?.failed ? 'error' : 'success');

  function toggleActive(o: Offer) {
    api
      .setOfferActive(o._id, !o.active)
      .then((r) => {
        setOffers((list) => list.map((x) => (x._id === o._id ? { ...x, active: !o.active } : x)));
        report(r.sync, o.active ? 'Offer switched off.' : 'Offer switched on.');
      })
      .catch((e) => flash(`Could not update the offer. ${e instanceof Error ? e.message : ''}`, 'error'));
  }
  async function remove(o: Offer) {
    const ok = await confirm({
      title: 'Delete offer?',
      message: `“${o.title}” will be deleted and its products go back to their normal prices in WhatsApp.`,
      confirmLabel: 'Delete offer',
    });
    if (!ok) return;
    try {
      const r = await api.deleteOffer(o._id);
      setOffers((list) => list.filter((x) => x._id !== o._id));
      report(r.sync, 'Offer deleted.');
    } catch (e) {
      flash(`Delete failed. ${e instanceof Error ? e.message : 'Could not delete the offer.'}`, 'error');
    }
  }

  const paged = usePaged(offers, '', { key: 'offers', size: 24, sizes: CARD_PAGE_SIZES, noun: ['offer', 'offers'] });

  if (editing) {
    return (
      <OfferEditor
        api={api}
        products={products}
        offer={editing === 'new' ? null : editing}
        onBack={() => setEditing(null)}
        onSaved={(sync) => {
          setEditing(null);
          report(sync, 'Offer saved.');
          load();
        }}
      />
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <h2>Offers</h2>
        <button className="page-add" onClick={() => setEditing('new')} title="Create offer">
          <span className="material-icons">add</span>
        </button>
      </header>

      <div className="page-body">
        {loading && <BladeSpinner center={true} containerHeight={200} />}
        {!loading && offers.length === 0 && (
          <CrmPageHero
            icon={<OffersRailSvg />}
            tone="amber"
            {...offersHero()}
            actionIcon="add"
            onAction={() => setEditing('new')}
            note={products.length === 0 ? 'Add products on the Catalog page first, so there’s something to put on offer.' : undefined}
            testId="offers-hero"
          />
        )}
        {!loading && offers.length > 0 && (
          <div className="offer-grid">
            {paged.items.map((o) => (
              <div className={`offer-card${o.active ? '' : ' off'}`} key={o._id}>
                <div className="offer-card-head">
                  <div className="offer-card-ttl">
                    <div className="offer-card-title">{o.title}</div>
                    <div className="offer-card-prod">
                      {groupByProduct(o.items).length} product(s) · {o.items.length} size(s)
                    </div>
                  </div>
                  <span className={`offer-badge ${o.active ? 'on' : 'off'}`}>
                    {o.active ? 'Active' : 'Off'}
                  </span>
                </div>

                <div className="offer-prod-groups">
                  {groupByProduct(o.items).map((g, gi) => (
                    <div className="offer-prod-group" key={gi}>
                      <div className="offer-prod-row">
                        <div className="offer-card-img sm">
                          {g.image ? <img src={g.image} alt="" /> : <span className="material-icons">local_offer</span>}
                        </div>
                        <span className="offer-prod-name">{g.name}</span>
                      </div>
                      <div className="offer-var-list">
                        {g.items.map((v) => {
                          const save = Math.max(0, v.originalPrice - v.offerPrice);
                          return (
                            <div className="offer-var-row" key={`${v.variantIndex}#${v.subIndex ?? -1}`}>
                              <span className="ovr-label">{targetLabel(v)}</span>
                              <span className="ovr-prices">
                                <span className="ovr-orig">{money(v.originalPrice)}</span>
                                <span className="ovr-offer">{money(v.offerPrice)}</span>
                              </span>
                              {save > 0 && (
                                <span className="ovr-save">
                                  {v.discountType === 'percent' ? `${v.discountValue}% off` : `Save ${money(save)}`}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="offer-card-actions">
                  <button className="prod-act" onClick={() => toggleActive(o)} title={o.active ? 'Turn off' : 'Turn on'}>
                    <span className="material-icons">{o.active ? 'toggle_on' : 'toggle_off'}</span>
                  </button>
                  <button className="prod-act" onClick={() => setEditing(o)} title="Edit">
                    <span className="material-icons">edit</span>
                  </button>
                  <button className="prod-act danger" onClick={() => remove(o)} title="Delete">
                    <span className="material-icons">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && offers.length > 0 && <Pager {...paged.pager} />}
      </div>

    </div>
  );
}

// Per-selection discount settings, keyed by `${productId}#${index}`.
interface SelEntry {
  discountType: 'percent' | 'flat';
  discountValue: number;
}

function OfferEditor({
  api,
  products,
  offer,
  onBack,
  onSaved,
}: {
  api: CrmApi;
  products: Product[];
  offer: Offer | null;
  onBack: () => void;
  onSaved: (sync?: CatalogSyncResult) => void;
}) {
  const editing = !!offer;
  useBackHandler(true, onBack);
  const [title, setTitle] = useState(offer?.title || '');
  const [active, setActive] = useState(offer?.active ?? true);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Selection map seeded from the existing offer's items.
  const [sel, setSel] = useState<Record<string, SelEntry>>(() => {
    const init: Record<string, SelEntry> = {};
    for (const it of offer?.items || []) {
      // Items saved before sub-variants were targetable have no subIndex and
      // mean the whole size.
      init[keyOf(it.productId, it.variantIndex, it.subIndex ?? -1)] = {
        discountType: it.discountType,
        discountValue: it.discountValue,
      };
    }
    return init;
  });

  const productById = useMemo(() => {
    const m: Record<string, Product> = {};
    products.forEach((p) => (m[p._id] = p));
    return m;
  }, [products]);

  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  const fresh = (): SelEntry => ({ discountType: 'percent', discountValue: 10 });

  // Whole size and individual sub-variants are mutually exclusive: having both
  // selected would be two discounts on the same item, which reads as a mistake
  // even though the cheaper one would win.
  function toggleSize(p: Product, index: number) {
    setSel((s) => {
      const next = { ...s };
      const k = keyOf(p._id, index, -1);
      if (next[k]) {
        delete next[k];
      } else {
        for (const sv of subSelectables(p, index)) delete next[keyOf(p._id, index, sv.sub)];
        next[k] = fresh();
      }
      return next;
    });
  }
  function toggleSub(p: Product, index: number, sub: number) {
    setSel((s) => {
      const next = { ...s };
      const k = keyOf(p._id, index, sub);
      if (next[k]) {
        delete next[k];
      } else {
        delete next[keyOf(p._id, index, -1)];
        next[k] = fresh();
      }
      return next;
    });
  }
  function toggleWholeProduct(p: Product) {
    const sizes = sizeSelectables(p);
    const allOn = sizes.every((v) => sel[keyOf(p._id, v.index, -1)]);
    setSel((s) => {
      const next = { ...s };
      for (const v of sizes) {
        // Narrower picks go either way: the whole product supersedes them.
        for (const sv of subSelectables(p, v.index)) delete next[keyOf(p._id, v.index, sv.sub)];
        const k = keyOf(p._id, v.index, -1);
        if (allOn) delete next[k];
        else next[k] = next[k] || fresh();
      }
      return next;
    });
  }
  function updateSel(k: string, patch: Partial<SelEntry>) {
    setSel((s) => ({ ...s, [k]: { ...s[k], ...patch } }));
  }

  // Flatten the current selection into display/save items.
  const selectedItems: OfferItem[] = useMemo(() => {
    const out: OfferItem[] = [];
    for (const [k, entry] of Object.entries(sel)) {
      const [pid, idxStr, subStr] = k.split('#');
      const p = productById[pid];
      if (!p) continue;
      const sv = allSelectables(p).find(
        (v) => v.index === Number(idxStr) && v.sub === Number(subStr),
      );
      if (!sv) continue;
      out.push({
        productId: pid,
        productName: p.name,
        productImageUrl: p.imageUrl,
        variantIndex: sv.index,
        subIndex: sv.sub,
        subLabel: sv.subLabel,
        label: sv.label,
        originalPrice: sv.price,
        discountType: entry.discountType,
        discountValue: entry.discountValue,
        offerPrice: computeOfferPrice(sv.price, entry.discountType, entry.discountValue),
      });
    }
    return out;
  }, [sel, productById]);

  const valid = !!title.trim() && selectedItems.some((i) => i.discountValue > 0);

  // ---- Phone preview ----
  // The products this offer touches, in the order they were picked.
  const previewProducts = useMemo(() => {
    const ids: string[] = [];
    for (const it of selectedItems) if (!ids.includes(it.productId)) ids.push(it.productId);
    return ids.map((id) => productById[id]).filter(Boolean) as Product[];
  }, [selectedItems, productById]);
  const [previewPid, setPreviewPid] = useState('');
  const previewProduct = previewProducts.find((p) => p._id === previewPid) || previewProducts[0] || null;

  // Sale price for one size + colour of the previewed product. A discount on
  // that exact flavour wins; otherwise a whole-size discount applies.
  const saleFor = (sizeIdx: number, color: string): number | undefined => {
    if (!previewProduct) return undefined;
    const v = (previewProduct.variants || [])[sizeIdx];
    const original = v ? (v.price || previewProduct.price || 0) : (previewProduct.price || 0);
    const subIdx = subsOf(v).findIndex((s) => s.toLowerCase() === (color || '').toLowerCase());
    const entry = (subIdx >= 0 && sel[keyOf(previewProduct._id, sizeIdx, subIdx)])
      || sel[keyOf(previewProduct._id, sizeIdx, -1)];
    if (!entry || !(entry.discountValue > 0)) return undefined;
    return computeOfferPrice(original, entry.discountType, entry.discountValue);
  };

  // Open the preview on the first discounted combination of that product.
  const previewStart = useMemo(() => {
    const first = selectedItems.find((i) => i.productId === previewProduct?._id);
    return { size: first?.variantIndex ?? 0, color: first?.subLabel || '' };
  }, [selectedItems, previewProduct?._id]);

  async function save() {
    if (!valid) {
      setError('Add a title and set a discount on at least one selected size.');
      return;
    }
    setSaving(true);
    setError('');
    const body: Partial<Offer> = { title: title.trim(), active, items: selectedItems };
    try {
      const res = editing && offer
        ? await api.updateOffer(offer._id, body)
        : await api.createOffer(body);
      setSaving(false);
      // Hand the catalog-push outcome back, so a discount that didn't reach
      // WhatsApp is reported instead of looking saved.
      onSaved(res.sync);
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  const selectedGrouped = groupByProduct(selectedItems);

  return (
    <div className="page composer-page">
      <header className="page-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <span className="material-icons">arrow_back</span>
        </button>
        <h2>{editing ? 'Edit offer' : 'New offer'}</h2>
        <button className="k-btn" onClick={save} disabled={!valid || saving}>
          {saving ? 'Saving…' : editing ? 'Save offer' : 'Create offer'}
        </button>
      </header>

      <div className="composer-split">
        <div className="composer-fields">
          {error && <p className="err">{error}</p>}

          <div className="k-field">
            <label className="k-label">Offer title</label>
            <input className="k-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Festive Sale" />
          </div>

          <div className="k-field">
            <label className="sched-toggle">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Active (customers see this offer)
            </label>
          </div>

          <div className="k-field">
            <label className="k-label">Products & sizes</label>
            <p className="page-note sm">
              Tick a product to apply to all its sizes, tap a size to target it
              (every flavour included), or tap a single flavour to discount only
              that one.
            </p>
            <input
              className="k-input"
              placeholder="Search products…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            <div className="offer-pick-list">
              {filtered.length === 0 && <div className="page-note sm">No products found.</div>}
              {filtered.map((p) => {
                const sizes = sizeSelectables(p);
                const allOn = sizes.every((v) => sel[keyOf(p._id, v.index, -1)]);
                const hasVariants = !!(p.variants && p.variants.length);
                // The business's own word for the second axis, e.g. "flavour".
                const subWord = (p.subVariantLabel || '').trim();
                return (
                  <div className="offer-pick-row" key={p._id}>
                    <label className="offer-pick-head">
                      <input type="checkbox" checked={allOn} onChange={() => toggleWholeProduct(p)} />
                      <div className="offer-card-img sm">
                        {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span className="material-icons">image</span>}
                      </div>
                      <span className="offer-pick-name">{p.name}</span>
                      <span className="offer-pick-base">{money(p.price)}</span>
                    </label>
                    {hasVariants && (
                      <div className="offer-pick-sizes">
                        {allOn ? (
                          <span className="offer-allsizes">✓ All sizes included</span>
                        ) : (
                          sizes.map((v) => {
                            const subs = subSelectables(p, v.index);
                            const sizeOn = !!sel[keyOf(p._id, v.index, -1)];
                            return (
                              <div className="offer-size-line" key={v.index}>
                                <button
                                  type="button"
                                  className={`offer-chip${sizeOn ? ' on' : ''}`}
                                  onClick={() => toggleSize(p, v.index)}
                                  title={subs.length ? `Every ${subWord || 'option'} of this size` : undefined}
                                >
                                  {v.imageUrl && <img src={v.imageUrl} alt="" />}
                                  {v.label} · {money(v.price)} {sizeOn ? '✓' : ''}
                                </button>

                                {/* Target one sub-variant instead of the size:
                                    a discount on spicy only, not on cool. */}
                                {subs.length > 0 && (
                                  <span className="offer-sub-chips">
                                    {sizeOn && (
                                      <span className="offer-sub-note">
                                        all {subWord ? `${subWord}s` : 'options'}
                                      </span>
                                    )}
                                    {!sizeOn &&
                                      subs.map((sv) => {
                                        const on = !!sel[keyOf(p._id, v.index, sv.sub)];
                                        return (
                                          <button
                                            type="button"
                                            key={sv.sub}
                                            className={`offer-chip sub${on ? ' on' : ''}`}
                                            onClick={() => toggleSub(p, v.index, sv.sub)}
                                            title={`Only ${sv.subLabel}`}
                                          >
                                            {sv.subLabel} {on ? '✓' : ''}
                                          </button>
                                        );
                                      })}
                                  </span>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {selectedItems.length > 0 && (
            <div className="k-field">
              <label className="k-label">Set discount per size</label>
              {selectedGrouped.map((g, gi) => (
                <div className="offer-disc-group" key={gi}>
                  <div className="offer-disc-prodname">{g.name}</div>
                  {g.items.map((it) => {
                    const k = keyOf(it.productId, it.variantIndex, it.subIndex ?? -1);
                    return (
                      <div className="offer-row" key={k}>
                        <span className="offer-row-label">{targetLabel(it)}</span>
                        <div className="offer-row-type">
                          {(['percent', 'flat'] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              className={`seg${it.discountType === t ? ' on' : ''}`}
                              onClick={() => updateSel(k, { discountType: t })}
                            >
                              {t === 'percent' ? '%' : '₹'}
                            </button>
                          ))}
                        </div>
                        <input
                          className="k-input offer-row-val"
                          type="number"
                          min={0}
                          value={it.discountValue || ''}
                          onChange={(e) => updateSel(k, { discountValue: Number(e.target.value) || 0 })}
                          placeholder="0"
                        />
                        <div className="offer-row-price">
                          <span className="ovr-orig">{money(it.originalPrice)}</span>
                          <span className="ovr-offer">{money(it.offerPrice)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live preview — the discounted product as WhatsApp shows it */}
        <div className="composer-preview">
          <div className="offer-preview-wrap">
          <div className="offer-preview-col">
            {previewProduct ? (
              <CatalogPhonePreview
                key={previewProduct._id}
                name={previewProduct.name}
                description={previewProduct.description}
                colorLabel={previewProduct.subVariantLabel}
                variants={phoneVariantsFromProduct(previewProduct)}
                fallbackPhotos={[previewProduct.imageUrl, ...(previewProduct.gallery || [])].filter(Boolean) as string[]}
                deliveryNote={deliveryNoteOf(previewProduct)}
                saleFor={saleFor}
                initialSize={previewStart.size}
                initialColor={previewStart.color}
              />
            ) : (
              <div className="offer-preview-empty">
                <span className="material-icons">local_offer</span>
                Tick a product, size or flavour to see how the offer looks in WhatsApp.
              </div>
            )}
          </div>

          {/* More than one product in the offer → a vertical rail of image
              boxes beside the phone to switch which one is shown. */}
          {previewProducts.length > 1 && (
            <div className="offer-preview-rail">
              {previewProducts.map((p) => (
                <button
                  type="button"
                  key={p._id}
                  className={`offer-rail-item${previewProduct?._id === p._id ? ' on' : ''}`}
                  onClick={() => setPreviewPid(p._id)}
                  title={p.name}
                >
                  <span className="offer-rail-img">
                    {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span className="material-icons">inventory_2</span>}
                  </span>
                  <span className="offer-rail-name">{p.name}</span>
                </button>
              ))}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
