// Read-only details view of one catalog product: photos, pricing, variants,
// categories and availability, with quick edit / availability / delete actions.
import { useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type { Offer, Product } from '../types';
import { CatalogPhonePreview, deliveryNoteOf, phoneVariantsFromProduct } from './CatalogPhonePreview';
import { PhotoCarousel } from './PhotoCarousel';
import { useConfirm, useNotify } from './Dialogs';
import { useBackHandler } from '../useBackHandler';

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

interface Props {
  api: CrmApi;
  product: Product;
  /** Offers, so the phone mock can show sale prices like the Meta catalog. */
  offers?: Offer[];
  onBack: () => void;
  onEdit: () => void;
  onChanged: () => void;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function ProductDetailsPage({ api, product: p, offers = [], onBack, onEdit, onChanged }: Props) {
  const confirm = useConfirm();
  const notify = useNotify();
  useBackHandler(true, onBack);
  const [paused, setPaused] = useState(!!p.isPaused);
  const [busy, setBusy] = useState(false);
  const photos = [p.imageUrl, ...(p.gallery || [])].filter(Boolean) as string[];
  const variants = p.variants || [];
  // Sizes as the phone reads them (label, price, own photos, colours) — the
  // left-hand variant list uses the same list so both always agree.
  const phoneVariants = useMemo(() => phoneVariantsFromProduct(p), [p]);

  // One selection shared by the variant list and the phone: picking a size or
  // flavour on either side updates the other.
  const [sel, setSel] = useState<{ size: number; color: string }>(() => ({
    size: 0,
    color: phoneVariants[0]?.colors[0] || '',
  }));
  const pickSize = (i: number) => {
    const colors = phoneVariants[i]?.colors || [];
    const keep = colors.find((c) => same(c, sel.color));
    setSel({ size: i, color: keep || colors[0] || '' });
  };

  // Sale price from any active offer on this product, the way Meta shows a
  // catalog item's sale_price. A discount on the exact flavour beats a
  // whole-size discount; the cheapest wins if several offers overlap.
  const saleFor = (sizeIdx: number, color: string): number | undefined => {
    let best: number | undefined;
    for (const o of offers) {
      if (!o.active) continue;
      for (const it of o.items) {
        if (it.productId !== p._id || it.variantIndex !== sizeIdx) continue;
        const whole = (it.subIndex ?? -1) < 0;
        const exact = !!it.subLabel && !!color && it.subLabel.toLowerCase() === color.toLowerCase();
        if (!whole && !exact) continue;
        if (best === undefined || it.offerPrice < best) best = it.offerPrice;
      }
    }
    return best;
  };

  function toggle() {
    setBusy(true);
    api.setProductPaused(p._id, !paused)
      .then(() => { setPaused(!paused); onChanged(); })
      .finally(() => setBusy(false));
  }
  async function remove() {
    const ok = await confirm({
      title: 'Delete product?',
      message: `“${p.name}” will be removed from your WhatsApp catalog too.`,
      confirmLabel: 'Delete product',
    });
    if (!ok) return;
    try {
      await api.deleteProduct(p._id);
      notify('success', 'Product deleted', `“${p.name}” was removed from the catalog.`);
      onChanged();
      onBack();
    } catch (e) {
      notify('error', 'Delete failed', e instanceof Error ? e.message : 'Could not delete the product.');
    }
  }

  return (
    <div className="page od-page composer-page">
      <header className="page-head od-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back to catalog">
          <span className="material-icons">arrow_back</span>
        </button>
        <div className="od-head-ttl">
          <h2>{p.name}</h2>
          <span className="od-kind">Product</span>
        </div>
        <button className="k-btn ghost sm" onClick={onEdit}>
          <span className="material-icons">edit</span> Edit
        </button>
      </header>

      {/* Same two-pane layout as the product editor: everything about the
          product scrolls on the left; the phone fills the right side. */}
      <div className="composer-split">
        <div className="composer-fields pd-details-fields">
        <div className="od-strip">
          <div className="od-stat total">
            <span className="od-stat-lbl">Price</span>
            <span className="od-stat-val">{money(p.price || 0)}</span>
          </div>
          <div className="od-stat">
            <span className="od-stat-lbl">Status</span>
            <span className={`ord-badge ${paused ? 'st-cancelled' : 'st-delivered'}`}>
              {paused ? 'Sold out' : 'Available'}
            </span>
          </div>
          <div className="od-stat">
            <span className="od-stat-lbl">Unit</span>
            <span className="od-stat-val sm">{p.unit || '—'}</span>
          </div>
          <div className="od-stat">
            <span className="od-stat-lbl">Variants</span>
            <span className="od-stat-val sm">{variants.length || '—'}</span>
          </div>
        </div>

          <div className="od-main">
            <section className="od-card">
              <div className="od-card-head">
                <span className="material-icons">inventory_2</span>
                Details
              </div>
              <dl className="od-facts">
                {!!p.categories?.length && (
                  <>
                    <dt>Categories</dt>
                    <dd>{p.categories.join(', ')}</dd>
                  </>
                )}
                <dt>Price</dt>
                <dd>
                  {money(p.price || 0)}{p.unit ? ` / ${p.unit}` : ''}
                  {p.mrp && p.mrp > (p.price || 0) ? <span className="pd-mrp">{money(p.mrp)}</span> : null}
                </dd>
                {p.description && (
                  <>
                    <dt>Description</dt>
                    <dd>{p.description}</dd>
                  </>
                )}
              </dl>
            </section>

            {variants.length > 0 && (
              <section className="od-card">
                <div className="od-card-head">
                  <span className="material-icons">straighten</span>
                  Variants
                </div>
                <div className="pd-vars">
                  {phoneVariants.map((v, i) => {
                    const on = i === sel.size;
                    // Price in the flavour that's picked here (or this size's first).
                    const color = on ? sel.color : (v.colors[0] || '');
                    const sale = saleFor(i, color);
                    const discounted = sale !== undefined && sale < v.price;
                    return (
                      <div
                        className={`pd-var${on ? ' on' : ''}`}
                        key={i}
                        role="button"
                        tabIndex={0}
                        onClick={() => pickSize(i)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickSize(i); } }}
                        aria-pressed={on}
                      >
                        {/* 1:1 box; several photos advance every 3 s */}
                        <div className="pd-var-img">
                          {v.photos.length ? (
                            <PhotoCarousel photos={v.photos} intervalMs={3000} controls={false} />
                          ) : (
                            <span className="material-icons">image</span>
                          )}
                        </div>

                        <div className="pd-var-body">
                          <span className="pd-var-name">{v.label || `Size ${i + 1}`}</span>
                          {v.colors.length > 0 && (
                            <div className="pd-var-subs">
                              {v.colors.map((c) => (
                                <button
                                  type="button"
                                  key={c}
                                  className={`pd-var-sub${on && same(c, sel.color) ? ' on' : ''}`}
                                  onClick={(e) => { e.stopPropagation(); setSel({ size: i, color: c }); }}
                                >
                                  {c}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <span className="pd-var-price">
                          {discounted ? (
                            <>
                              <span className="pd-var-sale">{money(sale as number)}</span>
                              <span className="pd-var-orig">{money(v.price)}</span>
                            </>
                          ) : (
                            money(v.price)
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <div className="pd-actions">
              <button className="k-btn ghost sm" onClick={toggle} disabled={busy}>
                <span className="material-icons">{paused ? 'play_circle' : 'pause_circle'}</span>
                {paused ? 'Mark available' : 'Mark sold out'}
              </button>
              <button className="k-btn ghost sm pd-del" onClick={remove}>
                <span className="material-icons">delete</span> Delete
              </button>
            </div>
          </div>
        </div>

        {/* Same WhatsApp catalog phone as the editor, with live sale prices —
            full height, and fixed: only its screen scrolls. */}
        <div className="composer-preview">
          <CatalogPhonePreview
            name={p.name}
            description={p.description}
            colorLabel={p.subVariantLabel}
            variants={phoneVariantsFromProduct(p)}
            fallbackPhotos={photos}
            deliveryNote={deliveryNoteOf(p)}
            saleFor={saleFor}
            selected={sel}
            onSelect={(size, color) => setSel({ size, color })}
          />
        </div>
      </div>
    </div>
  );
}
