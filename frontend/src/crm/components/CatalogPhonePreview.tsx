// The WhatsApp catalog "Details" screen, in the same white phone as the
// template preview (TemplatePhonePreview).
//
// Shared by the product editor, the product details page and the offer editor
// so a product reads identically everywhere. It behaves like WhatsApp:
//   • the Colour row lists every sub-variant across all sizes;
//   • tapping a colour the current size doesn't come in jumps to a size that
//     does, and tapping a size keeps the colour when that size has it;
//   • options missing from the current selection are dimmed but tappable;
//   • a discounted combination shows the sale price with the original struck
//     through, the way Meta renders a catalog item's sale_price.
import { useEffect, useState } from 'react';
import type { Product, ProductVariant } from '../types';
import { PhotoCarousel } from './PhotoCarousel';
import { PhoneStatusBar } from './TemplatePhonePreview';

/** One size as the phone shows it. */
export interface PhoneVariant {
  label: string;
  price: number;
  photos: string[];
  /** Sub-variants (colour / flavour …) this size comes in. */
  colors: string[];
}

interface Props {
  name: string;
  description?: string;
  /** The business's word for the sub-variant axis, e.g. "Spice level". */
  colorLabel?: string;
  variants: PhoneVariant[];
  /** Shown when the selected size has no photos of its own. */
  fallbackPhotos?: string[];
  /** Sale price for a size + colour, when an offer covers that combination. */
  saleFor?: (sizeIdx: number, color: string) => number | undefined;
  deliveryNote?: string;
  /** What to show first (e.g. the first discounted combination). */
  initialSize?: number;
  initialColor?: string;
  /**
   * Controlled mode: the page owns the selection (so another part of the page,
   * like a variant list, can drive the phone and follow taps made on it).
   */
  selected?: { size: number; color: string };
  onSelect?: (size: number, color: string) => void;
}

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const subsOf = (v?: ProductVariant): string[] =>
  ((v?.subVariants?.length ? v.subVariants : [v?.subVariant]) || [])
    .map((s) => String(s || '').trim())
    .filter(Boolean);

/** A saved product → the phone's variants (sizes with their photos and colours). */
export function phoneVariantsFromProduct(p: Product): PhoneVariant[] {
  const productPhotos = [p.imageUrl, ...(p.gallery || [])].filter(Boolean) as string[];
  if (p.variants && p.variants.length) {
    return p.variants.map((v, i) => {
      const own = [...new Set([...(v.images || []), v.imageUrl].filter(Boolean) as string[])];
      return {
        label: v.label || `${v.quantity || ''} ${v.unit || ''}`.trim() || `Size ${i + 1}`,
        price: v.price || p.price || 0,
        photos: own.length ? own : productPhotos,
        colors: subsOf(v),
      };
    });
  }
  return [{ label: p.unit || '', price: p.price || 0, photos: productPhotos, colors: [] }];
}

/** "Free delivery" / "Delivery ₹40" for a saved product. */
export function deliveryNoteOf(p: Product): string {
  return !p.freeDelivery && Number(p.deliveryCharge) > 0
    ? `Delivery ${money(Number(p.deliveryCharge))}`
    : 'Free delivery';
}

export function CatalogPhonePreview({
  name,
  description,
  colorLabel,
  variants,
  fallbackPhotos = [],
  saleFor,
  deliveryNote,
  initialSize = 0,
  initialColor = '',
  selected,
  onSelect,
}: Props) {
  const [ownSize, setOwnSize] = useState(initialSize);
  const [ownColor, setOwnColor] = useState(initialColor);

  // A new starting point (another product, a newly discounted size) re-seeds it.
  useEffect(() => {
    setOwnSize(initialSize);
    setOwnColor(initialColor);
  }, [initialSize, initialColor]);

  const controlled = !!selected && !!onSelect;
  const sizeIdx = controlled ? selected.size : ownSize;
  const colorSel = controlled ? selected.color : ownColor;
  const select = (size: number, color: string) => {
    if (controlled) onSelect(size, color);
    else {
      setOwnSize(size);
      setOwnColor(color);
    }
  };

  const has = (v: PhoneVariant | undefined, c: string) => !!c && (v?.colors || []).some((s) => same(s, c));

  const sIdx = variants.length ? Math.min(Math.max(sizeIdx, 0), variants.length - 1) : 0;
  const selVar = variants[sIdx];
  const activeColor = colorSel && has(selVar, colorSel) ? colorSel : (selVar?.colors[0] || '');

  // Every colour across every size, de-duplicated case-insensitively.
  const allColors: string[] = [];
  for (const v of variants) {
    for (const c of v.colors) if (!allColors.some((x) => same(x, c))) allColors.push(c);
  }

  function pickColor(c: string) {
    let size = sIdx;
    if (!has(selVar, c)) {
      const idx = variants.findIndex((v) => has(v, c));
      if (idx >= 0) size = idx;
    }
    select(size, c);
  }
  function pickSize(i: number) {
    select(i, has(variants[i], colorSel) ? colorSel : (variants[i]?.colors[0] || ''));
  }

  const photos = selVar?.photos.length ? selVar.photos : fallbackPhotos;
  const price = selVar?.price || 0;
  const sale = saleFor?.(sIdx, activeColor);
  const onSale = sale !== undefined && sale < price;
  const pctOff = onSale && price > 0 ? Math.round(((price - (sale as number)) / price) * 100) : 0;
  const title = [name || 'Product name', selVar?.label || '', activeColor].filter(Boolean).join(' - ');
  const priced = variants.filter((v) => v.price > 0 || v.label);

  return (
    <div className="pd-phone">
      {/* Same phone as the template preview: white frame, iOS status bar. */}
      <PhoneStatusBar />
      <div className="pd-phone-head">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <strong>Details</strong>
        <span className="pd-phone-head-ic">
          <span className="material-icons">shopping_cart</span>
          <span className="material-icons">more_vert</span>
        </span>
      </div>

      <div className="pd-phone-scroll">
        <div className="pd-phone-hero">
          {photos.length ? (
            <PhotoCarousel key={sIdx} photos={photos} />
          ) : (
            <span className="material-icons">image</span>
          )}
        </div>

        <div className="pd-phone-info">
          <h3 className="pd-phone-title">{title}</h3>
          <div className="pd-phone-price">
            {onSale ? (
              <>
                <span className="pd-phone-sale">{money(sale as number)}</span>
                <span className="pd-phone-orig">{money(price)}</span>
                {pctOff > 0 && <span className="pd-phone-off">{pctOff}% off</span>}
              </>
            ) : (
              money(price)
            )}
          </div>

          {allColors.length > 0 && (
            <>
              <div className="pd-phone-lbl">{colorLabel || 'Color'}</div>
              <div className="pd-phone-chips">
                {allColors.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`pd-phone-chip${activeColor && same(c, activeColor) ? ' on' : ''}${
                      has(selVar, c) ? '' : ' na'
                    }`}
                    title={has(selVar, c) ? '' : 'Not in this size — tap to switch size'}
                    onClick={() => pickColor(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </>
          )}

          {priced.length > 0 && variants.some((v) => v.label) && (
            <>
              <div className="pd-phone-lbl">Size</div>
              <div className="pd-phone-chips">
                {variants.map((v, i) => (
                  <button
                    type="button"
                    key={`${v.label}-${i}`}
                    className={`pd-phone-chip${i === sIdx ? ' on' : ''}${
                      activeColor && v.colors.length && !has(v, activeColor) ? ' na' : ''
                    }`}
                    onClick={() => pickSize(i)}
                  >
                    {v.label || `Size ${i + 1}`}
                  </button>
                ))}
              </div>
            </>
          )}

          {priced.length > 0 && (
            <div className="pd-phone-avail">
              Available sizes:
              {variants.map((v, i) => {
                // Quote each size in the colour the customer would get there.
                const c = has(v, activeColor) ? activeColor : (v.colors[0] || '');
                const s = saleFor?.(i, c);
                const discounted = s !== undefined && s < v.price;
                return (
                  <div key={`${v.label}-${i}`}>
                    {v.label || `Size ${i + 1}`} -{' '}
                    {discounted ? (
                      <>
                        <span className="pd-phone-avail-sale">{money(s as number)}</span>{' '}
                        <span className="pd-phone-orig sm">{money(v.price)}</span>
                      </>
                    ) : (
                      money(v.price)
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {deliveryNote && <div className="pd-phone-flavour">{deliveryNote}</div>}
          {allColors.length > 0 && (
            <div className="pd-phone-flavour">
              {(colorLabel || 'options').toLowerCase()}: {allColors.join(', ')}
            </div>
          )}
          {description && <div className="pd-phone-desc">{description}</div>}

          <div className="pd-phone-msgbtn">Message business</div>
        </div>
      </div>

      <div className="pd-phone-cta">Add to order request</div>
    </div>
  );
}
