// Categories management: a 5-column card grid with a top + to add. Adding and
// editing happen in a popup. Categories feed the product editor's multi-select.
import { useEffect, useRef, useState } from 'react';
import { useBackHandler } from '../useBackHandler';
import type { CrmApi } from '../api';
import type { Category } from '../types';
import { verticalConfig, type VerticalConfig } from '../verticals';
import { useConfirm, useNotify } from './Dialogs';

import { CrmEmptyState } from './CrmEmptyState';
import { CARD_PAGE_SIZES, Pager, usePaged } from './Pager';
import { BladeSpinner } from './BladeSpinner';
import { WhatsAppConnectRequired } from './WhatsAppConnectRequired';
import type { BusinessProfile } from '../types';

interface Props {
  api: CrmApi;
  vertical?: VerticalConfig;
  business?: BusinessProfile;
  demo?: boolean;
  onConnected?: (b: BusinessProfile) => void;
}

export function CategoriesPage({ api, vertical, business, demo, onConnected }: Props) {
  const v = vertical || verticalConfig('other');
  const confirm = useConfirm();
  const notify = useNotify();

  if (!demo && business && !business.whatsappConnected) {
    return <WhatsAppConnectRequired page="categories" api={api} business={business} onConnected={onConnected} />;
  }
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  // null = modal closed, 'new' = add, Category = edit.
  const [modal, setModal] = useState<Category | 'new' | null>(null);

  function load() {
    setLoading(true);
    api
      .getCategories()
      .then((res) => setCategories(res.data || []))
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lowerSingular = v.categoryLabel.toLowerCase();

  const paged = usePaged(categories, '', { key: 'categories', size: 24, sizes: CARD_PAGE_SIZES, noun: [v.categoryLabel.toLowerCase(), v.categoryPlural.toLowerCase()] });

  async function remove(c: Category) {
    const ok = await confirm({
      title: `Delete ${lowerSingular}?`,
      message: `“${c.name}” will be removed. Items in it stay, they just won't be grouped under it any more.`,
      confirmLabel: `Delete ${lowerSingular}`,
    });
    if (!ok) return;
    try {
      await api.deleteCategory(c._id);
      notify('success', `${v.categoryLabel} deleted`, `“${c.name}” was removed.`);
      load();
    } catch (e) {
      notify('error', 'Delete failed', e instanceof Error ? e.message : `Could not delete the ${lowerSingular}.`);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h2>{v.categoryPlural}</h2>
        <button className="page-add" onClick={() => setModal('new')} title={`Add ${lowerSingular}`}>
          <span className="material-icons">add</span>
        </button>
      </header>

      <div className="page-body">
        {loading && <BladeSpinner center={true} containerHeight={200} />}
        {!loading && categories.length === 0 && (
          <CrmEmptyState
            icon="category"
            iconTone="primary"
            title={`No ${v.categoryPlural.toLowerCase()} created yet`}
            description={`Organize your items into ${v.categoryPlural.toLowerCase()} so customers can easily browse, filter, and discover products in your WhatsApp catalog.`}
            actionLabel={`Add ${v.categoryLabel}`}
            actionIcon="add"
            onAction={() => setModal('new')}
          />
        )}
        {!loading && categories.length > 0 && (
          <div className="cat-grid">
            {paged.items.map((c) => (
              <div className="cat-card" key={c._id}>
                <div className="cat-card-actions">
                  <button className="cat-card-btn" onClick={() => setModal(c)} title="Edit">
                    <span className="material-icons">edit</span>
                  </button>
                  <button className="cat-card-btn danger" onClick={() => remove(c)} title="Delete">
                    <span className="material-icons">delete</span>
                  </button>
                </div>
                {c.imageUrl ? (
                  <img className="cat-card-img" src={c.imageUrl} alt="" />
                ) : (
                  <div className="cat-card-img ph">
                    <span className="material-icons">category</span>
                  </div>
                )}
                <div className="cat-card-name">{c.name}</div>
              </div>
            ))}
          </div>
        )}
        {!loading && categories.length > 0 && <Pager {...paged.pager} />}
      </div>

      {modal && (
        <CategoryModal
          api={api}
          vertical={v}
          category={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function CategoryModal({
  api,
  vertical,
  category,
  onClose,
  onSaved,
}: {
  api: CrmApi;
  vertical: VerticalConfig;
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!category;
  useBackHandler(true, onClose);
  const [name, setName] = useState(category?.name || '');
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState(category?.imageUrl || '');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setImage(f);
    if (f) setImagePreview(URL.createObjectURL(f));
  }

  function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    const fd = new FormData();
    fd.append('name', name.trim());
    if (image) fd.append('image', image);
    const req = editing && category ? api.updateCategory(category._id, fd) : api.createCategory(fd);
    req.then(onSaved).finally(() => setSaving(false));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            {editing ? 'Edit' : 'New'} {vertical.categoryLabel.toLowerCase()}
          </h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </div>

        <div className="modal-body">
          <div className="k-field">
            <label className="k-label">{vertical.categoryLabel} name</label>
            <input
              className="k-input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${vertical.categoryExample}`}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </div>
          <div className="k-field">
            <label className="k-label">Image (optional)</label>
            <div className="uploader">
              <label className="k-btn ghost sm file-btn">
                <span className="material-icons">upload</span> Choose image
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={onImage} />
              </label>
              {imagePreview && <img className="cat-add-preview" src={imagePreview} alt="" />}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button className="k-btn ghost sm" onClick={onClose}>
            Cancel
          </button>
          <button className="k-btn" onClick={save} disabled={!name.trim() || saving}>
            <span className="material-icons">{editing ? 'save' : 'add'}</span>
            {saving ? 'Saving…' : editing ? 'Save' : `Add ${vertical.categoryLabel.toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
