// Catalog view: product grid with a top-right + to add, plus edit / delete /
// availability toggle, and a "Sync to Meta" action. When no catalog is
// connected, displays an onboarding view with catalog.svg, feature benefits,
// and a connect modal flow ending in a celebratory connection success screen.
import { useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type { BusinessProfile, BusinessSettings, Category, MetaCatalogLogin, Offer, OfferItem, Product, ProductVariant } from '../types';
import { useMetaBusinessLogin } from './MetaBusinessLogin';
import { CatalogPicker } from './CatalogPicker';
import { ProductEditorPage } from './ProductEditorPage';
import { ProductDetailsPage } from './ProductDetailsPage';
import { PhotoCarousel } from './PhotoCarousel';
import { verticalConfig, type VerticalConfig } from '../verticals';
import { useConfirm, useFlash, useNotify } from './Dialogs';
import { BladeSpinner } from './BladeSpinner';
import { WhatsAppConnectRequired } from './WhatsAppConnectRequired';
import './CatalogPage.css';

interface Props {
  api: CrmApi;
  /** Supplies the tenant's own word for "category" in the product editor. */
  vertical?: VerticalConfig;
  business?: BusinessProfile;
  demo?: boolean;
  onBusinessUpdated?: (b: BusinessProfile) => void;
}

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

function CatalogCartSvg({ width = 18, height = 18, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      className={className}
      style={{ flexShrink: 0 }}
    >
      <path
        d="M0 0.75C0 0.335786 0.335786 0 0.75 0H1.30826C2.25873 0 2.82782 0.638993 3.15325 1.23299C3.37016 1.62894 3.52708 2.08818 3.64982 2.50395C3.68306 2.50134 3.71674 2.5 3.7508 2.5H16.2481C17.0783 2.5 17.6778 3.29442 17.4502 4.0928L15.6224 10.5019C15.2856 11.6832 14.2062 12.4978 12.9779 12.4978H7.02977C5.79128 12.4978 4.7056 11.6699 4.37783 10.4756L3.61734 7.70455L2.35874 3.45578L2.3567 3.44834C2.201 2.88051 2.05487 2.35005 1.83773 1.9537C1.62686 1.5688 1.45877 1.5 1.30826 1.5H0.75C0.335786 1.5 0 1.16421 0 0.75ZM5.07283 7.34027L5.82434 10.0786C5.97333 10.6215 6.46682 10.9978 7.02977 10.9978H12.9779C13.5362 10.9978 14.0268 10.6275 14.18 10.0906L15.9168 4H4.08549L5.05906 7.28682C5.06434 7.3046 5.06892 7.32243 5.07283 7.34027ZM8.5 15.5C8.5 16.6046 7.60457 17.5 6.5 17.5C5.39543 17.5 4.5 16.6046 4.5 15.5C4.5 14.3954 5.39543 13.5 6.5 13.5C7.60457 13.5 8.5 14.3954 8.5 15.5ZM7 15.5C7 15.2239 6.77614 15 6.5 15C6.22386 15 6 15.2239 6 15.5C6 15.7761 6.22386 16 6.5 16C6.77614 16 7 15.7761 7 15.5ZM15.5 15.5C15.5 16.6046 14.6046 17.5 13.5 17.5C12.3954 17.5 11.5 16.6046 11.5 15.5C11.5 14.3954 12.3954 13.5 13.5 13.5C14.6046 13.5 15.5 14.3954 15.5 15.5ZM14 15.5C14 15.2239 13.7761 15 13.5 15C13.2239 15 13 15.2239 13 15.5C13 15.7761 13.2239 16 13.5 16C13.7761 16 14 15.7761 14 15.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function MetaInfinityLogo({ width = 46, height = 31 }: { width?: number; height?: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="meta-grad-cat-official" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0064E0" />
          <stop offset="50%" stopColor="#0072EC" />
          <stop offset="100%" stopColor="#0081FB" />
        </linearGradient>
      </defs>
      <path
        fill="url(#meta-grad-cat-official)"
        d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"
      />
    </svg>
  );
}

function BenefitCheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="cs-benefit-icon" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" stroke="#16a34a" strokeWidth="2" fill="none" />
      <path d="M8.5 12.2L10.8 14.5L15.5 9.8" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LinkStepIconSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

// A product's selectable sizes. Products with no variants are treated as a
// single item at index 0 using the base price.
interface Selectable {
  index: number;
  label: string;
  price: number;
  unit?: string;
  imageUrl?: string;
  /** All photos for this size — the card cycles through them. */
  photos: string[];
}

/** A variant's photos, newest gallery shape first, falling back to the product. */
const photosOf = (v: ProductVariant, p: Product): string[] => {
  const list = (v.images?.length ? v.images : [v.imageUrl, p.imageUrl]).filter(Boolean) as string[];
  return [...new Set(list)];
};

function selectables(p: Product): Selectable[] {
  if (p.variants && p.variants.length) {
    return p.variants.map((v: ProductVariant, i) => ({
      index: i,
      label: [
        v.label || `${v.quantity || ''} ${v.unit || ''}`.trim() || `Size ${i + 1}`,
        (v.subVariants?.length ? v.subVariants : [v.subVariant]).filter(Boolean).join(' / '),
      ]
        .filter(Boolean)
        .join(' · '),
      price: v.price || p.price || 0,
      unit: v.unit,
      imageUrl: v.imageUrl || p.imageUrl,
      photos: photosOf(v, p),
    }));
  }
  return [
    {
      index: 0,
      label: p.unit || 'Default',
      price: p.price || 0,
      unit: p.unit,
      imageUrl: p.imageUrl,
      photos: [p.imageUrl, ...(p.gallery || [])].filter(Boolean) as string[],
    },
  ];
}

function scheduleLabel(p: Product): string | null {
  const s = p.soldOutSchedule;
  if (!s?.enabled) return null;
  if (s.type === 'daily') return `Available ${s.dailyStartTime}–${s.dailyEndTime}`;
  const days = (s.days || []).filter((d) => d.enabled).map((d) => d.day);
  return days.length ? `Available ${days.join(', ')}` : 'Scheduled';
}

export function CatalogPage(props: Props) {
  const { api, business, demo, onBusinessUpdated } = props;
  if (!demo && business && !business.whatsappConnected) {
    return <WhatsAppConnectRequired page="catalog" api={api} business={business} onConnected={onBusinessUpdated} />;
  }
  return <CatalogPageInner {...props} />;
}

const CATALOG_NOT_CONFIGURED_TEXT =
  'Connecting a catalog through Meta isn’t set up on this server yet. The platform owner needs a Facebook Login for ' +
  'Business configuration with catalogs in the Meta app (META_BUSINESS_LOGIN_CONFIG_ID, or META_CATALOG_LOGIN_CONFIG_ID).';

type ApiErr = Error & { data?: { code?: string } | null };
const errCode = (e: unknown) => (e as ApiErr)?.data?.code || '';
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

function CatalogPageInner({ api, vertical, business, demo, onBusinessUpdated }: Props) {
  const v = vertical || verticalConfig('other');
  const confirm = useConfirm();
  const notify = useNotify();
  const flash = useFlash();

  // Get started → Meta's Login for Business popup → "Choose your catalog".
  const fbLogin = useMetaBusinessLogin(api, 'catalogLoginConfigId', 'connecting a catalog', CATALOG_NOT_CONFIGURED_TEXT);
  // '' idle · 'popup' Meta's window is open · 'reading' the server lists the catalogs
  const [phase, setPhase] = useState<'' | 'popup' | 'reading'>('');
  const [picker, setPicker] = useState<MetaCatalogLogin | null>(null);
  const [pickerError, setPickerError] = useState<{ code: string; text: string } | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null | 'new'>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Connection & Onboarding State
  const [catalogId, setCatalogId] = useState<string>(business?.catalogId || '');
  const [catalogName, setCatalogName] = useState<string>('');
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [modalMode, setModalMode] = useState<'info' | 'form'>('info');
  const [showSuccessScreen, setShowSuccessScreen] = useState(false);
  const [catalogInput, setCatalogInput] = useState('');
  const [catalogInputError, setCatalogInputError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Which size chip is active per product card (keyed by product id). Default 0.
  const [picked, setPicked] = useState<Record<string, number>>({});

  function load() {
    setLoading(true);
    Promise.all([
      api.getProducts(),
      api.getCategories(),
      api.getOffers(),
      api.getSettings().catch(() => ({ success: false, data: {} as BusinessSettings })),
    ])
      .then(([p, c, o, s]) => {
        setProducts(p.data || []);
        setCategories(c.data || []);
        setOffers(o.data || []);
        const settingsData = s.data || {};
        const activeCatId = settingsData.catalogId || business?.catalogId || '';
        const activeCatName = settingsData.catalogName || '';
        setCatalogId(activeCatId);
        setCatalogName(activeCatName);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync catalog ID if business prop updates from parent
  useEffect(() => {
    if (business?.catalogId && !catalogId) {
      setCatalogId(business.catalogId);
    }
  }, [business?.catalogId, catalogId]);

  // Lookup of active offer items keyed by `${productId}#${variantIndex}`.
  const offerMap = useMemo(() => {
    const m: Record<string, OfferItem> = {};
    for (const o of offers) {
      if (!o.active) continue;
      for (const it of o.items) m[`${it.productId}#${it.variantIndex}`] = it;
    }
    return m;
  }, [offers]);

  function toggleAvailability(p: Product) {
    api.setProductPaused(p._id, !p.isPaused).then(() => {
      setProducts((list) => list.map((x) => (x._id === p._id ? { ...x, isPaused: !p.isPaused } : x)));
    });
  }

  async function remove(p: Product) {
    const ok = await confirm({
      title: 'Delete product?',
      message: `“${p.name}” will be removed from your WhatsApp catalog too.`,
      confirmLabel: 'Delete product',
    });
    if (!ok) return;
    try {
      await api.deleteProduct(p._id);
      setProducts((list) => list.filter((x) => x._id !== p._id));
      notify('success', 'Product deleted', `“${p.name}” was removed from the catalog.`);
    } catch (e) {
      notify('error', 'Delete failed', e instanceof Error ? e.message : 'Could not delete the product.');
    }
  }

  function sync() {
    setSyncing(true);
    api
      .syncCatalog()
      .then((r) => {
        flash(`Catalog synced. ${r.pushed} product${r.pushed === 1 ? '' : 's'} sent to WhatsApp.`);
        load();
      })
      .catch((e) => flash(`Sync failed. ${e instanceof Error ? e.message : 'Could not reach WhatsApp.'}`, 'error'))
      .finally(() => setSyncing(false));
  }

  // Handle Connecting Catalog Form Submission
  async function handleConnectCatalog(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const cleanId = catalogInput.trim().replace(/[^\d]/g, '');
    if (!cleanId) {
      setCatalogInputError('Please enter a valid numeric Meta Catalog ID.');
      return;
    }
    setConnecting(true);
    setCatalogInputError('');
    try {
      const res = await api.saveSettings({ catalogId: cleanId });
      const saved = res.data || {};
      setCatalogId(cleanId);
      setCatalogName(saved.catalogName || 'Meta Product Catalog');
      if (business && onBusinessUpdated) {
        onBusinessUpdated({ ...business, catalogId: cleanId });
      }
      setShowConnectModal(false);
      setModalMode('info');
      setShowSuccessScreen(true);
      notify('success', 'Catalog connected', `Meta Catalog #${cleanId} linked successfully.`);
    } catch (err) {
      setCatalogInputError(
        err instanceof Error ? err.message : 'Failed to connect catalog. Please verify your Meta Catalog ID.',
      );
    } finally {
      setConnecting(false);
    }
  }

  /**
   * Get started: opens Meta's popup. Must run synchronously from the click
   * (fbLogin.login calls FB.login before returning), or the browser blocks it.
   */
  function startLogin() {
    if (phase) return;
    if (demo) {
      notify('error', 'Not in the demo', 'Sign up to connect your own Meta catalog.');
      return;
    }
    setPicker(null);
    setPickerError(null);
    setPhase('popup');
    void fbLogin.login().then(async (code) => {
      if (!code) {
        setPhase('');
        return;
      }
      setPhase('reading');
      try {
        const r = await api.startMetaCatalogLogin(code);
        setShowConnectModal(false);
        setModalMode('info');
        setPicker(r);
      } catch (e) {
        notify('error', errCode(e) === 'RATE_LIMITED' ? 'Meta is busy, try again shortly' : 'Couldn’t read your catalogs', errText(e));
      } finally {
        setPhase('');
      }
    });
  }

  async function connectPicked(id: string) {
    if (!picker) return;
    setPickerBusy(true);
    setPickerError(null);
    try {
      const r = await api.connectMetaCatalog({ sessionId: picker.sessionId, catalogId: id });
      setCatalogId(r.catalogId);
      setCatalogName(r.catalogName || 'Meta Product Catalog');
      if (business && onBusinessUpdated) onBusinessUpdated({ ...business, catalogId: r.catalogId });
      setPicker(null);
      setShowSuccessScreen(true);
      notify('success', 'Catalog connected', `${r.catalogName} is connected to your WhatsApp Business Account.`);
    } catch (e) {
      const code = errCode(e);
      setPickerError({
        code,
        text: code === 'SESSION_EXPIRED' ? 'Your Meta login has expired. Please connect again.' : errText(e),
      });
    } finally {
      setPickerBusy(false);
    }
  }

  /**
   * Back from WhatsApp Manager ("I've connected it"): re-read the WhatsApp
   * account and connect the catalog now on it, the same as picking it here.
   */
  async function checkLinkedInManager() {
    if (!picker) return;
    setPickerBusy(true);
    let linked = '';
    try {
      const r = await api.refreshMetaCatalog(picker.sessionId);
      setPicker(r);
      linked = r.catalogs.find((c) => c.onWhatsApp)?.id || '';
      if (!linked) {
        setPickerError({ code: 'NOT_LINKED_YET', text: '' });
        return;
      }
    } catch (e) {
      const code = errCode(e);
      setPickerError({
        code,
        text: code === 'SESSION_EXPIRED' ? 'Your Meta login has expired. Please connect again.' : errText(e),
      });
      return;
    } finally {
      setPickerBusy(false);
    }
    await connectPicked(linked);
  }

  /** From the picker's empty state: type the id, as before. */
  function openManualEntry() {
    setPicker(null);
    setPickerError(null);
    setCatalogInput(catalogId || '');
    setCatalogInputError('');
    setModalMode('form');
    setShowConnectModal(true);
  }

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  // Meta's SDK is still loading: FB.login can't run from a click yet.
  const sdkLoading = !demo && isHttps && !fbLogin.notConfigured && !fbLogin.problem && !fbLogin.ready;

  // Handle Disconnecting Catalog
  async function handleDisconnect() {
    const ok = await confirm({
      title: 'Disconnect Meta Catalog?',
      message:
        'Your products in the CRM will remain safe, but WhatsApp customers will no longer be able to browse or order from your in-chat catalog until reconnected.',
      confirmLabel: 'Disconnect Catalog',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.saveSettings({ catalogId: '' });
      setCatalogId('');
      setCatalogName('');
      if (business && onBusinessUpdated) {
        onBusinessUpdated({ ...business, catalogId: '' });
      }
      notify('success', 'Catalog disconnected', 'Your Meta product catalog has been unlinked.');
    } catch (err) {
      notify('error', 'Could not disconnect', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  // Copy Catalog ID
  function handleCopyId() {
    if (!catalogId) return;
    navigator.clipboard.writeText(catalogId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (editing) {
    return (
      <ProductEditorPage
        api={api}
        vertical={v}
        categories={categories}
        product={editing === 'new' ? null : editing}
        onBack={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          flash('Product saved. It was synced to your WhatsApp catalog.');
          load();
        }}
      />
    );
  }

  if (viewing) {
    return (
      <ProductDetailsPage
        api={api}
        product={viewing}
        offers={offers}
        onBack={() => setViewing(null)}
        onEdit={() => {
          setEditing(viewing);
          setViewing(null);
        }}
        onChanged={load}
      />
    );
  }

  const handleCloseConnectModal = () => {
    setShowConnectModal(false);
    setModalMode('info');
  };

  const renderConnectCatalogModal = () => {
    if (picker) {
      return (
        <CatalogPicker
          key={picker.sessionId}
          login={picker}
          busy={pickerBusy}
          error={pickerError}
          onClearError={() => setPickerError(null)}
          onCancel={() => {
            setPicker(null);
            setPickerError(null);
          }}
          onRetry={startLogin}
          onConnect={connectPicked}
          onManual={openManualEntry}
          onLinkedInManager={checkLinkedInManager}
        />
      );
    }
    if (!showConnectModal) return null;
    return (
      <div
        className="crm-cat-modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget && !connecting) handleCloseConnectModal();
        }}
      >
        <div className="crm-cat-modal-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          {/* Top Banner Image with Close Button (Matching Payment Config) */}
          <div className="crm-cat-modal-banner-wrap">
            <img
              src="/catalog_banner.png"
              alt="Catalog Configuration"
              className="crm-cat-modal-banner"
            />
            <button
              type="button"
              className="crm-cat-modal-close-btn"
              onClick={handleCloseConnectModal}
              disabled={connecting}
              title="Close"
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>

          {/* Modal Body */}
          <div className="crm-cat-modal-body">
            <h3 className="crm-cat-modal-title">
              Set up your catalog to showcase products on WhatsApp.
            </h3>
            <p className="crm-cat-modal-sub">
              Connect your Meta product catalog to your WhatsApp Business account so that your customers can browse and purchase directly in WhatsApp conversations.
            </p>

            {/* Mode 1: Step List (Connect item, matching Payment Config) */}
            {modalMode === 'info' ? (
              <div className="crm-cat-steps-list">
                <div className="crm-cat-step-item">
                  <div className="crm-cat-step-icon">
                    <LinkStepIconSvg />
                  </div>
                  <div className="crm-cat-step-content">
                    <h4 className="crm-cat-step-title">Connect</h4>
                    <p className="crm-cat-step-desc">
                      Log in with Meta, pick your catalog, and the CRM connects it to your WhatsApp Business Account.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              /* Mode 2: Asking for Catalog ID (no info banner) */
              <form onSubmit={handleConnectCatalog} id="connect-catalog-form">
                <div className="crm-cat-form-card">
                  <div className="crm-cat-input-group">
                    <label className="crm-cat-input-label" htmlFor="meta-catalog-id-input">
                      <span>
                        Meta Catalog ID <span className="crm-cat-input-required">*</span>
                      </span>
                    </label>
                    <input
                      id="meta-catalog-id-input"
                      type="text"
                      inputMode="numeric"
                      className={`crm-cat-input-field ${catalogInputError ? 'error' : ''}`}
                      placeholder="e.g. 1234567890123456"
                      value={catalogInput}
                      onChange={(e) => {
                        setCatalogInput(e.target.value.replace(/[^\d]/g, ''));
                        if (catalogInputError) setCatalogInputError('');
                      }}
                      autoFocus
                      disabled={connecting}
                    />
                    {catalogInputError && (
                      <span className="crm-cat-input-error-msg">{catalogInputError}</span>
                    )}
                  </div>
                </div>
              </form>
            )}
          </div>

          {/* Modal Footer */}
          <div className="crm-cat-modal-footer">
            <p className="crm-cat-disclaimer">
              By continuing, you accept{' '}
              <a
                href="https://www.facebook.com/legal/commerce_product_merchant_agreement"
                target="_blank"
                rel="noopener noreferrer"
              >
                Meta Commerce Terms
              </a>{' '}
              and{' '}
              <a
                href="https://www.whatsapp.com/legal/business-platform-terms/"
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp Business Terms of Service
              </a>
              .
            </p>

            {modalMode === 'info' ? (
              <button
                type="button"
                className="crm-cat-get-started-btn"
                onClick={startLogin}
                disabled={phase !== '' || sdkLoading}
                data-testid="catalog-get-started"
              >
                {phase !== '' ? (
                  <>
                    <span className="material-icons" style={{ fontSize: 16, animation: 'spin 1s linear infinite' }}>
                      refresh
                    </span>
                    <span>{phase === 'popup' ? 'Waiting for Meta…' : 'Reading your catalogs…'}</span>
                  </>
                ) : sdkLoading ? (
                  <span>Loading…</span>
                ) : (
                  <span>Get started</span>
                )}
              </button>
            ) : (
              <button
                type="submit"
                form="connect-catalog-form"
                className="crm-cat-get-started-btn"
                disabled={connecting || !catalogInput.trim()}
              >
                {connecting ? (
                  <>
                    <span className="material-icons" style={{ fontSize: 16, animation: 'spin 1s linear infinite' }}>
                      refresh
                    </span>
                    <span>Connecting…</span>
                  </>
                ) : (
                  <span>{catalogId ? 'Save Catalog' : 'Connect Catalog'}</span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // 1. Success Screen State (after connecting Meta Catalog)
  if (showSuccessScreen) {
    return (
      <div className="crm-cat-onboarding">
        <div className="crm-cat-success-container">
          {/* Animated checkmark icon */}
          <div className="crm-cat-success-icon-wrap">
            <div className="crm-cat-success-pulse" />
            <div className="crm-cat-success-circle">
              <svg
                width="38"
                height="38"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>

          <h1 className="crm-cat-success-title">Catalog Connected Successfully!</h1>
          <p className="crm-cat-success-subtitle">
            Your Meta product catalog is now connected to your WhatsApp Business Account. You can now showcase your
            products, send interactive collections, and accept orders directly in chat.
          </p>

          {/* Connection summary details card */}
          <div className="crm-cat-success-card">
            <div className="crm-cat-success-card-header">
              <div className="crm-cat-success-card-title">
                <CatalogCartSvg width={20} height={20} />
                <span>Meta Commerce Connection Details</span>
              </div>
              <span className="crm-cat-success-pill">
                <span className="crm-cat-status-dot" /> Connected
              </span>
            </div>

            <div className="crm-cat-success-rows">
              <div className="crm-cat-success-row">
                <span className="crm-cat-success-label">Catalog ID:</span>
                <span className="crm-cat-success-val mono">
                  {catalogId}
                  <button
                    type="button"
                    className="crm-cat-copy-btn"
                    onClick={handleCopyId}
                    title="Copy Catalog ID"
                    aria-label="Copy Catalog ID"
                  >
                    <span className="material-icons" style={{ fontSize: 16 }}>
                      {copied ? 'check' : 'content_copy'}
                    </span>
                  </button>
                </span>
              </div>

              <div className="crm-cat-success-row">
                <span className="crm-cat-success-label">Catalog Name:</span>
                <span className="crm-cat-success-val">{catalogName || 'Meta Product Catalog'}</span>
              </div>

              <div className="crm-cat-success-row">
                <span className="crm-cat-success-label">Channel Status:</span>
                <span className="crm-cat-success-val" style={{ color: '#15803d' }}>
                  Active &amp; Ready for WhatsApp Chat
                </span>
              </div>

              <div className="crm-cat-success-row">
                <span className="crm-cat-success-label">Inventory:</span>
                <span className="crm-cat-success-val">
                  {products.length} product{products.length === 1 ? '' : 's'} available
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="crm-cat-success-actions">
            <button
              type="button"
              className="crm-cat-success-btn-primary"
              onClick={() => {
                setShowSuccessScreen(false);
                load();
              }}
            >
              <CatalogCartSvg width={18} height={18} />
              <span>Continue to Catalog</span>
            </button>

            <button
              type="button"
              className="crm-cat-success-btn-secondary"
              onClick={() => {
                setShowSuccessScreen(false);
                sync();
              }}
            >
              <span className="material-icons" style={{ fontSize: 18 }}>
                sync
              </span>
              <span>Sync Products to Meta</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Unconnected State: Show Modern Hero (Matching Meta Channels layout)
  if (!catalogId && !loading) {
    return (
      <div className="crm-cat-onboarding">
        <div className="cs-unconnected-hero-box">
          <div className="cs-unconnected-logos-row">
            <img src="/channel-catalog.svg" alt="Catalog" className="cs-unconnected-logo-img" />
            <span className="cs-unconnected-arrow">⇄</span>
            <MetaInfinityLogo width={46} height={31} />
          </div>

          <h2 className="cs-unconnected-headline">
            To showcase products, connect your Meta Catalog
          </h2>
          <p className="cs-unconnected-subline">
            Once connected, you can start showcasing and selling products directly on WhatsApp
          </p>

          <div className="cs-unconnected-benefits-box">
            <h3 className="cs-unconnected-benefits-title">
              Benefits of connecting your own catalog
            </h3>
            <ul className="cs-unconnected-benefits-list">
              <li className="cs-unconnected-benefit-item">
                <BenefitCheckIcon />
                <span>Showcase full product collections &amp; in-chat storefront</span>
              </li>
              <li className="cs-unconnected-benefit-item">
                <BenefitCheckIcon />
                <span>Customers can browse, add to cart, and order on WhatsApp</span>
              </li>
              <li className="cs-unconnected-benefit-item">
                <BenefitCheckIcon />
                <span>Automated real-time inventory and pricing sync with Meta</span>
              </li>
            </ul>

            <div className="cs-unconnected-cta-row">
              <button
                type="button"
                className="cs-connect-channel-btn"
                onClick={() => {
                  setCatalogInput('');
                  setCatalogInputError('');
                  setModalMode('info');
                  setShowConnectModal(true);
                }}
              >
                Connect Meta Catalog
              </button>
            </div>
          </div>
        </div>

        {/* Connect Catalog Modal */}
        {renderConnectCatalogModal()}
      </div>
    );
  }

  // 3. Connected State: Render Product Grid with Status Badge & Sync Actions
  return (
    <div className="page cat-page">
      <header className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2>Catalog</h2>
          {catalogId && (
            <div className="crm-cat-status-badge" title={`Meta Catalog ID: ${catalogId}`}>
              <CatalogCartSvg width={14} height={14} />
              <span className="crm-cat-status-dot" />
              <span className="crm-cat-status-text">
                Linked: <strong>{catalogName || catalogId}</strong>
              </span>
              <button
                type="button"
                className="crm-cat-status-btn"
                onClick={() => {
                  setCatalogInput(catalogId);
                  setCatalogInputError('');
                  setModalMode('info');
                  setShowConnectModal(true);
                }}
                title="Change Catalog ID"
              >
                Change
              </button>
              <button
                type="button"
                className="crm-cat-status-btn disconnect"
                onClick={handleDisconnect}
                title="Disconnect Meta Catalog"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>

        <button className="k-btn ghost sm" onClick={sync} disabled={syncing}>
          <span className="material-icons">sync</span> {syncing ? 'Syncing…' : 'Sync to Meta'}
        </button>
        <button className="page-add" onClick={() => setEditing('new')} title="Add product">
          <span className="material-icons">add</span>
        </button>
      </header>

      <div className="page-body">
        {loading && <BladeSpinner center={true} containerHeight={200} />}
        {!loading && products.length === 0 && (
          <div className="page-note">No products yet. Tap + to add one.</div>
        )}
        <div className="prod-grid">
          {products.map((p) => {
            const sched = scheduleLabel(p);
            const svs = selectables(p);
            const sel = svs[picked[p._id] ?? 0] || svs[0];
            const offer = offerMap[`${p._id}#${sel.index}`];
            const hasVariants = !!(p.variants && p.variants.length);
            return (
              <div className="prod-card" key={p._id}>
                <div className="prod-card-img" onClick={() => setViewing(p)} role="button" title="View details">
                  {/* Cycles the selected size's photos every 3s. Arrows are off
                      here — the card is small and the badges already sit on
                      top; the dots still allow stepping through. */}
                  <PhotoCarousel photos={sel.photos} controls={false} />
                  <span className={`prod-badge ${p.isPaused ? 'off' : 'on'}`}>
                    {p.isPaused ? 'Paused' : 'Available'}
                  </span>
                  {/* Hover shows Meta's own reason when a push was rejected. */}
                  <span
                    className={`prod-sync ${p.catalogSynced ? 'ok' : p.catalogError ? 'failed' : 'pending'}`}
                    title={
                      p.catalogSynced
                        ? 'Synced to Meta'
                        : p.catalogError
                          ? `Not in Meta: ${p.catalogError}`
                          : 'Not synced yet'
                    }
                  >
                    <span className="material-icons">
                      {p.catalogSynced ? 'cloud_done' : p.catalogError ? 'cloud_off' : 'cloud_upload'}
                    </span>
                  </span>
                  {offer && <span className="prod-offer-tag">Offer</span>}
                </div>
                <div className="prod-card-body">
                  <button type="button" className="prod-card-name prod-card-open" onClick={() => setViewing(p)}>
                    {p.name}
                  </button>
                  <div className="prod-card-cats">
                    {p.categories.map((c) => (
                      <span className="k-chip sm" key={c}>
                        {c}
                      </span>
                    ))}
                  </div>
                  <div className="prod-card-price">
                    {offer ? (
                      <>
                        <span className="prod-offer-price">{money(offer.offerPrice)}</span>
                        <span className="prod-mrp">{money(sel.price)}</span>
                      </>
                    ) : (
                      <>
                        {money(sel.price)}
                        {p.mrp && p.mrp > sel.price && !hasVariants && <span className="prod-mrp">{money(p.mrp)}</span>}
                      </>
                    )}
                    {sel.unit && <span className="prod-unit"> / {sel.unit}</span>}
                  </div>
                  {hasVariants && (
                    <div className="prod-variants">
                      {svs.map((v) => (
                        <button
                          type="button"
                          className={`k-chip sm selectable${(picked[p._id] ?? 0) === v.index ? ' on' : ''}`}
                          key={v.index}
                          onClick={() => setPicked((m) => ({ ...m, [p._id]: v.index }))}
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {sched && (
                    <div className="prod-sched">
                      <span className="material-icons">schedule</span> {sched}
                    </div>
                  )}
                </div>
                <div className="prod-card-actions">
                  <button
                    className="prod-act"
                    onClick={() => toggleAvailability(p)}
                    title={p.isPaused ? 'Mark available' : 'Mark sold out'}
                  >
                    <span className="material-icons">{p.isPaused ? 'play_circle' : 'pause_circle'}</span>
                  </button>
                  <button className="prod-act" onClick={() => setEditing(p)} title="Edit">
                    <span className="material-icons">edit</span>
                  </button>
                  <button className="prod-act danger" onClick={() => remove(p)} title="Delete">
                    <span className="material-icons">delete</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit/Change Catalog Modal in Connected State */}
      {renderConnectCatalogModal()}
    </div>
  );
}
