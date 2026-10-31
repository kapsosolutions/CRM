// Full-page product add/edit form (left fields, right live preview).
// Variant-centric: each size variant carries its own image, unit, price and
// delivery charge. On save the product is created/updated and synced to Meta.
import { useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type {
  Category,
  Product,
  ProductVariant,
  SoldOutSchedule,
  SoldOutDay,
} from '../types';
import { Dropdown, type KOption } from './Dropdown';
import { CatalogPhonePreview, type PhoneVariant } from './CatalogPhonePreview';
import { verticalConfig, type VerticalConfig } from '../verticals';
import { useBackHandler } from '../useBackHandler';

/** Up to 10 photos per variant — Meta's limit for the detail carousel. */
const MAX_VARIANT_IMAGES = 10;

/**
 * One photo while editing: either already hosted (`url`) or freshly picked and
 * waiting to be uploaded on save (`file` + its local `preview` thumbnail).
 * Only hosted URLs are ever persisted.
 */
interface EditPhoto {
  url?: string;
  file?: File;
  preview?: string;
}

/** A variant while being edited, carrying its unsaved photo picks. */
type EditVariant = ProductVariant & { photos: EditPhoto[] };

/** What to show for a photo: the local thumbnail if new, else the hosted URL. */
const photoSrc = (p: EditPhoto) => p.preview || p.url || '';

/** Keeps only a real hosted image; discards blob:/data: leftovers. */
const hostedUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : '');

/** Existing variant → editable form, normalising the older single-value shapes. */
function toEditVariant(v: ProductVariant): EditVariant {
  const urls = (v.images?.length ? v.images : [v.imageUrl]).map(hostedUrl).filter(Boolean);
  const subs = (v.subVariants?.length ? v.subVariants : [v.subVariant])
    .map((s) => (s || '').trim())
    .filter(Boolean);
  return {
    ...v,
    photos: [...new Set(urls)].map((url) => ({ url })),
    subVariants: [...new Set(subs)],
  };
}

interface Props {
  api: CrmApi;
  /** Supplies the tenant's own word for "category" (Menu category, etc.). */
  vertical?: VerticalConfig;
  categories: Category[];
  product?: Product | null;
  onBack: () => void;
  onSaved: () => void;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const UNIT_OPTIONS: KOption[] = [
  { value: 'piece', label: 'Piece' },
  { value: 'pack', label: 'Pack' },
  { value: 'packet', label: 'Packet' },
  { value: 'box', label: 'Box' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'can', label: 'Can' },
  { value: 'jar', label: 'Jar' },
  { value: 'pouch', label: 'Pouch' },
  { value: 'g', label: 'Gram (g)' },
  { value: 'kg', label: 'Kilogram (kg)' },
  { value: 'ml', label: 'Millilitre (ml)' },
  { value: 'L', label: 'Litre (L)' },
  { value: 'dozen', label: 'Dozen' },
  { value: 'pair', label: 'Pair' },
  { value: 'set', label: 'Set' },
  { value: 'unit', label: 'Unit' },
];

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const variantLabel = (v: ProductVariant) =>
  v.label || `${v.quantity || ''} ${v.unit || ''}`.trim() || 'Variant';

// Multi-select category dropdown showing each category's 1:1 logo + name.
function CategorySelect({
  categories,
  plural,
  selected,
  onToggle,
}: {
  categories: Category[];
  /** The tenant's word for these, e.g. "Menu categories". */
  plural: string;
  selected: string[];
  onToggle: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const lower = plural.toLowerCase();
  const label =
    selected.length === 0
      ? `Select ${lower}`
      : selected.length <= 2
        ? selected.join(', ')
        : `${selected.length} ${lower}`;
  return (
    <div className="dd">
      <button type="button" className={`dd-trigger${open ? ' open' : ''}`} onClick={() => setOpen((v) => !v)}>
        <span className={`dd-value${selected.length ? '' : ' placeholder'}`}>{label}</span>
        <span className="material-icons">expand_more</span>
      </button>
      {open && (
        <>
          <div className="dd-backdrop" onClick={() => setOpen(false)} />
          <ul className="dd-panel cat-dd-panel" role="listbox">
            {categories.length === 0 && <li className="dd-option">No {lower} yet</li>}
            {categories.map((c) => (
              <li
                key={c._id}
                className={`dd-option cat-dd-opt${selected.includes(c.name) ? ' active' : ''}`}
                onClick={() => onToggle(c.name)}
              >
                {c.imageUrl ? (
                  <img className="cat-dd-logo" src={c.imageUrl} alt="" />
                ) : (
                  <span className="cat-dd-logo ph material-icons">category</span>
                )}
                <span className="cat-dd-name">{c.name}</span>
                {selected.includes(c.name) && <span className="material-icons cat-dd-check">check</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function ProductEditorPage({ api, vertical, categories, product, onBack, onSaved }: Props) {
  const v = vertical || verticalConfig('other');
  const editing = !!product;
  // Browser Back / swipe-back closes the editor, like the arrow.
  useBackHandler(true, onBack);
  const [name, setName] = useState(product?.name || '');
  const [description, setDescription] = useState(product?.description || '');
  const [selected, setSelected] = useState<string[]>(product?.categories || []);
  const [variants, setVariants] = useState<EditVariant[]>(
    product?.variants && product.variants.length
      ? product.variants.map(toEditVariant)
      : [
          {
            label: '', quantity: undefined, unit: 'g', price: 0, deliveryCharge: 0,
            photos: hostedUrl(product?.imageUrl) ? [{ url: hostedUrl(product?.imageUrl) }] : [],
          },
        ],
  );
  // What the business calls the second axis, e.g. "Spice level". Used in our UI
  // and written into the catalog description — WhatsApp labels its own picker.
  const [subLabel, setSubLabel] = useState(product?.subVariantLabel || '');
  // Half-typed sub-variant per variant index, committed on Enter / comma / blur.
  const [subDraft, setSubDraft] = useState<Record<number, string>>({});
  const [schedule, setSchedule] = useState<SoldOutSchedule>(
    product?.soldOutSchedule || { enabled: false, type: 'daily', dailyStartTime: '09:00', dailyEndTime: '21:00', days: [] },
  );
  const [freeDelivery, setFreeDelivery] = useState<boolean>(
    product?.freeDelivery ?? !product?.deliveryCharge,
  );
  const [deliveryCharge, setDeliveryCharge] = useState(String(product?.deliveryCharge ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const valid = !!name.trim() && selected.length > 0 && variants.some((v) => v.price > 0);

  function toggleCat(cat: string) {
    setSelected((s) => (s.includes(cat) ? s.filter((c) => c !== cat) : [...s, cat]));
  }
  function addVariant() {
    setVariants((v) => [...v, { label: '', unit: 'g', price: 0, deliveryCharge: 0, photos: [] }]);
  }
  function updateVariant(i: number, patch: Partial<EditVariant>) {
    setVariants((v) => v.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function removeVariant(i: number) {
    setVariants((v) => v.filter((_, idx) => idx !== i));
  }
  // Keep the Files themselves — they're what gets uploaded on save. The object
  // URLs are only local thumbnails: storing one as imageUrl (as this used to)
  // meant the picture vanished on reload and Meta had nothing to fetch.
  function onVariantImages(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    setVariants((vs) =>
      vs.map((x, idx) => {
        if (idx !== i) return x;
        const room = MAX_VARIANT_IMAGES - x.photos.length;
        if (room <= 0) return x;
        const added = picked.slice(0, room).map((file) => ({ file, preview: URL.createObjectURL(file) }));
        return { ...x, photos: [...x.photos, ...added] };
      }),
    );
  }

  function removeVariantImage(i: number, n: number) {
    setVariants((vs) =>
      vs.map((x, idx) => {
        if (idx !== i) return x;
        const gone = x.photos[n];
        if (gone?.preview) URL.revokeObjectURL(gone.preview);
        return { ...x, photos: x.photos.filter((_, k) => k !== n) };
      }),
    );
  }

  function addSubVariant(i: number, raw: string) {
    const value = raw.trim();
    setSubDraft((d) => ({ ...d, [i]: '' }));
    if (!value) return;
    setVariants((vs) =>
      vs.map((x, idx) => {
        if (idx !== i) return x;
        const have = x.subVariants || [];
        // Meta groups picker options by exact string, so "Hot" and "hot" would
        // otherwise become two separate options.
        if (have.some((s) => s.toLowerCase() === value.toLowerCase())) return x;
        return { ...x, subVariants: [...have, value] };
      }),
    );
  }

  function removeSubVariant(i: number, value: string) {
    setVariants((vs) =>
      vs.map((x, idx) =>
        idx === i ? { ...x, subVariants: (x.subVariants || []).filter((s) => s !== value) } : x,
      ),
    );
  }

  // Values already used on the other variants, so typing "sp" here offers the
  // "Spicy" entered earlier rather than a near-miss spelling that Meta would
  // treat as a different option.
  function subVariantSuggestions(i: number, typed: string) {
    const q = typed.trim().toLowerCase();
    const mine = new Set((variants[i]?.subVariants || []).map((s) => s.toLowerCase()));
    const others = variants
      .filter((_, idx) => idx !== i)
      .flatMap((v) => v.subVariants || [])
      .map((s) => s.trim())
      .filter(Boolean);
    const unique = [...new Set(others)].filter((s) => !mine.has(s.toLowerCase()));
    if (!q) return unique.slice(0, 6);
    return unique.filter((s) => s.toLowerCase().includes(q)).slice(0, 6);
  }

  // Release any thumbnails we created when leaving the editor.
  useEffect(
    () => () => variants.forEach((v) => v.photos.forEach((p) => p.preview && URL.revokeObjectURL(p.preview))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  function toggleDay(day: string) {
    setSchedule((s) => {
      const days = s.days || [];
      const exists = days.find((d) => d.day === day);
      const next: SoldOutDay[] = exists
        ? days.map((d) => (d.day === day ? { ...d, enabled: !d.enabled } : d))
        : [...days, { day: day as SoldOutDay['day'], enabled: true, startTime: '09:00', endTime: '21:00' }];
      return { ...s, days: next };
    });
  }

  async function save() {
    if (!valid) {
      setError(
        `Name, at least one ${v.categoryLabel.toLowerCase()}, and a variant with a price are required.`,
      );
      return;
    }
    setSaving(true);
    setError('');
    // `kept` and `cleanVariants` stay index-aligned, because each new photo is
    // sent as `variantImage_<index>_<n>` against the list the server receives.
    const kept = variants.filter((v) => v.price > 0);
    const cleanVariants = kept.map((v) => {
      // Only already-hosted URLs are worth sending; freshly picked photos
      // travel as file parts and are appended server-side.
      const images = v.photos.map((p) => hostedUrl(p.url)).filter(Boolean);
      return {
        label: `${v.quantity ?? ''} ${v.unit ?? ''}`.trim(),
        quantity: v.quantity,
        unit: v.unit,
        price: v.price,
        deliveryCharge: 0,
        images,
        imageUrl: images[0] || '',
        subVariants: (v.subVariants || []).map((s) => s.trim()).filter(Boolean),
      };
    });
    const basePrice = cleanVariants[0]?.price ?? 0;
    const prodDelivery = freeDelivery ? 0 : Number(deliveryCharge) || 0;

    const fd = new FormData();
    fd.append('name', name.trim());
    fd.append('description', description);
    fd.append('categories', JSON.stringify(selected));
    fd.append('price', String(basePrice));
    fd.append('unit', cleanVariants[0]?.unit || 'unit');
    fd.append('variants', JSON.stringify(cleanVariants));
    fd.append('imageUrl', cleanVariants.find((v) => v.imageUrl)?.imageUrl || '');
    fd.append('freeDelivery', String(freeDelivery));
    fd.append('deliveryCharge', String(prodDelivery));
    fd.append('soldOutSchedule', JSON.stringify(schedule));
    fd.append('subVariantLabel', subLabel.trim());
    kept.forEach((v, i) => {
      // Zero-padded so the server can restore the order the user arranged.
      v.photos.forEach((p, n) => {
        if (p.file) fd.append(`variantImage_${i}_${String(n).padStart(2, '0')}`, p.file);
      });
    });

    try {
      const res = editing && product
        ? await api.updateProduct(product._id, fd)
        : await api.createProduct(fd);
      setSaving(false);
      // Saved locally but rejected by Meta — say so rather than letting the
      // product look published when it isn't.
      if (res.sync && !res.sync.synced) {
        setError(`Saved, but not published to Meta: ${res.sync.reason || 'unknown error'}`);
        return;
      }
      onSaved();
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  // Every photo across the variants, in order — what the preview cycles through.
  const previewPhotos = useMemo(
    () => variants.flatMap((v) => v.photos.map(photoSrc)).filter(Boolean),
    [variants],
  );

  // The variants as the shared WhatsApp phone mock reads them (size, price, that
  // size's own photos — so tapping a size swaps the carousel — and its colours).
  const phoneVariants: PhoneVariant[] = variants.map((v) => ({
    label: v.quantity || v.label ? variantLabel(v) : '',
    price: v.price || 0,
    photos: v.photos.map(photoSrc).filter(Boolean),
    colors: (v.subVariants || []).map((s) => s.trim()).filter(Boolean),
  }));

  return (
    <div className="page composer-page">
      <header className="page-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <span className="material-icons">arrow_back</span>
        </button>
        <h2>{editing ? 'Edit product' : 'New product'}</h2>
        <button className="k-btn" onClick={save} disabled={!valid || saving}>
          {saving ? 'Saving…' : editing ? 'Save & sync' : 'Add & sync to catalog'}
        </button>
      </header>

      <div className="composer-split">
        <div className="composer-fields">
          {error && <p className="err">{error}</p>}

          <div className="k-field">
            <label className="k-label">Name</label>
            <input className="k-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cold Pressed Groundnut Oil" />
          </div>

          <div className="k-field">
            <label className="k-label">Description</label>
            <textarea className="k-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="k-field">
            <label className="k-label">{v.categoryPlural} (select one or more)</label>
            {categories.length === 0 ? (
              <p className="page-note">
                No {v.categoryPlural.toLowerCase()} yet — add some in the {v.categoryPlural} tab.
              </p>
            ) : (
              <CategorySelect
                categories={categories}
                plural={v.categoryPlural}
                selected={selected}
                onToggle={toggleCat}
              />
            )}
          </div>

          <div className="k-field">
            <label className="k-label">Variants — each has its own image, unit, price & delivery</label>
            <div className="var-cards">
              {variants.map((v, i) => (
                <div className="var-card" key={i}>
                  {/* Up to 10 photos — the first is the main image, the rest
                      become the ‹ › carousel on the WhatsApp detail screen. */}
                  <div className="var-photos">
                    {v.photos.map((p, n) => (
                      <div className={`var-photo${n === 0 ? ' main' : ''}`} key={p.url || p.preview || n}>
                        <img src={photoSrc(p)} alt="" />
                        {n === 0 && <span className="var-photo-tag">Main</span>}
                        <button
                          type="button"
                          className="var-photo-del"
                          onClick={() => removeVariantImage(i, n)}
                          title="Remove photo"
                        >
                          <span className="material-icons">close</span>
                        </button>
                      </div>
                    ))}
                    {v.photos.length < MAX_VARIANT_IMAGES && (
                      <label className="var-photo add" title="Add photos">
                        <span className="material-icons">add_photo_alternate</span>
                        <small>{v.photos.length}/{MAX_VARIANT_IMAGES}</small>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          hidden
                          onChange={(e) => onVariantImages(i, e)}
                        />
                      </label>
                    )}
                  </div>
                  <div className="var-grid">
                    <div className="vf">
                      <label>Size</label>
                      <input
                        className="k-input"
                        type="number"
                        placeholder="500"
                        value={v.quantity ?? ''}
                        onChange={(e) => updateVariant(i, { quantity: Number(e.target.value) || undefined })}
                      />
                    </div>
                    <div className="vf">
                      <label>Unit</label>
                      <Dropdown options={UNIT_OPTIONS} value={v.unit || 'g'} onChange={(u) => updateVariant(i, { unit: u })} />
                    </div>
                    <div className="vf">
                      <label>Price ₹</label>
                      <input
                        className="k-input"
                        type="number"
                        placeholder="0"
                        value={v.price || ''}
                        onChange={(e) => updateVariant(i, { price: Number(e.target.value) })}
                      />
                    </div>
                    {/* Second option axis. Typing here offers whatever the other
                        variants already use, so the spelling stays consistent —
                        Meta groups the options by exact value. */}
                    <div className="vf wide">
                      <label>
                        {subLabel.trim() || 'Sub-variants'} (optional) — press Enter to add each
                      </label>
                      {(v.subVariants || []).length > 0 && (
                        <div className="sv-tags">
                          {(v.subVariants || []).map((s) => (
                            <span className="sv-tag" key={s}>
                              {s}
                              <button
                                type="button"
                                onClick={() => removeSubVariant(i, s)}
                                aria-label={`Remove ${s}`}
                              >
                                <span className="material-icons">close</span>
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <input
                        className="k-input"
                        placeholder="e.g. Spicy, then Hot…"
                        value={subDraft[i] ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          // A comma means they've finished one value.
                          if (val.includes(',')) {
                            val.split(',').forEach((part) => addSubVariant(i, part));
                          } else {
                            setSubDraft((d) => ({ ...d, [i]: val }));
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addSubVariant(i, subDraft[i] ?? '');
                          }
                        }}
                        onBlur={() => addSubVariant(i, subDraft[i] ?? '')}
                      />
                      {subVariantSuggestions(i, subDraft[i] ?? '').length > 0 && (
                        <div className="vf-suggest">
                          {subVariantSuggestions(i, subDraft[i] ?? '').map((s) => (
                            <button
                              type="button"
                              className="vf-chip"
                              key={s}
                              onClick={() => addSubVariant(i, s)}
                            >
                              + {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {variants.length > 1 && (
                    <button className="var-del" onClick={() => removeVariant(i)} title="Remove variant">
                      <span className="material-icons">close</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button className="k-btn ghost sm" onClick={addVariant}>
              <span className="material-icons">add</span> Add variant
            </button>

            {variants.some((v) => (v.subVariants || []).length > 0) && (
              <div className="vf sub-field-pick">
                <label>Name this option group</label>
                <input
                  className="k-input"
                  placeholder="e.g. Spice level, Colour, Flavour"
                  value={subLabel}
                  onChange={(e) => setSubLabel(e.target.value)}
                />
                <small className="page-note">
                  Used here and written into the product details. WhatsApp labels its own picker
                  and translates it, so it can&apos;t be renamed there — your option names
                  ({[...new Set(variants.flatMap((v) => v.subVariants || []))].join(', ') || '…'})
                  always show exactly as typed.
                </small>
              </div>
            )}
          </div>

          <div className="k-field">
            <label className="k-label">Delivery</label>
            <label className="sched-toggle">
              <input
                type="checkbox"
                checked={freeDelivery}
                onChange={(e) => setFreeDelivery(e.target.checked)}
              />
              Free delivery
            </label>
            {!freeDelivery && (
              <div className="deliv-charge">
                <label className="k-sublabel">Delivery charge ₹</label>
                <input
                  className="k-input"
                  type="number"
                  placeholder="0"
                  value={deliveryCharge}
                  onChange={(e) => setDeliveryCharge(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="k-field">
            <label className="k-label">Availability schedule</label>
            <label className="sched-toggle">
              <input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} />
              Only available during set hours (sold out otherwise)
            </label>
            {schedule.enabled && (
              <div className="sched-box">
                <div className="sched-type">
                  {(['daily', 'custom'] as const).map((t) => (
                    <button key={t} type="button" className={`seg${schedule.type === t ? ' on' : ''}`} onClick={() => setSchedule({ ...schedule, type: t })}>
                      {t === 'daily' ? 'Every day' : 'Custom days'}
                    </button>
                  ))}
                </div>
                {schedule.type === 'daily' ? (
                  <div className="sched-times">
                    <label>
                      From
                      <input type="time" value={schedule.dailyStartTime || '09:00'} onChange={(e) => setSchedule({ ...schedule, dailyStartTime: e.target.value })} />
                    </label>
                    <label>
                      To
                      <input type="time" value={schedule.dailyEndTime || '21:00'} onChange={(e) => setSchedule({ ...schedule, dailyEndTime: e.target.value })} />
                    </label>
                  </div>
                ) : (
                  <div className="sched-days">
                    {DAYS.map((d) => {
                      const on = schedule.days?.find((x) => x.day === d)?.enabled;
                      return (
                        <button key={d} type="button" className={`day${on ? ' on' : ''}`} onClick={() => toggleDay(d)}>
                          {d}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Live preview — interactive WhatsApp catalog mobile mock */}
        <div className="composer-preview">
          <CatalogPhonePreview
            name={name}
            description={description}
            colorLabel={subLabel}
            variants={phoneVariants}
            fallbackPhotos={previewPhotos}
            deliveryNote={
              !freeDelivery && Number(deliveryCharge) > 0
                ? `Delivery ${money(Number(deliveryCharge))}`
                : 'Free delivery'
            }
          />
        </div>
      </div>
    </div>
  );
}
