// The WhatsApp business profile of the business's own number: photo, about,
// address, description, email, industry and two websites. Read from Meta and
// saved to Meta (backend routes/settings.js /whatsapp-profile). Used by the
// Settings page and the Business profile page, so there is one editor.
//
// A business without its own number (unconnected, or trying the shared test
// number) sees why it can't edit the profile instead of the form.
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { CrmApi } from '../api';
import type { WhatsAppProfile, WhatsAppProfileUpdate, WhatsAppVertical, BusinessProfile } from '../types';
import type { CrmView } from './NavRail';
import { Dropdown } from './Dropdown';
import { useNotify } from './Dialogs';
import { BusinessProfilePhonePreview } from './BusinessProfilePhonePreview';
import { ProfilePhotoCropper } from './ProfilePhotoCropper';
import { verticalConfig } from '../verticals';
import './WhatsAppProfileEditor.css';

interface Props {
  api: CrmApi;
  onNavigate?: (view: CrmView) => void;
  /** Fallback initial for the photo box. */
  businessName?: string;
  showPhonePreview?: boolean;
  category?: string;
  business?: BusinessProfile;
}

/** Fired after the profile changes on Meta, so the profile sidebar refetches. */
export const PROFILE_UPDATED_EVENT = 'crm_profile_updated';

const ABOUT_MAX = 139;
const DESCRIPTION_MAX = 512;
// What Meta takes (the cropped JPEG is far smaller)…
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
// …and what can be picked: it's cropped and re-saved before upload.
const PHOTO_PICK_MAX_BYTES = 20 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface Form {
  about: string;
  address: string;
  description: string;
  email: string;
  vertical: string;
  website1: string;
  website2: string;
}

// UNDEFINED is Meta's old "nothing chosen"; the form treats it as empty.
const formOf = (p: WhatsAppProfile): Form => ({
  about: p.about,
  address: p.address,
  description: p.description,
  email: p.email,
  vertical: p.vertical === 'UNDEFINED' ? '' : p.vertical,
  website1: p.websites[0] || '',
  website2: p.websites[1] || '',
});

const chars = (s: string) => [...s].length;

type ApiErr = Error & { status?: number; data?: { errors?: Record<string, string>; message?: string } | null };

export function WhatsAppProfileEditor({
  api,
  onNavigate,
  businessName = '',
  showPhonePreview = true,
  category,
  business,
}: Props) {
  const notify = useNotify();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unconnected' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [notConnectedMsg, setNotConnectedMsg] = useState('');
  const [profile, setProfile] = useState<WhatsAppProfile | null>(null);
  const [verticals, setVerticals] = useState<WhatsAppVertical[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  // The photo being cropped, before upload.
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [products, setProducts] = useState<{ name: string; imageUrl?: string; price?: number }[]>([]);
  const [bizCat, setBizCat] = useState<string>(category || business?.category || '');

  useEffect(() => {
    if (category || business?.category) {
      setBizCat(category || business?.category || '');
      return;
    }
    apiRef.current
      .getMe()
      .then((r) => {
        if (r.business?.category) {
          setBizCat(r.business.category);
        }
      })
      .catch(() => {});
  }, [category, business?.category]);

  const hasCatalog = useMemo(() => {
    const cat = bizCat || 'other';
    const v = verticalConfig(cat);
    return v.showsPage('catalog');
  }, [bizCat]);

  useEffect(() => {
    apiRef.current
      .getProducts()
      .then((res) => {
        if (res.data) {
          setProducts(
            res.data.map((p) => ({
              name: p.name,
              imageUrl: p.imageUrl || p.gallery?.[0],
              price: p.price,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  const adopt = useCallback((p: WhatsAppProfile) => {
    setProfile(p);
    setForm(formOf(p));
    setPhotoFailed(false);
  }, []);

  // The shell can hand over a new CrmApi object on any re-render (e.g. when a
  // toast appears); reloading then would wipe the user's unsaved edits, so
  // the profile is loaded once and the latest client is read from a ref.
  const apiRef = useRef(api);
  apiRef.current = api;

  const load = useCallback(() => {
    setState('loading');
    setLoadError('');
    apiRef.current
      .getWhatsAppProfile()
      .then((r) => {
        setVerticals(r.verticals || []);
        if (!r.connected || !r.data) {
          setNotConnectedMsg(r.message || '');
          setState('unconnected');
          return;
        }
        adopt(r.data);
        setState('ready');
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : 'Could not load the WhatsApp profile.');
        setState('error');
      });
  }, [adopt]);

  useEffect(() => {
    load();
  }, [load]);

  const changes = useMemo<WhatsAppProfileUpdate>(() => {
    if (!profile || !form) return {};
    const base = formOf(profile);
    const out: WhatsAppProfileUpdate = {};
    if (form.about !== base.about) out.about = form.about;
    if (form.address !== base.address) out.address = form.address;
    if (form.description !== base.description) out.description = form.description;
    if (form.email !== base.email) out.email = form.email;
    if (form.vertical !== base.vertical) out.vertical = form.vertical;
    if (form.website1 !== base.website1 || form.website2 !== base.website2) out.websites = [form.website1, form.website2];
    return out;
  }, [profile, form]);
  const dirty = Object.keys(changes).length > 0;

  const verticalOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Not set' }, ...verticals];
    const current = profile?.vertical || '';
    // An old value Meta no longer accepts (e.g. NOT_A_BIZ) is still shown.
    if (current && current !== 'UNDEFINED' && !opts.some((o) => o.value === current)) {
      opts.push({ value: current, label: profile?.verticalLabel || current });
    }
    return opts;
  }, [verticals, profile]);

  const set = (key: keyof Form) => (value: string) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    if (errors[key] || (key.startsWith('website') && errors.websites)) {
      setErrors((e) => {
        const next = { ...e };
        delete next[key];
        if (key.startsWith('website')) delete next.websites;
        return next;
      });
    }
  };

  function announce() {
    window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setAlert('');
    setErrors({});
    try {
      const r = await api.saveWhatsAppProfile(changes);
      if (r.data) adopt(r.data);
      else if (profile && form) {
        // Saved, but Meta's re-read failed: keep what was saved as the baseline.
        adopt({
          ...profile,
          about: form.about,
          address: form.address,
          description: form.description,
          email: form.email,
          vertical: form.vertical,
          verticalLabel: verticalOptions.find((o) => o.value === form.vertical)?.label || '',
          websites: [form.website1, form.website2],
        });
      }
      announce();
      notify('success', 'WhatsApp profile saved', 'Your changes are live on WhatsApp.');
    } catch (e) {
      const err = e as ApiErr;
      const fieldErrors = err.data?.errors || {};
      setErrors(fieldErrors);
      if (err.status === 400 && Object.keys(fieldErrors).length) {
        notify('error', 'Check the highlighted fields', err.message);
      } else {
        setAlert(err.message || 'WhatsApp did not accept the change.');
        notify('error', 'WhatsApp didn’t accept the change', err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  // A picked photo opens the cropper first; what it returns (a 640×640 JPEG,
  // the size and format WhatsApp wants) is what goes to Meta.
  function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      setErrors((x) => ({ ...x, picture: 'The photo must be a JPEG, PNG or WebP image.' }));
      return;
    }
    if (file.size > PHOTO_PICK_MAX_BYTES) {
      setErrors((x) => ({ ...x, picture: 'The photo must be 20 MB or smaller.' }));
      return;
    }
    setErrors((x) => {
      const next = { ...x };
      delete next.picture;
      return next;
    });
    setCropFile(file);
  }

  async function uploadPhoto(file: File) {
    setCropFile(null);
    if (file.size > PHOTO_MAX_BYTES) {
      setErrors((x) => ({ ...x, picture: 'The cropped photo came out larger than 5 MB. Try a simpler photo.' }));
      return;
    }
    setAlert('');
    setUploading(true);
    try {
      const r = await api.uploadWhatsAppProfilePicture(file);
      const url = r.data?.profilePictureUrl || r.profilePictureUrl || '';
      setProfile((p) => (p ? { ...p, profilePictureUrl: url || p.profilePictureUrl } : p));
      setPhotoFailed(false);
      announce();
      notify('success', 'WhatsApp photo updated', 'Customers now see the new photo on your WhatsApp profile.');
    } catch (err) {
      const ae = err as ApiErr;
      if (ae.status === 400) setErrors((x) => ({ ...x, picture: ae.message }));
      else setAlert(ae.message || 'WhatsApp did not accept the photo.');
      notify('error', 'Photo not updated', ae.message);
    } finally {
      setUploading(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="wpe-loading-pane">
        <div className="bg">
          <div className="loader" />
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="wpe-alert" role="alert">
        <div>
          <strong>Couldn’t load the WhatsApp profile.</strong>
          <span>{loadError}</span>
        </div>
        <button type="button" className="wpe-btn-ghost" onClick={load}>Try again</button>
      </div>
    );
  }

  if (state === 'unconnected' || !profile || !form) {
    return (
      <div className="wpe-unconnected" data-testid="wpe-unconnected">
        <span className="material-icons" aria-hidden="true">lock</span>
        <div className="wpe-unconnected-text">
          <strong>Your WhatsApp profile isn’t available yet</strong>
          <p>
            {notConnectedMsg
              || 'Connect your own WhatsApp number to see and edit its WhatsApp profile. The shared test number’s profile can’t be changed.'}
          </p>
          {onNavigate && (
            <button type="button" className="wpe-btn" onClick={() => onNavigate('channel-status')}>
              Connect your WhatsApp number
            </button>
          )}
        </div>
      </div>
    );
  }

  const photo = !photoFailed ? profile.profilePictureUrl : '';
  const initial = (profile.verifiedName || businessName || 'W').trim().charAt(0).toUpperCase();
  const aboutLen = chars(form.about);
  const descLen = chars(form.description);
  const err = (k: string) => errors[k] && <span className="wpe-err" role="alert">{errors[k]}</span>;

  return (
    <div className={`wpe-wrapper${showPhonePreview ? ' has-preview' : ''}`} data-testid="wpe-form">
      <div className="wpe-form-col">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onPhoto}
          style={{ display: 'none' }}
          aria-hidden="true"
          data-testid="wpe-photo-input"
        />

        {alert && (
          <div className="wpe-alert" role="alert" data-testid="wpe-alert">
            <div>
              <strong>WhatsApp didn’t accept the change.</strong>
              <span>{alert}</span>
            </div>
            <button type="button" className="wpe-alert-close" onClick={() => setAlert('')} aria-label="Dismiss">✕</button>
          </div>
        )}

        <div className="wpe-photo-row">
          <div className="wpe-photo" aria-label="WhatsApp profile photo">
            {photo ? (
              <img src={photo} alt="WhatsApp profile" onError={() => setPhotoFailed(true)} />
            ) : (
              <span>{initial}</span>
            )}
          </div>
          <div className="wpe-photo-side">
            <div className="wpe-number">
              <span className="wpe-number-name">{profile.verifiedName || businessName}</span>
              {profile.displayPhoneNumber && <span className="wpe-number-phone">{profile.displayPhoneNumber}</span>}
            </div>
            <button
              type="button"
              className="wpe-btn-ghost"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <span className="material-icons" aria-hidden="true">photo_camera</span>
              {uploading ? 'Updating photo on WhatsApp…' : 'Change photo'}
            </button>
            <small className="wpe-hint">JPEG, PNG or WebP. You’ll crop it to a square, saved at 640×640 as WhatsApp recommends.</small>
            {err('picture')}
          </div>
        </div>
        {cropFile && (
          <ProfilePhotoCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={uploadPhoto} />
        )}

        <div className="wpe-grid">
          <div className="wpe-field wide">
            <label htmlFor="wpe-about">About</label>
            <input
              id="wpe-about"
              className={`wpe-input${errors.about ? ' bad' : ''}`}
              value={form.about}
              onChange={(e) => set('about')(e.target.value)}
              placeholder="A short line under your name, e.g. Open 9am–9pm"
            />
            <div className="wpe-meta">
              {err('about')}
              <span className={`wpe-count${aboutLen > ABOUT_MAX ? ' over' : ''}`}>{aboutLen}/{ABOUT_MAX}</span>
            </div>
          </div>

          <div className="wpe-field wide">
            <label htmlFor="wpe-description">Business description</label>
            <textarea
              id="wpe-description"
              className={`wpe-input wpe-textarea${errors.description ? ' bad' : ''}`}
              value={form.description}
              onChange={(e) => set('description')(e.target.value)}
              placeholder="What your business does"
              rows={3}
            />
            <div className="wpe-meta">
              {err('description')}
              <span className={`wpe-count${descLen > DESCRIPTION_MAX ? ' over' : ''}`}>{descLen}/{DESCRIPTION_MAX}</span>
            </div>
          </div>

          <div className="wpe-field">
            <label htmlFor="wpe-address">Business address</label>
            <input
              id="wpe-address"
              className={`wpe-input${errors.address ? ' bad' : ''}`}
              value={form.address}
              onChange={(e) => set('address')(e.target.value)}
              placeholder="Street, city"
            />
            {err('address')}
          </div>

          <div className="wpe-field">
            <label htmlFor="wpe-email">Email for business contact</label>
            <input
              id="wpe-email"
              type="email"
              className={`wpe-input${errors.email ? ' bad' : ''}`}
              value={form.email}
              onChange={(e) => set('email')(e.target.value)}
              placeholder="hello@yourbusiness.com"
            />
            {err('email')}
          </div>

          <div className="wpe-field">
            <span className="wpe-label" id="wpe-industry-label">Business industry</span>
            <Dropdown options={verticalOptions} value={form.vertical} onChange={set('vertical')} placeholder="Not set" />
            {err('vertical')}
          </div>

          <div className="wpe-field" />

          <div className="wpe-field">
            <label htmlFor="wpe-website1">Website 1</label>
            <input
              id="wpe-website1"
              type="url"
              className={`wpe-input${errors.website1 ? ' bad' : ''}`}
              value={form.website1}
              onChange={(e) => set('website1')(e.target.value)}
              placeholder="https://yourbusiness.com"
            />
            {err('website1')}
          </div>

          <div className="wpe-field">
            <label htmlFor="wpe-website2">Website 2</label>
            <input
              id="wpe-website2"
              type="url"
              className={`wpe-input${errors.website2 ? ' bad' : ''}`}
              value={form.website2}
              onChange={(e) => set('website2')(e.target.value)}
              placeholder="https://instagram.com/yourbusiness"
            />
            {err('website2')}
          </div>
          {errors.websites && <div className="wpe-field wide">{err('websites')}</div>}
        </div>

        <div className="wpe-actions">
          <button type="button" className="wpe-btn" disabled={!dirty || saving} onClick={save} data-testid="wpe-save">
            {saving ? 'Saving to WhatsApp…' : 'Save to WhatsApp'}
          </button>
          {dirty && !saving && (
            <button type="button" className="wpe-btn-ghost" onClick={() => { setForm(formOf(profile)); setErrors({}); }}>
              Discard changes
            </button>
          )}
          <small className="wpe-hint">Changes go straight to your WhatsApp profile on Meta.</small>
        </div>
      </div>

      {showPhonePreview && (
        <div className="wpe-preview-col">
          <BusinessProfilePhonePreview
            businessName={profile.verifiedName || businessName}
            phone={profile.displayPhoneNumber || ''}
            avatarUrl={photo}
            about={form.about}
            description={form.description}
            address={form.address}
            email={form.email}
            categoryLabel={verticalOptions.find((o) => o.value === form.vertical)?.label || form.vertical}
            websites={[form.website1, form.website2]}
            products={products}
            hasCatalog={hasCatalog}
          />
        </div>
      )}
    </div>
  );
}

export default WhatsAppProfileEditor;
