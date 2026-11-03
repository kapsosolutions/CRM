// Members directory — the people or units a business lists in its flows.
// What a "member" is comes from the business vertical (crm/verticals.ts):
// doctors for a hospital, room types for a hotel, agents for an agency. The
// schema is shared; the labels and which fields appear adapt per vertical.
//
// Adding/editing happens on a full page: form on the left, live preview on the
// right (profile card + exactly how the row renders inside a WhatsApp flow).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CrmApi } from '../api';
import type { Category, DaySchedule, Member, TimeWindow, Unavailability } from '../types';
import type { VerticalConfig } from '../verticals';
import { verticalConfig } from '../verticals';
import { useConfirm, useFlash } from './Dialogs';
import { useBackHandler } from '../useBackHandler';
import { CrmEmptyState } from './CrmEmptyState';
import { BladeSpinner } from './BladeSpinner';
import { CARD_PAGE_SIZES, Pager, usePaged } from './Pager';
import { WhatsAppConnectRequired } from './WhatsAppConnectRequired';
import type { BusinessProfile } from '../types';

const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

const DAY_ORDER = DAYS.map((d) => d.key);
const dayName = (k: string) => DAYS.find((d) => d.key === k)?.label || k;

/** 'HH:MM' → minutes, -1 when unusable. Mirrors services/slots.js. */
function toMinutes(hhmm?: string): number {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return -1;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? -1 : h * 60 + min;
}

const to12h = (hhmm?: string) => {
  const mins = toMinutes(hhmm);
  if (mins < 0) return String(hhmm || '');
  const h24 = Math.floor(mins / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mins % 60).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
};

/**
 * The member's schedule in the per-day shape, widening the legacy single
 * window so an existing doctor's hours appear in the new editor instead of
 * looking blank.
 */
function scheduleOf(m: Partial<Member>): DaySchedule[] {
  const sched = (m.schedule || []).filter((d) => d.day && (d.windows || []).length);
  if (sched.length) {
    return DAY_ORDER.filter((k) => sched.some((s) => s.day === k)).map((k) => ({
      day: k,
      windows: sched.find((s) => s.day === k)!.windows,
    }));
  }
  if (toMinutes(m.availableFrom) < 0 || toMinutes(m.availableTo) <= toMinutes(m.availableFrom)) {
    return [];
  }
  return DAY_ORDER.filter((k) => (m.availableDays || []).includes(k)).map((k) => ({
    day: k,
    windows: [{ from: m.availableFrom!, to: m.availableTo! }],
  }));
}

/** How many slots a set of windows yields at a given slot length. */
function countSlots(windows: TimeWindow[], minutes: number): number {
  const step = minutes > 0 ? minutes : 30;
  return windows.reduce((n, w) => {
    const from = toMinutes(w.from);
    const to = toMinutes(w.to);
    if (from < 0 || to <= from) return n;
    return n + Math.floor((to - from) / step);
  }, 0);
}

const todayISO = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

const NEW_WINDOW: TimeWindow = { from: '10:00', to: '13:00' };

const parseList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/**
 * Comma-separated text that edits a string[].
 *
 * The obvious version — `value={list.join(', ')}` with an onChange that splits,
 * trims and filters — cannot work: the moment you type the comma, the split
 * yields a trailing empty entry, `filter(Boolean)` drops it, and the value is
 * rebuilt without the comma you just typed. The separator is deleted on every
 * keystroke, so a second item can never be entered.
 *
 * The raw text therefore lives here and is only reconciled with the array when
 * the field isn't being edited. The parsed array still updates as you type, so
 * saving without blurring works.
 */
function ListInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const joined = (value || []).join(', ');
  const [text, setText] = useState(joined);
  const editing = useRef(false);

  // Re-sync only when the value changed elsewhere (a different member loaded).
  useEffect(() => {
    if (!editing.current) setText(joined);
  }, [joined]);

  return (
    <input
      className="k-input"
      value={text}
      placeholder={placeholder}
      onFocus={() => {
        editing.current = true;
      }}
      onBlur={() => {
        editing.current = false;
        setText(parseList(text).join(', '));
      }}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseList(e.target.value));
      }}
    />
  );
}

/** What the server reports back about an absence added by a save. */
interface MemberSaveNotice {
  date: string;
  affected: number;
  sent?: number;
  skipped?: number;
  reason?: string;
}

interface Props {
  api: CrmApi;
  vertical?: VerticalConfig;
  business?: BusinessProfile;
  demo?: boolean;
  onConnected?: (b: BusinessProfile) => void;
}

export function MembersPage({ api, vertical, business, demo, onConnected }: Props) {
  const v = vertical || verticalConfig('other');
  const flash = useFlash();
  const confirm = useConfirm();

  if (!demo && business && !business.whatsappConnected) {
    return <WhatsAppConnectRequired page="members" api={api} business={business} onConnected={onConnected} />;
  }

  const [members, setMembers] = useState<Member[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  // null = list view, 'new' = add, Member = edit.
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [filter, setFilter] = useState('');

  function load() {
    setLoading(true);
    api
      .getMembers()
      .then((res) => setMembers(res.data || []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api
      .getCategories()
      .then((res) => setCategories(res.data || []))
      .catch(() => setCategories([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove(m: Member) {
    const one = v.memberSingular.toLowerCase();
    const ok = await confirm({
      title: `Delete ${one}?`,
      message: `“${m.name}” will be removed and stops showing in your WhatsApp flows. Past bookings stay in Orders.`,
      confirmLabel: `Delete ${one}`,
    });
    if (!ok) return;
    try {
      await api.deleteMember(m._id);
      flash(`${v.memberSingular} deleted. “${m.name}” was removed.`);
      load();
    } catch (e) {
      flash(`Delete failed. ${e instanceof Error ? e.message : `Could not delete the ${one}.`}`, 'error');
    }
  }

  // Paged in group order, then each page is grouped (a group can continue on the next page).
  const groupOf = (m: Member) => m.category || 'Uncategorised';
  const shown = useMemo(
    () => (filter ? members.filter((m) => (m.category || '') === filter) : members)
      .map((m, i) => ({ m, i }))
      .sort((a, b) => groupOf(a.m).localeCompare(groupOf(b.m)) || a.i - b.i)
      .map((x) => x.m),
    [members, filter],
  );
  const paged = usePaged(shown, filter, { key: 'members', size: 24, sizes: CARD_PAGE_SIZES, noun: [v.memberSingular.toLowerCase(), v.memberLabel.toLowerCase()] });

  if (editing) {
    return (
      <MemberEditor
        api={api}
        vertical={v}
        member={editing === 'new' ? null : editing}
        categories={categories}
        onBack={() => setEditing(null)}
        onSaved={(note) => {
          setEditing(null);
          flash(note ? `${v.memberSingular} saved. ${note}` : `${v.memberSingular} saved.`);
          load();
        }}
      />
    );
  }

  const groups = [...new Set(paged.items.map(groupOf))];

  return (
    <div className="page">
      <header className="page-head">
        <h2>{v.memberLabel}</h2>
        {categories.length > 0 && (
          <select className="k-input sm mem-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All {v.categoryLabel.toLowerCase()}s</option>
            {categories.map((c) => (
              <option key={c._id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <button className="page-add" onClick={() => setEditing('new')} title={`Add ${v.memberSingular.toLowerCase()}`}>
          <span className="material-icons">add</span>
        </button>
      </header>

      <div className="page-body">
        {loading && <BladeSpinner center={true} containerHeight={200} />}
        {!loading && members.length === 0 && (
          <CrmEmptyState
            icon="people_outline"
            iconTone="purple"
            title={`No ${v.memberLabel.toLowerCase()} added yet`}
            description={`Add your ${v.memberLabel.toLowerCase()} so customers can view specialist profiles, check slot availability, and book appointments directly on WhatsApp.`}
            actionLabel={`Add ${v.memberSingular}`}
            actionIcon="add"
            onAction={() => setEditing('new')}
          />
        )}
        {!loading && members.length > 0 && shown.length === 0 && (
          <CrmEmptyState
            icon="filter_list_off"
            iconTone="slate"
            title={`No ${v.memberLabel.toLowerCase()} in "${filter}"`}
            description={`There are currently no items categorized under "${filter}". You can add one or clear the category filter.`}
            actionLabel="Clear filter"
            actionIcon="clear"
            onAction={() => setFilter('')}
            secondaryActionLabel={`Add to ${filter}`}
            onSecondaryAction={() => setEditing('new')}
          />
        )}

        {shown.length > 0 && (
        <div className="mem-groups">
        {groups.map((g) => (
          <section key={g} className="mem-group">
            <div className="mem-group-title">
              <span className="material-icons">category</span> {g}
            </div>
            <div className="cat-grid">
              {paged.items
                .filter((m) => groupOf(m) === g)
                .map((m) => (
                  <div className={`cat-card${m.active === false ? ' dimmed' : ''}`} key={m._id}>
                    <div className="cat-card-actions">
                      <button className="cat-card-btn" onClick={() => setEditing(m)} title="Edit">
                        <span className="material-icons">edit</span>
                      </button>
                      <button className="cat-card-btn danger" onClick={() => remove(m)} title="Delete">
                        <span className="material-icons">delete</span>
                      </button>
                    </div>
                    {m.imageUrl ? (
                      <img className="cat-card-img" src={m.imageUrl} alt="" />
                    ) : (
                      <div className="cat-card-img ph">
                        <span className="material-icons">person</span>
                      </div>
                    )}
                    <div className="cat-card-name">{m.name}</div>
                    {m.title && <div className="mem-card-sub">{m.title}</div>}
                    {v.has('fee') && !!m.fee && <div className="mem-card-fee">₹{m.fee.toLocaleString('en-IN')}</div>}
                    {m.active === false && <div className="mem-card-sub muted">Hidden</div>}
                  </div>
                ))}
            </div>
          </section>
        ))}
        </div>
        )}
        {shown.length > 0 && <Pager {...paged.pager} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full-page editor: form (left) + live preview (right)
// ---------------------------------------------------------------------------
function MemberEditor({
  api,
  vertical: v,
  member,
  categories,
  onBack,
  onSaved,
}: {
  api: CrmApi;
  vertical: VerticalConfig;
  member: Member | null;
  categories: Category[];
  onBack: () => void;
  /** `note` carries any message about absences announced by this save. */
  onSaved: (note?: string) => void;
}) {
  const editing = !!member;
  const [form, setForm] = useState<Member>({
    _id: member?._id || '',
    name: member?.name || '',
    category: member?.category || '',
    title: member?.title || '',
    phone: member?.phone || '',
    email: member?.email || '',
    description: member?.description || '',
    imageUrl: member?.imageUrl || '',
    fee: member?.fee ?? 0,
    currency: member?.currency || 'INR',
    duration: member?.duration ?? 0,
    // Seeded through scheduleOf so a member saved under the old single-window
    // shape opens with their real hours already in the per-day editor.
    schedule: scheduleOf(member || {}),
    slotCapacity: member?.slotCapacity ?? 1,
    unavailability: member?.unavailability || [],
    availableDays: member?.availableDays || [],
    availableFrom: member?.availableFrom || '',
    availableTo: member?.availableTo || '',
    experience: member?.experience ?? 0,
    qualifications: member?.qualifications || '',
    languages: member?.languages || [],
    location: member?.location || '',
    capacity: member?.capacity ?? 0,
    amenities: member?.amenities || [],
    active: member?.active ?? true,
  });
  const [image, setImage] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (p: Partial<Member>) => setForm((f) => ({ ...f, ...p }));

  // Dirty tracking → confirm before discarding.
  const snapshot = () => JSON.stringify(form) + (image ? image.name : '');
  const baseline = useRef('');
  useEffect(() => {
    baseline.current = snapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showDiscard, setShowDiscard] = useState(false);
  function handleClose() {
    if (snapshot() !== baseline.current) setShowDiscard(true);
    else onBack();
  }
  // Browser Back: closes the "Discard changes?" prompt if it's up (= keep
  // editing), otherwise behaves like the arrow.
  useBackHandler(true, () => (showDiscard ? setShowDiscard(false) : handleClose()));

  function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!f) return;
    setImage(f);
    set({ imageUrl: URL.createObjectURL(f) });
  }

  // ---- Per-day availability -------------------------------------------------
  // `form.schedule` is the source of truth once the editor is open; it's
  // seeded from the legacy single window so existing hours aren't lost.
  const schedule = scheduleOf(form);

  const writeSchedule = (next: DaySchedule[]) =>
    set({
      schedule: DAY_ORDER.filter((k) => next.some((s) => s.day === k && s.windows.length)).map(
        (k) => next.find((s) => s.day === k)!,
      ),
    });

  function toggleDay(day: string) {
    const has = schedule.some((s) => s.day === day);
    writeSchedule(
      has
        ? schedule.filter((s) => s.day !== day)
        : [...schedule, { day, windows: [{ ...NEW_WINDOW }] }],
    );
  }

  function addWindow(day: string) {
    writeSchedule(
      schedule.map((s) => {
        if (s.day !== day) return s;
        // Start the new range after the last one so a second sitting doesn't
        // land on top of the first.
        const last = s.windows[s.windows.length - 1];
        const lastEnd = toMinutes(last?.to);
        const from = lastEnd >= 0 && lastEnd < 23 * 60 ? lastEnd + 60 : toMinutes(NEW_WINDOW.from);
        const hhmm = (m: number) =>
          `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        return {
          ...s,
          windows: [...s.windows, { from: hhmm(from), to: hhmm(Math.min(from + 180, 23 * 60 + 59)) }],
        };
      }),
    );
  }

  function setWindow(day: string, idx: number, patch: Partial<TimeWindow>) {
    writeSchedule(
      schedule.map((s) =>
        s.day === day
          ? { ...s, windows: s.windows.map((w, i) => (i === idx ? { ...w, ...patch } : w)) }
          : s,
      ),
    );
  }

  function removeWindow(day: string, idx: number) {
    writeSchedule(
      schedule.map((s) =>
        s.day === day ? { ...s, windows: s.windows.filter((_, i) => i !== idx) } : s,
      ),
    );
  }

  // ---- Unavailable dates ----------------------------------------------------
  const writeBlocks = (next: Unavailability[]) => set({ unavailability: next });

  const addBlock = () =>
    writeBlocks([...(form.unavailability || []), { date: todayISO(), wholeDay: true, reason: '' }]);

  function setBlock(idx: number, patch: Partial<Unavailability>) {
    writeBlocks(
      (form.unavailability || []).map((u, i) => {
        if (i !== idx) return u;
        const merged = { ...u, ...patch };
        // Switching to a part-day block needs usable times, or the server
        // treats it as the whole day and the business wouldn't know why.
        if (patch.wholeDay === false && !merged.from && !merged.to) {
          return { ...merged, from: '14:00', to: '17:00' };
        }
        return merged;
      }),
    );
  }

  const removeBlock = (idx: number) =>
    writeBlocks((form.unavailability || []).filter((_, i) => i !== idx));

  function save() {
    if (!form.name?.trim() || saving) return;
    setSaving(true);
    setError('');
    const fd = new FormData();
    fd.append('name', form.name.trim());
    fd.append('category', form.category || '');
    fd.append('title', form.title || '');
    fd.append('description', form.description || '');
    fd.append('active', String(form.active !== false));
    fd.append('currency', form.currency || 'INR');
    if (v.has('fee')) fd.append('fee', String(form.fee || 0));
    if (v.has('duration')) fd.append('duration', String(form.duration || 0));
    if (v.has('availability')) {
      fd.append('schedule', JSON.stringify(schedule));
      fd.append('slotCapacity', String(form.slotCapacity ?? 1));
      fd.append('unavailability', JSON.stringify(form.unavailability || []));
      // The legacy pair is cleared once a per-day schedule exists, so the
      // server can't migrate stale hours back over the real ones on a re-read.
      fd.append('availableDays', JSON.stringify(schedule.length ? [] : form.availableDays || []));
      fd.append('availableFrom', schedule.length ? '' : form.availableFrom || '');
      fd.append('availableTo', schedule.length ? '' : form.availableTo || '');
    }
    if (v.has('experience')) fd.append('experience', String(form.experience || 0));
    if (v.has('qualifications')) fd.append('qualifications', form.qualifications || '');
    if (v.has('languages')) fd.append('languages', JSON.stringify(form.languages || []));
    if (v.has('location')) fd.append('location', form.location || '');
    if (v.has('capacity')) fd.append('capacity', String(form.capacity || 0));
    if (v.has('amenities')) fd.append('amenities', JSON.stringify(form.amenities || []));
    fd.append('phone', form.phone || '');
    if (v.has('email')) fd.append('email', form.email || '');
    if (image) fd.append('image', image);

    const req = editing && member ? api.updateMember(member._id, fd) : api.createMember(fd);
    req
      .then((r) => {
        // Report what the absence actually did. "Saved" alone would leave the
        // business assuming their patients were told when they may not have been.
        const notices: MemberSaveNotice[] =
          (r as { notices?: MemberSaveNotice[] }).notices || [];
        const affected = notices.reduce((n, x) => n + (x.affected || 0), 0);
        const sent = notices.reduce((n, x) => n + (x.sent || 0), 0);
        const blocked = notices.find((x) => x.reason);
        let msg = '';
        if (affected > 0 && sent > 0) msg = `${sent} of ${affected} affected patient(s) messaged.`;
        else if (affected > 0) msg = `${affected} appointment(s) affected, but nobody was messaged — ${blocked?.reason || 'no template is set up'}.`;
        else if (notices.length) msg = 'Date blocked. No appointments were affected.';
        onSaved(msg);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => setSaving(false));
  }

  return (
    <div className="page mem-editor">
      <header className="page-head">
        <button className="icon-btn" onClick={handleClose} aria-label="Back">
          <span className="material-icons">arrow_back</span>
        </button>
        <h2>{editing ? `Edit ${v.memberSingular.toLowerCase()}` : `New ${v.memberSingular.toLowerCase()}`}</h2>
        <span className="mem-vertical-chip" title={`Business type: ${v.label}`}>
          <span className="material-icons">business</span> {v.label}
        </span>
        <div className="flow-head-actions">
          <button className="k-btn ghost sm" onClick={handleClose}>Cancel</button>
          <button className="k-btn" onClick={save} disabled={!form.name?.trim() || saving}>
            <span className="material-icons">{editing ? 'save' : 'add'}</span>
            {saving ? 'Saving…' : editing ? 'Save' : `Add ${v.memberSingular.toLowerCase()}`}
          </button>
        </div>
      </header>

      {error && <p className="err flow-err">{error}</p>}

      <div className="page-body mem-editor-body">
        {/* ---------------- Left: the form ---------------- */}
        <div className="mem-form">
          <div className="mem-section">
            <div className="mem-section-title">Basics</div>
            <div className="k-field">
              <label className="k-label">Name *</label>
              <input
                className="k-input"
                autoFocus
                value={form.name || ''}
                onChange={(e) => set({ name: e.target.value })}
                placeholder={`e.g. ${v.memberExample}`}
              />
            </div>
            <div className="mem-row">
              <div className="k-field">
                <label className="k-label">{v.categoryLabel}</label>
                <select className="k-input" value={form.category || ''} onChange={(e) => set({ category: e.target.value })}>
                  <option value="">Uncategorised</option>
                  {categories.map((c) => (
                    <option key={c._id} value={c.name}>{c.name}</option>
                  ))}
                </select>
                {categories.length === 0 && (
                  <p className="k-hint">Add categories first — they group {v.memberLabel.toLowerCase()} in your flows.</p>
                )}
              </div>
              <div className="k-field">
                <label className="k-label">Role / label</label>
                <input
                  className="k-input"
                  value={form.title || ''}
                  onChange={(e) => set({ title: e.target.value })}
                  placeholder={`e.g. ${v.memberTitleExample}`}
                />
              </div>
            </div>
            <div className="k-field">
              <label className="k-label">Description</label>
              <input
                className="k-input"
                value={form.description || ''}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="Short line shown under the name"
              />
            </div>
            <div className="k-field">
              <label className="k-label">Photo</label>
              <div className="uploader">
                <label className="k-btn ghost sm file-btn">
                  <span className="material-icons">upload</span> {form.imageUrl ? 'Replace image' : 'Choose image'}
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={onImage} />
                </label>
                <p className="k-hint">Shown as a 1:1 thumbnail in WhatsApp flow lists.</p>
              </div>
            </div>
          </div>

          {(v.has('fee') || v.has('duration')) && (
            <div className="mem-section">
              <div className="mem-section-title">Pricing{v.has('duration') ? ' & slot' : ''}</div>
              <div className="mem-row">
                {v.has('fee') && (
                  <div className="k-field">
                    <label className="k-label">{v.feeLabel} (₹)</label>
                    <input
                      className="k-input"
                      type="number"
                      min={0}
                      value={form.fee || 0}
                      onChange={(e) => set({ fee: Number(e.target.value) || 0 })}
                    />
                  </div>
                )}
                {v.has('duration') && (
                  <div className="k-field">
                    <label className="k-label">Slot duration (minutes)</label>
                    <input
                      className="k-input"
                      type="number"
                      min={0}
                      step={5}
                      value={form.duration || 0}
                      onChange={(e) => set({ duration: Number(e.target.value) || 0 })}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {v.has('availability') && (
            <>
              <div className="mem-section">
                <div className="mem-section-title">Availability</div>
                <p className="k-hint">
                  Tap a day to open it, then add one time range per sitting. Two ranges on a day
                  leave the gap between them free — that&apos;s the break.
                </p>
                <div className="mem-days">
                  {DAYS.map((d) => {
                    const entry = schedule.find((s) => s.day === d.key);
                    return (
                      <button
                        key={d.key}
                        type="button"
                        className={`mem-day${entry ? ' on' : ''}`}
                        onClick={() => toggleDay(d.key)}
                        title={entry ? `${entry.windows.length} time range(s)` : 'Not working'}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>

                {schedule.length === 0 && (
                  <p className="page-note">No working days yet — tap a day above.</p>
                )}

                {schedule.map((d) => (
                  <div className="mem-day-row" key={d.day}>
                    <div className="mem-day-row-head">
                      <strong>{dayName(d.day)}</strong>
                      <span className="k-hint inline">
                        {countSlots(d.windows, form.duration || 0)} slots
                      </span>
                      <button
                        type="button"
                        className="k-btn ghost sm"
                        onClick={() => addWindow(d.day)}
                      >
                        <span className="material-icons">add</span> Add time
                      </button>
                    </div>
                    {d.windows.map((w, i) => {
                      const bad = toMinutes(w.to) <= toMinutes(w.from);
                      return (
                        <div className="mem-win" key={i}>
                          <input
                            className={`k-input${bad ? ' invalid' : ''}`}
                            type="time"
                            value={w.from}
                            onChange={(e) => setWindow(d.day, i, { from: e.target.value })}
                          />
                          <span className="mem-win-dash">to</span>
                          <input
                            className={`k-input${bad ? ' invalid' : ''}`}
                            type="time"
                            value={w.to}
                            onChange={(e) => setWindow(d.day, i, { to: e.target.value })}
                          />
                          <button
                            type="button"
                            className="icon-btn danger"
                            title="Remove this time"
                            onClick={() => removeWindow(d.day, i)}
                          >
                            <span className="material-icons">delete</span>
                          </button>
                          {bad && <span className="mem-win-warn">End must be after start</span>}
                        </div>
                      );
                    })}
                  </div>
                ))}

                <div className="mem-row">
                  <div className="k-field">
                    <label className="k-label">Patients per slot</label>
                    <input
                      className="k-input"
                      type="number"
                      min={1}
                      value={form.slotCapacity ?? 1}
                      onChange={(e) => set({ slotCapacity: Math.max(1, Number(e.target.value) || 1) })}
                    />
                    <p className="k-hint">
                      1 means a time disappears once it&apos;s booked. Raise it to let more than one
                      patient share a time.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mem-section">
                <div className="mem-section-title">Unavailable dates</div>
                <p className="k-hint">
                  Block a date entirely or just part of it. Those times stop being offered, and
                  anyone already booked is messaged — if you have an approved template with the
                  &quot;{v.memberSingular} unavailable&quot; trigger switched on.
                </p>
                {(form.unavailability || []).length === 0 && (
                  <p className="page-note">Nothing blocked. {v.memberSingular} is available as per the hours above.</p>
                )}
                {(form.unavailability || []).map((u, i) => (
                  <div className="mem-unav" key={i}>
                    <div className="mem-unav-row">
                      <input
                        className="k-input"
                        type="date"
                        value={u.date}
                        onChange={(e) => setBlock(i, { date: e.target.value })}
                      />
                      <label className="k-check">
                        <input
                          type="checkbox"
                          checked={u.wholeDay !== false}
                          onChange={(e) => setBlock(i, { wholeDay: e.target.checked })}
                        />
                        Whole day
                      </label>
                      {u.wholeDay === false && (
                        <>
                          <input
                            className="k-input"
                            type="time"
                            value={u.from || ''}
                            onChange={(e) => setBlock(i, { from: e.target.value })}
                          />
                          <span className="mem-win-dash">to</span>
                          <input
                            className="k-input"
                            type="time"
                            value={u.to || ''}
                            onChange={(e) => setBlock(i, { to: e.target.value })}
                          />
                        </>
                      )}
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Remove"
                        onClick={() => removeBlock(i)}
                      >
                        <span className="material-icons">delete</span>
                      </button>
                    </div>
                    <input
                      className="k-input"
                      value={u.reason || ''}
                      placeholder="Reason (shown in the message, optional)"
                      onChange={(e) => setBlock(i, { reason: e.target.value })}
                    />
                    {u.notifiedAt && (
                      <span className="k-hint inline">
                        Patients already notified — editing this won&apos;t message them again.
                      </span>
                    )}
                  </div>
                ))}
                <button type="button" className="k-btn ghost sm" onClick={addBlock}>
                  <span className="material-icons">event_busy</span> Mark a date unavailable
                </button>
              </div>
            </>
          )}

          <div className="mem-section">
            <div className="mem-section-title">Contact & details</div>
            <div className="mem-row">
              <div className="k-field">
                <label className="k-label">Phone</label>
                <input className="k-input" value={form.phone || ''} onChange={(e) => set({ phone: e.target.value })} placeholder="+91 98765 43210" />
              </div>
              {v.has('email') && (
                <div className="k-field">
                  <label className="k-label">Email</label>
                  <input className="k-input" value={form.email || ''} onChange={(e) => set({ email: e.target.value })} placeholder="name@example.com" />
                </div>
              )}
            </div>
            <div className="mem-row">
              {v.has('experience') && (
                <div className="k-field">
                  <label className="k-label">Experience (years)</label>
                  <input className="k-input" type="number" min={0} value={form.experience || 0} onChange={(e) => set({ experience: Number(e.target.value) || 0 })} />
                </div>
              )}
              {v.has('capacity') && (
                <div className="k-field">
                  <label className="k-label">Capacity / occupancy</label>
                  <input className="k-input" type="number" min={0} value={form.capacity || 0} onChange={(e) => set({ capacity: Number(e.target.value) || 0 })} />
                </div>
              )}
              {v.has('location') && (
                <div className="k-field">
                  <label className="k-label">Branch / location</label>
                  <input className="k-input" value={form.location || ''} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Banjara Hills" />
                </div>
              )}
            </div>
            {v.has('qualifications') && (
              <div className="k-field">
                <label className="k-label">Qualifications</label>
                <input className="k-input" value={form.qualifications || ''} onChange={(e) => set({ qualifications: e.target.value })} placeholder={`e.g. ${v.qualificationsExample}`} />
              </div>
            )}
            {v.has('languages') && (
              <div className="k-field">
                <label className="k-label">Languages</label>
                <ListInput
                  value={form.languages || []}
                  onChange={(languages) => set({ languages })}
                  placeholder="English, Hindi, Telugu"
                />
                <p className="k-hint">Comma separated.</p>
              </div>
            )}
            {v.has('amenities') && (
              <div className="k-field">
                <label className="k-label">Amenities</label>
                <ListInput
                  value={form.amenities || []}
                  onChange={(amenities) => set({ amenities })}
                  placeholder="AC, WiFi, Breakfast, Parking"
                />
                <p className="k-hint">Comma separated.</p>
              </div>
            )}
            <label className="mem-check">
              <input type="checkbox" checked={form.active !== false} onChange={(e) => set({ active: e.target.checked })} />
              Visible in flows
              <span className="k-hint inline">Uncheck to hide temporarily (e.g. on leave) without deleting.</span>
            </label>
          </div>
        </div>

        {/* ---------------- Right: live preview ---------------- */}
        <div className="mem-preview-col">
          <MemberPreview form={form} vertical={v} />
        </div>
      </div>

      {showDiscard && (
        <div className="disc-backdrop" onClick={() => setShowDiscard(false)}>
          <div className="disc-box" onClick={(e) => e.stopPropagation()}>
            <div className="disc-title">Discard changes?</div>
            <div className="disc-actions">
              <button className="disc-cancel" onClick={() => setShowDiscard(false)}>Cancel</button>
              <button className="disc-discard" onClick={onBack}>Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Live preview: a profile card plus the exact row the customer sees inside a
// WhatsApp flow list (mirrors the backend's buildMembers row format).
function MemberPreview({ form, vertical: v }: { form: Member; vertical: VerticalConfig }) {
  const fee = v.has('fee') && Number(form.fee) > 0 ? `₹${Number(form.fee).toLocaleString('en-IN')}` : '';
  const mins = v.has('duration') && Number(form.duration) > 0 ? `${form.duration} min` : '';
  const rowDesc = useMemo(
    () => [form.title, fee, mins].filter(Boolean).join(' · ') || form.description || '',
    [form.title, fee, mins, form.description],
  );
  // One line per working day, so "Mon 10:00 am–1:00 pm, 5:00 pm–8:00 pm"
  // reads back the break the business actually configured.
  const sched = scheduleOf(form);
  const dayLines = sched.map(
    (d) => `${dayName(d.day)} ${d.windows.map((w) => `${to12h(w.from)}–${to12h(w.to)}`).join(', ')}`,
  );
  const totalSlots = sched.reduce((n, d) => n + countSlots(d.windows, form.duration || 0), 0);
  const blocked = (form.unavailability || []).length;

  return (
    <div className="mem-preview">
      <div className="mem-preview-label">Preview</div>

      {/* Profile card */}
      <div className="mem-pcard">
        {form.imageUrl ? (
          <img className="mem-pcard-img" src={form.imageUrl} alt="" />
        ) : (
          <div className="mem-pcard-img ph">
            <span className="material-icons">person</span>
          </div>
        )}
        <div className="mem-pcard-name">{form.name || `New ${v.memberSingular.toLowerCase()}`}</div>
        {form.title && <div className="mem-pcard-title">{form.title}</div>}
        {form.category && (
          <div className="mem-pcard-chip">
            <span className="material-icons">category</span> {form.category}
          </div>
        )}
        {fee && (
          <div className="mem-pcard-fee">
            {fee} <span>{v.feeLabel.toLowerCase()}</span>
          </div>
        )}
        <div className="mem-pcard-rows">
          {form.description && <div className="mem-pcard-row">{form.description}</div>}
          {v.has('qualifications') && form.qualifications && (
            <div className="mem-pcard-row"><span className="material-icons">school</span>{form.qualifications}</div>
          )}
          {v.has('experience') && !!form.experience && (
            <div className="mem-pcard-row"><span className="material-icons">workspace_premium</span>{form.experience} years experience</div>
          )}
          {v.has('capacity') && !!form.capacity && (
            <div className="mem-pcard-row"><span className="material-icons">group</span>Up to {form.capacity} guests</div>
          )}
          {mins && <div className="mem-pcard-row"><span className="material-icons">schedule</span>{mins} per slot</div>}
          {v.has('availability') && dayLines.map((line) => (
            <div className="mem-pcard-row" key={line}>
              <span className="material-icons">event_available</span>
              {line}
            </div>
          ))}
          {v.has('availability') && totalSlots > 0 && (
            <div className="mem-pcard-row">
              <span className="material-icons">confirmation_number</span>
              {totalSlots} slots a week
              {(form.slotCapacity ?? 1) > 1 ? ` · ${form.slotCapacity} per slot` : ''}
            </div>
          )}
          {v.has('availability') && blocked > 0 && (
            <div className="mem-pcard-row">
              <span className="material-icons">event_busy</span>
              {blocked} date{blocked > 1 ? 's' : ''} blocked
            </div>
          )}
          {v.has('location') && form.location && (
            <div className="mem-pcard-row"><span className="material-icons">place</span>{form.location}</div>
          )}
          {form.phone && <div className="mem-pcard-row"><span className="material-icons">call</span>{form.phone}</div>}
          {v.has('email') && form.email && (
            <div className="mem-pcard-row"><span className="material-icons">mail</span>{form.email}</div>
          )}
          {v.has('languages') && (form.languages || []).length > 0 && (
            <div className="mem-pcard-row"><span className="material-icons">translate</span>{(form.languages || []).join(', ')}</div>
          )}
          {v.has('amenities') && (form.amenities || []).length > 0 && (
            <div className="mem-pcard-tags">
              {(form.amenities || []).map((a) => (
                <span className="mem-tag" key={a}>{a}</span>
              ))}
            </div>
          )}
        </div>
        {form.active === false && <div className="mem-pcard-hidden">Hidden from flows</div>}
      </div>

      {/* How it appears inside a WhatsApp flow list */}
      <div className="mem-preview-label sub">In a WhatsApp flow list</div>
      <div className="mem-flowrow">
        {form.imageUrl ? (
          <img className="mem-flowrow-img" src={form.imageUrl} alt="" />
        ) : (
          <div className="mem-flowrow-img ph">
            <span className="material-icons">person</span>
          </div>
        )}
        <div className="mem-flowrow-text">
          <div className="mem-flowrow-title">{form.name || `New ${v.memberSingular.toLowerCase()}`}</div>
          {rowDesc && <div className="mem-flowrow-desc">{rowDesc}</div>}
        </div>
        <span className="mem-flowrow-radio" />
      </div>
      <p className="mem-preview-hint">
        This is the row a customer taps when a flow screen uses a <strong>Members list</strong>.
      </p>
    </div>
  );
}
