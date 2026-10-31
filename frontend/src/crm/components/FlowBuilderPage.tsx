// Native WhatsApp Flow builder. Build multi-screen Flow JSON forms (8:1 banner,
// headings, radio lists, inputs, a footer button that completes or navigates to
// another screen), preview them as a WhatsApp phone card, then publish /
// republish to Meta using the tenant's own WhatsApp credentials.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlowProvider,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type Connection,
  type NodeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { CrmApi } from '../api';
import type {
  FlowBlock,
  FlowBlockKind,
  FlowBlockHeader,
  FlowLink,
  FlowComponent,
  FlowComponentType,
  FlowInputType,
  FlowOption,
  FlowScreen,
  PdfElement,
  PdfTemplate,
  WaFlowDef,
  FlowTemplate,
} from '../types';
import { buildFlowJson, incomingDataKeys, isEndpointMode } from '../flowJson';
import { Dropdown, type KOption } from './Dropdown';
import { MediaCtx, useMedia, useMediaApi } from './uploadCtx';
import { PdfDesigner, confirmPdfTemplate, PDF_A4 } from './PdfDesigner';
import { FlowMessageFields, FlowMessageModal, flowMessageOf, type FlowMessage } from './FlowMessageEditor';
import { verticalConfig, type ConfirmWording, type VerticalConfig } from '../verticals';
import { useConfirm, useFlash, useNotify } from './Dialogs';
import { useBackHandler } from '../useBackHandler';
import { BladeSpinner } from './BladeSpinner';

// Sample categories shown in the preview for a dynamic "Category list" block.
// At runtime the backend endpoint serves the business's real categories (1:1).
const PREVIEW_CATEGORIES = [
  { id: 'starters', title: 'Starters', description: 'Begin your meal', image: 'https://picsum.photos/id/292/80/80' },
  { id: 'mains', title: 'Main Course', description: 'Hearty mains', image: 'https://picsum.photos/id/1080/80/80' },
  { id: 'desserts', title: 'Desserts', description: 'Sweet endings', image: 'https://picsum.photos/id/431/80/80' },
];
// Sample members shown in the preview for a dynamic "Members list" block. At
// runtime the endpoint serves the business's real members, narrowed to the
// category the customer picked on an earlier screen.
const PREVIEW_MEMBERS = [
  { id: 'mem_1', title: 'Dr. Asha Rao', description: 'Cardiologist · 12 years experience', image: 'https://picsum.photos/id/1027/80/80' },
  { id: 'mem_2', title: 'Dr. Vikram Shah', description: 'Interventional Cardiologist', image: 'https://picsum.photos/id/1012/80/80' },
  { id: 'mem_3', title: 'Dr. Meera Nair', description: 'Dermatologist · 7 years experience', image: 'https://picsum.photos/id/1011/80/80' },
];
// Sample open orders for the "Cancel order" picker. At runtime only orders the
// customer can still act on are listed (never delivered or cancelled ones).
// Sample times for a "Slot list". At runtime these are the chosen member's
// real free slots on the chosen date — their working windows for that weekday,
// minus anything booked and minus any absence.
const PREVIEW_SLOTS = [
  { id: 'slot_10:00', title: '10:00 am', description: '', image: '' },
  { id: 'slot_10:30', title: '10:30 am', description: '', image: '' },
  { id: 'slot_11:00', title: '11:00 am', description: '', image: '' },
  { id: 'slot_17:00', title: '5:00 pm', description: '', image: '' },
];
// Sample bookings for the "Reschedule" picker. At runtime these are the
// sender's own upcoming appointments.
const PREVIEW_APPOINTMENTS = [
  { id: 'appt_1', title: 'Dr. Asha Rao · 10:30 am', description: '18 Oct 2026 · Cardiology', image: '' },
  { id: 'appt_2', title: 'Dr. Vikram Shah · 5:00 pm', description: '21 Oct 2026 · Cardiology', image: '' },
];
const PREVIEW_ACTIVE_ORDERS = [
  { id: 'ord_1', title: 'DVN-B2C-1AA1F8 - Rs.1', description: 'Confirmed - 17/8/2026', image: '' },
  { id: 'ord_2', title: 'DVN-B2C-5AD64C - Rs.1', description: 'Confirmed - 16/8/2026', image: '' },
  { id: 'ord_3', title: 'DVN-B2C-C86B49 - Rs.189', description: 'Preparing - 15/8/2026', image: '' },
];
// Sample orders shown in the preview for a dynamic "Order list" block.
const PREVIEW_ORDERS = [
  { id: 'ord_1042', title: 'ORD-1042 — ₹500', description: 'Out for delivery', image: '' },
  { id: 'ord_1041', title: 'ORD-1041 — ₹360', description: 'Delivered', image: '' },
  { id: 'ord_1040', title: 'ORD-1040 — ₹75', description: 'Pending', image: '' },
];

interface Props {
  api: CrmApi;
  /**
   * Register an "are there unsaved changes?" probe with the shell, so leaving
   * the page mid-edit asks before throwing the work away. Same contract the
   * journey canvas uses.
   */
  registerDirty?: (fn: (() => boolean) | null) => void;
  /** Supplies the confirmation wording for the tenant's business type. */
  vertical?: VerticalConfig;
}

// Dynamic list sources served by the flow endpoint at runtime.
type DynSource = 'categories' | 'members' | 'orders' | 'active_orders' | 'slots' | 'appointments';

let cidSeq = 1;
const newCid = () => `k${cidSeq++}`;

// The field name the runtime treats as "how the customer wants to pay".
const PAYMENT_METHOD_FIELD = 'payment_method';

// The "Register" chip inserts a ready-made sign-up form in one click. These are
// ordinary components once added, so they can be reordered, edited or removed
// individually. The WhatsApp number is prefilled from the sender and locked.
const REGISTER_FIELDS: {
  type: FlowComponentType;
  name: string;
  label: string;
  inputType?: FlowInputType;
  required?: boolean;
  prefill?: 'phone';
  locked?: boolean;
  helperText?: string;
}[] = [
  { type: 'TextInput', name: 'name', label: 'Name', inputType: 'text', required: true },
  { type: 'TextInput', name: 'business_name', label: 'Business name', inputType: 'text' },
  {
    type: 'TextInput',
    name: 'whatsapp_number',
    label: 'WhatsApp number',
    inputType: 'phone',
    required: true,
    prefill: 'phone',
    locked: true,
    helperText: 'Auto-filled from your WhatsApp account',
  },
  { type: 'TextInput', name: 'email', label: 'Email', inputType: 'email' },
  { type: 'DatePicker', name: 'preferred_date', label: 'Preferred date', required: true },
];

const PALETTE: {
  type: FlowComponentType;
  icon: string;
  label: string;
  source?: DynSource;
  group?: 'register' | 'cancel' | 'paymethod' | 'booking' | 'reschedule';
}[] = [
  { type: 'TextInput', icon: 'how_to_reg', label: 'Register', group: 'register' },
  { type: 'TextInput', icon: 'event_available', label: 'Book appointment', group: 'booking' },
  { type: 'RadioButtonsGroup', icon: 'event_repeat', label: 'Reschedule', group: 'reschedule' },
  { type: 'RadioButtonsGroup', icon: 'cancel', label: 'Cancel order', group: 'cancel' },
  { type: 'RadioButtonsGroup', icon: 'payments', label: 'Payment method', group: 'paymethod' },
  { type: 'Image', icon: 'panorama', label: 'Banner image (8:1)' },
  { type: 'TextHeading', icon: 'title', label: 'Heading' },
  { type: 'TextSubheading', icon: 'subtitles', label: 'Subheading' },
  { type: 'TextBody', icon: 'notes', label: 'Body text' },
  { type: 'TextCaption', icon: 'short_text', label: 'Caption' },
  { type: 'RadioButtonsGroup', icon: 'radio_button_checked', label: 'Radio list' },
  { type: 'CheckboxGroup', icon: 'check_box', label: 'Checkbox list' },
  { type: 'RadioButtonsGroup', icon: 'category', label: 'Category list', source: 'categories' },
  { type: 'RadioButtonsGroup', icon: 'groups', label: 'Members list', source: 'members' },
  { type: 'RadioButtonsGroup', icon: 'receipt_long', label: 'Order list', source: 'orders' },
  { type: 'RadioButtonsGroup', icon: 'event_busy', label: 'Open orders', source: 'active_orders' },
  { type: 'Dropdown', icon: 'schedule', label: 'Slot list', source: 'slots' },
  { type: 'RadioButtonsGroup', icon: 'event_repeat', label: 'My appointments', source: 'appointments' },
  { type: 'Dropdown', icon: 'arrow_drop_down_circle', label: 'Dropdown' },
  { type: 'TextInput', icon: 'text_fields', label: 'Text input' },
  { type: 'TextArea', icon: 'wrap_text', label: 'Text area' },
  { type: 'DatePicker', icon: 'event', label: 'Date picker' },
  { type: 'PhotoPicker', icon: 'photo_camera', label: 'Camera / photo' },
  { type: 'DocumentPicker', icon: 'upload_file', label: 'Upload document' },
];

const PHOTO_SOURCES: KOption[] = [
  { value: 'camera_gallery', label: 'Camera & gallery' },
  { value: 'camera', label: 'Camera only' },
  { value: 'gallery', label: 'Gallery only' },
];

const INPUT_TYPES: KOption[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'password', label: 'Password' },
  { value: 'passcode', label: 'Passcode' },
];

const SELECTION = new Set<FlowComponentType>(['RadioButtonsGroup', 'CheckboxGroup', 'Dropdown']);
const TEXTY = new Set<FlowComponentType>(['TextHeading', 'TextSubheading', 'TextBody', 'TextCaption']);
const PICKERS = new Set<FlowComponentType>(['PhotoPicker', 'DocumentPicker']);
const FIELDY = new Set<FlowComponentType>([
  'RadioButtonsGroup', 'CheckboxGroup', 'Dropdown', 'TextInput', 'TextArea', 'DatePicker', 'PhotoPicker', 'DocumentPicker',
]);

function defaultComponent(type: FlowComponentType, source?: DynSource): FlowComponent {
  const base: FlowComponent = { cid: newCid(), type };
  if (TEXTY.has(type)) base.text = type === 'TextHeading' ? 'Heading text' : 'Some text';
  if (type === 'Image') base.src = '';
  if (FIELDY.has(type)) {
    base.name = `field_${cidSeq}`;
    base.label = SELECTION.has(type) ? 'Choose one' : 'Your answer';
    base.required = true;
  }
  if (type === 'TextInput') base.inputType = 'text';
  if (type === 'PhotoPicker') {
    base.label = 'Upload photo';
    base.photoSource = 'camera_gallery';
    base.maxFiles = 1;
  }
  if (type === 'DocumentPicker') {
    base.label = 'Upload document';
    base.maxFiles = 1;
  }
  if (SELECTION.has(type)) {
    if (source === 'categories') {
      base.source = 'categories';
      base.name = 'selected_category';
      base.label = 'Categories';
      base.options = [];
    } else if (source === 'members') {
      base.source = 'members';
      base.name = 'selected_member';
      base.label = 'Choose a member';
      base.options = [];
    } else if (source === 'active_orders') {
      base.source = 'active_orders';
      // `cancel_order` is the name the runtime treats as "cancel this order".
      base.name = 'cancel_order';
      base.label = 'Your orders';
      base.options = [];
    } else if (source === 'orders') {
      base.source = 'orders';
      base.name = 'selected_order';
      base.label = 'Your orders';
      base.options = [];
    } else if (source === 'slots') {
      base.source = 'slots';
      // `selected_slot` is the name the booking is recorded under.
      base.name = 'selected_slot';
      base.label = 'Available times';
      base.options = [];
    } else if (source === 'appointments') {
      base.source = 'appointments';
      // `reschedule_appointment` is the name the runtime treats as "move this
      // booking" — the answer carries the appointment id, and the doctor for
      // the slot list is read from it.
      base.name = 'reschedule_appointment';
      base.label = 'Your appointments';
      base.options = [];
    } else {
      base.source = 'static';
      base.options = [
        { id: 'opt_1', title: 'Option 1', description: '' },
        { id: 'opt_2', title: 'Option 2', description: '' },
      ];
    }
  }
  return base;
}

// Saved map layouts are only trustworthy if every coordinate is a real number
// in a sane range — a NaN or a wild value would place a node off-canvas and the
// map would look empty. Anything suspect is dropped so the node falls back to
// its default spot.
const POS_LIMIT = 20000;
function sanitizePositions(
  raw?: Record<string, { x: number; y: number }> | null,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const [id, p] of Object.entries(raw || {})) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (Math.abs(x) > POS_LIMIT || Math.abs(y) > POS_LIMIT) continue;
    out[id] = { x: Math.round(x), y: Math.round(y) };
  }
  return out;
}

// Meta's Flow JSON validator only accepts letters and underscores in a screen
// id — a digit anywhere in it fails the publish. Digits are spelled out rather
// than dropped, so "SCREEN 2" and "SCREEN 3" stay distinct.
const DIGIT_WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const slugScreenId = (s: string) =>
  s
    .toUpperCase()
    .replace(/\d/g, (d) => `_${DIGIT_WORDS[Number(d)]}_`)
    .replace(/[^A-Z_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '') || 'SCREEN';

/** `base` with a letter suffix (…_B, …_C) until it's free. */
function freeScreenId(taken: Set<string>, base: string) {
  if (!taken.has(base)) return base;
  const letters = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; ; i++) {
    const suffix = letters[i % letters.length].repeat(Math.floor(i / letters.length) + 1);
    const id = `${base.slice(0, 39 - suffix.length)}_${suffix}`;
    if (!taken.has(id)) return id;
  }
}

export function FlowBuilderPage({ api, registerDirty, vertical }: Props) {
  const v = vertical || verticalConfig('other');
  const [flows, setFlows] = useState<WaFlowDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<WaFlowDef | null | 'new'>(null);
  // Flow whose chat message (attachment / text / footer / button) is being edited.
  const [messaging, setMessaging] = useState<WaFlowDef | null>(null);
  // The flow being saved as a shared template, if any.
  const [savingTpl, setSavingTpl] = useState<WaFlowDef | null>(null);
  // Whether the template library browser is open.
  const [browsing, setBrowsing] = useState(false);
  // Whether native Flows drive conversations for this tenant (vs journeys).
  const [flowsActive, setFlowsActive] = useState(false);
  const [togglingFlows, setTogglingFlows] = useState(false);
  const flash = useFlash();
  const confirm = useConfirm();

  function load() {
    setLoading(true);
    api
      .listFlows()
      .then((r) => {
        setFlows(r.data || []);
        setFlowsActive(!!r.flowsActive);
      })
      .catch(() => setFlows([]))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove(f: WaFlowDef) {
    const ok = await confirm({
      title: 'Delete flow?',
      message: `“${f.name}” will be deleted. Customers can no longer open it, and anything that sends it will stop.`,
      confirmLabel: 'Delete flow',
    });
    if (!ok) return;
    try {
      await api.deleteFlowDef(f._id);
      setFlows((l) => l.filter((x) => x._id !== f._id));
      flash(`Flow deleted. “${f.name}” was removed.`);
    } catch (e) {
      flash(`Delete failed. ${e instanceof Error ? e.message : 'Could not delete the flow.'}`, 'error');
    }
  }
  // Switch native Flows on (they drive conversations) or off (journeys do).
  // One tenant-level switch, reflected optimistically.
  function toggleFlows(active: boolean) {
    setFlowsActive(active);
    setTogglingFlows(true);
    api.setFlowsActive(active)
      .then(() => flash(active
        ? 'Flows are on — your published flow now drives conversations.'
        : 'Flows are off — your journeys will handle conversations.'))
      .catch(() => { flash('Could not change the setting. Please try again.', 'error'); setFlowsActive(!active); })
      .finally(() => setTogglingFlows(false));
  }

  if (editing) {
    return (
      <FlowEditor
        api={api}
        flow={editing === 'new' ? null : editing}
        onBack={() => setEditing(null)}
        registerDirty={registerDirty}
        vertical={v}
        onSaved={(msg) => {
          flash(msg);
          load();
        }}
      />
    );
  }

  return (
    <div className="flow-list-wrap">
      <div className="flow-list-head">
        {/* The one switch that decides whether Flows or Journeys drive inbound
            conversations for this business. Sits ahead of the other actions. */}
        <label
          className="flow-switch head"
          title={flowsActive ? 'Flows are on — they drive conversations' : 'Flows are off — journeys drive conversations'}
        >
          <input
            type="checkbox"
            checked={flowsActive}
            disabled={togglingFlows}
            onChange={(e) => toggleFlows(e.target.checked)}
          />
          <span className="flow-switch-track"><span className="flow-switch-thumb" /></span>
          <span className="flow-switch-label">Flows {flowsActive ? 'on' : 'off'}</span>
        </label>
        {/* Start from a shared blueprint instead of a blank canvas. The library
            only shows templates for this business type. */}
        <button className="k-btn ghost sm" onClick={() => setBrowsing(true)}>
          <span className="material-icons">dashboard_customize</span> Templates
        </button>
        <button className="k-btn sm flow-new-btn" onClick={() => setEditing('new')}>
          <span className="material-icons">add</span> New flow
        </button>
      </div>
      {loading && <BladeSpinner center={true} containerHeight={200} />}
      {!loading && flows.length === 0 && (
        <div className="page-note">No flows yet. Create one and publish it to Meta.</div>
      )}
      {!loading && flows.length > 0 && (
        <div className={`flow-driver-note${flowsActive ? ' on' : ''}`}>
          <span className="material-icons">{flowsActive ? 'bolt' : 'hub'}</span>
          {flowsActive
            ? 'Flows are on, so your published flow drives inbound conversations. Turn “Flows” off to hand back to Journeys.'
            : 'Flows are off, so your Journeys handle inbound conversations. Turn “Flows” on to let your published flow take over.'}
        </div>
      )}
      <div className="flow-cards">
        {flows.map((f) => (
          <div className="flow-card" key={f._id}>
            <div className="flow-card-top">
              <span className="material-icons flow-card-ic">account_tree</span>
              <span className={`flow-status ${f.status === 'PUBLISHED' ? 'pub' : 'draft'}`}>
                {f.status === 'PUBLISHED' ? 'Published' : 'Draft'}
              </span>
            </div>
            <div className="flow-card-name">{f.name}</div>
            <div className="flow-card-meta">
              {f.screens.length} screen{f.screens.length === 1 ? '' : 's'}
              {f.metaFlowId ? ` · ${f.metaFlowId}` : ''}
            </div>
            {/* What the customer actually receives in chat. */}
            <div className="flow-card-msg">
              <span className="material-icons">
                {f.msgHeader && f.msgHeader !== 'none'
                  ? f.msgHeader === 'image' ? 'image' : f.msgHeader === 'video' ? 'videocam' : 'picture_as_pdf'
                  : 'chat_bubble_outline'}
              </span>
              <span className="flow-card-msg-text">{f.msgBody || 'No message text yet'}</span>
              <span className="flow-card-msg-cta">{f.cta || 'Open'}</span>
            </div>
            <div className="flow-card-actions">
              <button className="prod-act" onClick={() => setMessaging(f)} title="Chat message (attachment, text, button)">
                <span className="material-icons">add_photo_alternate</span>
              </button>
              <button className="prod-act" onClick={() => setEditing(f)} title="Edit screens">
                <span className="material-icons">edit</span>
              </button>
              <button className="prod-act" onClick={() => setSavingTpl(f)} title="Save as a reusable template">
                <span className="material-icons">bookmark_add</span>
              </button>
              <button className="prod-act danger" onClick={() => remove(f)} title="Delete">
                <span className="material-icons">delete</span>
              </button>
            </div>
          </div>
        ))}
      </div>
      {messaging && (
        <FlowMessageModal
          api={api}
          flow={messaging}
          onClose={() => setMessaging(null)}
          onSaved={(updated) => {
            setMessaging(null);
            setFlows((l) => l.map((x) => (x._id === updated._id ? { ...x, ...updated } : x)));
            flash('Chat message saved.');
          }}
        />
      )}
      {savingTpl && (
        <SaveTemplateModal
          api={api}
          flow={savingTpl}
          onClose={() => setSavingTpl(null)}
          onSaved={(name) => {
            setSavingTpl(null);
            flash(`Saved “${name}” to the template library.`);
          }}
        />
      )}
      {browsing && (
        <TemplatesModal
          api={api}
          vertical={v}
          onClose={() => setBrowsing(false)}
          onUsed={(flow) => {
            setBrowsing(false);
            flash(`Created “${flow.name}” from a template.`);
            load();
            setEditing(flow);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save-as-template dialog — name + what it's for, then it joins the shared
// library for other businesses of the same type.
// ---------------------------------------------------------------------------
function SaveTemplateModal({
  api, flow, onClose, onSaved,
}: {
  api: CrmApi;
  flow: WaFlowDef;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(flow.name || '');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useBackHandler(true, onClose);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.saveFlowTemplate({ flowId: flow._id, name: name.trim(), description: description.trim() });
      onSaved(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save template');
      setSaving(false);
    }
  }

  return (
    <div className="disc-backdrop tpl-backdrop" onClick={onClose}>
      <div className="disc-box tpl-box" onClick={(e) => e.stopPropagation()}>
        <div className="disc-title">Save as template</div>
        <p className="tpl-sub">
          Saves this flow&apos;s screens so other businesses like yours can start from it. No
          customer data or WhatsApp credentials are included.
        </p>
        <label className="tpl-field">
          <span>Template name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Appointment booking" autoFocus />
        </label>
        <label className="tpl-field">
          <span>What it&apos;s for</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="A short note so others know when to use it, e.g. “Book, pick a doctor and a time, then pay the consultation fee.”"
          />
        </label>
        {error && <div className="pa-error">{error}</div>}
        <div className="disc-actions">
          <button className="disc-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="k-btn sm" onClick={save} disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template library — blueprints for this business type, with "Use" to start a
// new flow from one.
// ---------------------------------------------------------------------------
function TemplatesModal({
  api, vertical, onClose, onUsed,
}: {
  api: CrmApi;
  vertical: VerticalConfig;
  onClose: () => void;
  onUsed: (flow: WaFlowDef) => void;
}) {
  const [items, setItems] = useState<FlowTemplate[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const confirm = useConfirm();
  useBackHandler(true, onClose);
  const notify = useNotify();

  useEffect(() => {
    api.listFlowTemplates()
      .then((r) => setItems(r.data || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load templates'));
  }, [api]);

  async function use(t: FlowTemplate) {
    setBusyId(t._id);
    setError('');
    try {
      const r = await api.useFlowTemplate(t._id);
      onUsed(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not use template');
      setBusyId('');
    }
  }
  async function remove(t: FlowTemplate) {
    const ok = await confirm({
      title: 'Delete flow template?',
      message: `“${t.name}” will be removed from the library. Other businesses will no longer see it. Flows already made from it are not affected.`,
      confirmLabel: 'Delete template',
    });
    if (!ok) return;
    setBusyId(t._id);
    try {
      await api.deleteFlowTemplate(t._id);
      setItems((l) => (l || []).filter((x) => x._id !== t._id));
      notify('success', 'Template deleted', `“${t.name}” was removed from the library.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete template');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="disc-backdrop tpl-backdrop" onClick={onClose}>
      <div className="disc-box tpl-box lg" onClick={(e) => e.stopPropagation()}>
        <div className="tpl-head">
          <div className="disc-title">Templates for {vertical.archetypeLabel.toLowerCase()}</div>
          <button className="prod-act" onClick={onClose} title="Close"><span className="material-icons">close</span></button>
        </div>
        <p className="tpl-sub">
          Blueprints shared by businesses like yours. “Use” creates a new draft flow you can edit and
          publish with your own WhatsApp account.
        </p>
        {error && <div className="pa-error">{error}</div>}
        {!items && <BladeSpinner center={true} containerHeight={180} />}
        {items && items.length === 0 && (
          <div className="page-note">
            No templates for your business type yet. Build a flow and use “Save as template” to add one.
          </div>
        )}
        {items && items.length > 0 && (
          <div className="tpl-list">
            {items.map((t) => (
              <div className="tpl-item" key={t._id}>
                <div className="tpl-item-main">
                  <div className="tpl-item-name">{t.name}</div>
                  {t.description && <div className="tpl-item-desc">{t.description}</div>}
                  <div className="tpl-item-meta">
                    {(t.screens?.length ?? 0)} screen{(t.screens?.length ?? 0) === 1 ? '' : 's'}
                    {t.createdByName ? ` · by ${t.createdByName}` : ''}
                    {t.usedCount ? ` · used ${t.usedCount}×` : ''}
                  </div>
                </div>
                <div className="tpl-item-actions">
                  <button className="k-btn sm" onClick={() => use(t)} disabled={!!busyId}>
                    {busyId === t._id ? 'Working…' : 'Use'}
                  </button>
                  <button className="prod-act danger" onClick={() => remove(t)} disabled={!!busyId} title="Delete (only ones you saved)">
                    <span className="material-icons">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full-page editor
// ---------------------------------------------------------------------------
function FlowEditor({
  api,
  flow,
  onBack,
  onSaved,
  registerDirty,
  vertical: verticalProp,
}: {
  api: CrmApi;
  flow: WaFlowDef | null;
  onBack: () => void;
  onSaved: (msg: string) => void;
  registerDirty?: (fn: (() => boolean) | null) => void;
  vertical?: VerticalConfig;
}) {
  const vertical = verticalProp || verticalConfig('other');
  const editing = !!flow;
  const [name, setName] = useState(flow?.name || 'My Flow');
  // The chat message that opens this flow (attachment, text, footer, button).
  const [msg, setMsg] = useState<FlowMessage>(() => flowMessageOf(flow));
  const [screens, setScreens] = useState<FlowScreen[]>(() => {
    const seed: FlowScreen[] = flow?.screens?.length
      ? JSON.parse(JSON.stringify(flow.screens))
      : [
          {
            id: 'WELCOME',
            title: 'Welcome',
            components: [
              defaultComponent('TextHeading'),
              { cid: newCid(), type: 'Footer', buttonLabel: 'Continue', action: 'complete' },
            ],
          },
        ];
    // Reassign fresh, unique cids on load. Older saved flows can contain
    // duplicate cids (cidSeq used to reset per page load), which makes React
    // reuse the wrong component instances when switching/adding screens.
    for (const s of seed) for (const c of s.components || []) c.cid = newCid();
    return seed;
  });
  const [blocks, setBlocks] = useState<FlowBlock[]>(
    flow?.blocks?.length ? JSON.parse(JSON.stringify(flow.blocks)) : [],
  );
  const [flowLinks, setFlowLinks] = useState<FlowLink[]>(
    flow?.flowLinks?.length ? JSON.parse(JSON.stringify(flow.flowLinks)) : [],
  );
  const [entryTarget, setEntryTarget] = useState<string>(flow?.entryTarget || '');
  const [activeScreen, setActiveScreen] = useState(0);
  const [savedId, setSavedId] = useState(flow?._id || '');
  const [metaFlowId, setMetaFlowId] = useState(flow?.metaFlowId || '');
  const [status, setStatus] = useState(flow?.status || 'DRAFT');
  const [busy, setBusy] = useState<'' | 'save' | 'publish'>('');
  const [error, setError] = useState('');
  // Meta's validation messages from the last publish attempt.
  const [issues, setIssues] = useState<string[]>([]);
  const [showJson, setShowJson] = useState(false);
  const [view, setView] = useState<'build' | 'map'>('build');
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() =>
    sanitizePositions(flow?.positions),
  );
  const [otherFlows, setOtherFlows] = useState<{ _id: string; name: string }[]>([]);
  const [showDiscard, setShowDiscard] = useState(false);
  // Id of the pdfdoc block whose A4 designer is open, if any.
  const [designingId, setDesigningId] = useState('');
  // Media uploaded in this editing session, so replaced files are reclaimed
  // right away; already-saved media is cleaned up server-side on save.
  const media = useMediaApi(
    (f) => api.uploadMedia(f, 'flows'),
    (url) => api.deleteMedia(url),
  );

  useEffect(() => {
    api
      .listFlows()
      .then((r) => setOtherFlows((r.data || []).filter((f) => f._id !== (flow?._id || '')).map((f) => ({ _id: f._id, name: f.name }))))
      .catch(() => setOtherFlows([]));
  }, [api, flow]);

  // Snapshot of everything the user can edit, to detect unsaved changes. The
  // baseline is reset after a successful save/publish so saving clears "dirty".
  const snapshot = () => JSON.stringify({ name, msg, screens, blocks, flowLinks, entryTarget, positions });
  const baseline = useRef('');
  useEffect(() => {
    baseline.current = snapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dirty = snapshot() !== baseline.current;
  function handleClose() {
    if (dirty) setShowDiscard(true);
    else onBack();
  }
  // Browser Back: dismiss the "Discard changes?" prompt if it's up, otherwise
  // behave like the arrow (which asks when there's unsaved work).
  useBackHandler(true, () => (showDiscard ? setShowDiscard(false) : handleClose()));

  // Kept in a ref and refreshed every render so the shell's guard always reads
  // the current state rather than a stale closure.
  const isDirty = useRef<() => boolean>(() => false);
  isDirty.current = () => dirty;

  // Let the shell intercept a tab change while there's unsaved work. Without
  // this the back arrow asked before discarding but switching to Chats or
  // Templates threw the whole flow away without a word.
  useEffect(() => {
    registerDirty?.(() => isDirty.current());
    return () => registerDirty?.(null);
  }, [registerDirty]);

  // Closing the tab or refreshing loses the builder just as surely.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty.current()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Undo / redo history. Each distinct snapshot is a step; `timeTravel` guards
  // against re-recording while we're applying an undo/redo.
  const snap = snapshot();
  const [hist, setHist] = useState<{ stack: string[]; idx: number }>(() => ({ stack: [snap], idx: 0 }));
  const timeTravel = useRef(false);
  useEffect(() => {
    if (timeTravel.current) {
      timeTravel.current = false;
      return;
    }
    setHist((h) => {
      if (h.stack[h.idx] === snap) return h; // nothing actually changed
      const base = h.stack.slice(0, h.idx + 1);
      const stack = [...base, snap].slice(-60);
      return { stack, idx: stack.length - 1 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  function applySnap(str: string) {
    const o = JSON.parse(str);
    timeTravel.current = true;
    setName(o.name || '');
    setMsg(flowMessageOf(o));
    setScreens(o.screens || []);
    setBlocks(o.blocks || []);
    setFlowLinks(o.flowLinks || []);
    setEntryTarget(o.entryTarget || '');
    setPositions(o.positions || {});
  }
  const canUndo = hist.idx > 0;
  const canRedo = hist.idx < hist.stack.length - 1;
  function undo() {
    if (hist.idx <= 0) return;
    const idx = hist.idx - 1;
    applySnap(hist.stack[idx]);
    setHist((h) => ({ ...h, idx }));
  }
  function redo() {
    if (hist.idx >= hist.stack.length - 1) return;
    const idx = hist.idx + 1;
    applySnap(hist.stack[idx]);
    setHist((h) => ({ ...h, idx }));
  }

  const screen = screens[activeScreen] || screens[0];

  function patchScreen(i: number, patch: Partial<FlowScreen>) {
    setScreens((ss) => ss.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function patchComponent(cid: string, patch: Partial<FlowComponent>) {
    setScreens((ss) =>
      ss.map((s, idx) =>
        idx === activeScreen
          ? { ...s, components: s.components.map((c) => (c.cid === cid ? { ...c, ...patch } : c)) }
          : s,
      ),
    );
  }
  // Insert one or more components just above the footer button.
  function insertComponents(comps: FlowComponent[]) {
    setScreens((ss) =>
      ss.map((s, idx) => {
        if (idx !== activeScreen) return s;
        const next = [...s.components];
        const footerIdx = next.findIndex((c) => c.type === 'Footer');
        if (footerIdx >= 0) next.splice(footerIdx, 0, ...comps);
        else next.push(...comps);
        return { ...s, components: next };
      }),
    );
  }
  function addComponent(type: FlowComponentType, source?: DynSource) {
    insertComponents([defaultComponent(type, source)]);
  }
  /**
   * A payment-method chooser on the screen: a radio list the customer answers
   * inside the form. `payment_method` is the name the runtime recognises, so
   * the answer is saved against the order rather than as a loose field.
   */
  function addPaymentMethod() {
    const current = screens[activeScreen];
    if ((current?.components || []).some((c) => c.name === PAYMENT_METHOD_FIELD)) return;
    insertComponents([
      {
        cid: newCid(),
        type: 'RadioButtonsGroup',
        name: PAYMENT_METHOD_FIELD,
        label: 'How would you like to pay?',
        required: true,
        source: 'static',
        options: [
          { id: 'cod', title: 'Cash on delivery', description: '' },
          { id: 'online', title: 'Pay online', description: '' },
        ],
      },
    ]);
  }
  /** Add the whole Register form (name, business, locked WhatsApp, email, date). */
  function addRegisterFields() {
    const current = screens[activeScreen];
    const existing = new Set((current?.components || []).map((c) => c.name).filter(Boolean) as string[]);
    const comps: FlowComponent[] = [];

    // If the customer already chose a category and/or member on an earlier
    // screen, lead the form with what they're registering for — otherwise the
    // form gives no context about the selection.
    const incoming = current ? incomingDataKeys(screens, current.id) : [];
    const summary = ['selected_member_label', 'selected_category_label']
      .filter((k) => incoming.includes(k))
      .map((k) => `\${data.${k}}`);
    const hasSummary = (current?.components || []).some((c) => (c.text || '').includes('_label}'));
    if (summary.length && !hasSummary) {
      comps.push({ cid: newCid(), type: 'TextBody', text: `Registering for: ${summary.join(' · ')}` });
    }

    for (const f of REGISTER_FIELDS) {
      if (existing.has(f.name)) continue;
      comps.push({
        cid: newCid(),
        type: f.type,
        name: f.name,
        label: f.label,
        required: !!f.required,
        ...(f.inputType ? { inputType: f.inputType } : {}),
        ...(f.prefill ? { prefill: f.prefill } : {}),
        ...(f.locked ? { locked: true } : {}),
        ...(f.helperText ? { helperText: f.helperText } : {}),
      } as FlowComponent);
    }
    if (comps.length) insertComponents(comps);
  }

  /**
   * One-click "Cancel order" journey. Turns the current screen into an
   * open-orders picker, adds a confirmation screen, and drops a confirmation
   * message block (+ a reply button) on the map already wired up:
   *
   *   [this screen: pick order] → [confirm] → (message w/ order details) → (reply)
   *
   * The message body uses {{order_id}} style tokens, so the business can
   * reword it freely while the real order details still come through.
   */
  function addCancelFlow() {
    const current = screens[activeScreen];
    if (!current) return;
    // Already built on this screen? Don't duplicate.
    if ((current.components || []).some((c) => c.name === 'cancel_order')) return;

    const taken = new Set(screens.map((s) => s.id));
    const confirmId = freeScreenId(taken, slugScreenId('CANCEL_CONFIRM'));
    // Wording follows the business type: a clinic cancels an appointment, not
    // an order. The runtime field names stay the same (cancel_order /
    // cancel_confirm) — only what the customer reads changes.
    const cw = vertical.confirm.cancel;

    // --- Map block: one PDF document message (attachment + wording + button) ---
    const doc = makeBlock({ kind: 'pdfdoc', preset: 'cancel' }, vertical.confirm);

    // --- Screen 1 (this one): choose an open order ---
    const pickerComps: FlowComponent[] = [
      { cid: newCid(), type: 'TextHeading', text: cw.pickTitle },
      { cid: newCid(), type: 'TextBody', text: cw.pickBody },
      defaultComponent('RadioButtonsGroup', 'active_orders'),
    ];
    // Keep anything already on the screen (banner image etc.), drop its footer —
    // we re-add it pointing at the confirmation screen.
    const kept = (current.components || []).filter((c) => c.type !== 'Footer');
    const existingFooter = (current.components || []).find((c) => c.type === 'Footer');
    const screen1: FlowScreen = {
      ...current,
      title: current.title || cw.pickTitle,
      components: [
        ...kept,
        ...pickerComps,
        {
          cid: newCid(),
          type: 'Footer',
          buttonLabel: existingFooter?.buttonLabel || 'Continue',
          action: 'navigate',
          nextScreen: confirmId,
        },
      ],
    };

    // --- Screen 2: confirm, then hand off to the message block ---
    const screen2: FlowScreen = {
      id: confirmId,
      title: cw.confirmTitle,
      components: [
        { cid: newCid(), type: 'TextHeading', text: cw.confirmTitle },
        // Shows the item they picked, resolved to a readable label.
        { cid: newCid(), type: 'TextBody', text: `${cw.confirmPrefix}\n\${data.cancel_order_label}` },
        {
          cid: newCid(),
          type: 'RadioButtonsGroup',
          name: 'cancel_confirm',
          label: 'Are you sure?',
          required: true,
          source: 'static',
          options: [
            { id: 'yes', title: cw.yesLabel, description: '' },
            { id: 'no', title: cw.noLabel, description: '' },
          ],
        },
        {
          cid: newCid(),
          type: 'Footer',
          buttonLabel: 'Submit',
          action: 'complete',
          blockId: doc.id, // map wiring: confirm screen → PDF document message
        },
      ],
    };

    setScreens((ss) => ss.map((s, i) => (i === activeScreen ? screen1 : s)).concat(screen2));
    setBlocks((bs) => [...bs, doc]);
    // Lay the new nodes out to the right of the picker screen so the map reads
    // left-to-right without the user having to untangle it.
    const base = positions[`screen_${current.id}`] || { x: 60, y: 60 };
    setPositions((p) => ({
      ...p,
      [`screen_${confirmId}`]: { x: base.x + 320, y: base.y },
      [`block_${doc.id}`]: { x: base.x + 660, y: base.y },
    }));
  }
  /**
   * One-click "Book appointment" journey, the booking counterpart to
   * addCancelFlow:
   *
   *   [this screen: details + date] → [pick a time] → (confirmation message)
   *
   * The details screen collects name, a locked WhatsApp number, email and the
   * date. The second screen's slot list is driven by that date plus whichever
   * member was chosen earlier, so the times offered are the doctor's real free
   * slots for that day — which is why the date picker has to be on the screen
   * *before* the slot list rather than beside it.
   *
   * Field names matter and are not cosmetic: `preferred_date` is what the
   * runtime reads for the date and `selected_slot` is what the booking is
   * recorded under. Renaming them in the editor breaks the link.
   */
  function addBookingFlow() {
    const current = screens[activeScreen];
    if (!current) return;
    // Already built here? Don't duplicate.
    if ((current.components || []).some((c) => c.name === 'preferred_date')) return;

    const taken = new Set(screens.map((s) => s.id));
    const slotId = freeScreenId(taken, slugScreenId('PICK_SLOT'));

    // No confirmation block is created. There are already blocks built for
    // this — "Order confirmed" and "Order confirmed (PDF)" — with their own
    // wording and live values, so inventing a plain Message here just gave the
    // business something to delete. The slot screen's port is left free to
    // wire into whichever one they want.

    // --- Screen 1 (this one): who they are + which day ---
    // Name, locked WhatsApp number, email — then the patient details a clinic
    // needs, then the day. Any of these can be deleted on the screen like any
    // other component; they're a sensible starting set, not a fixed form.
    const identityFields = REGISTER_FIELDS.filter(
      (f) => f.name !== 'business_name' && f.name !== 'preferred_date',
    ).map(
      (f) =>
        ({
          cid: newCid(),
          type: f.type,
          name: f.name,
          label: f.label,
          required: !!f.required,
          ...(f.inputType ? { inputType: f.inputType } : {}),
          ...(f.prefill ? { prefill: f.prefill } : {}),
          ...(f.locked ? { locked: true } : {}),
          ...(f.helperText ? { helperText: f.helperText } : {}),
        }) as FlowComponent,
    );
    const detailComps: FlowComponent[] = [
      { cid: newCid(), type: 'TextHeading', text: 'Book an appointment' },
      { cid: newCid(), type: 'TextBody', text: 'Fill in your details and pick a day.' },
      ...identityFields,
      {
        // A dropdown rather than radio buttons: three stacked radio rows cost
        // as much vertical space as the rest of the form put together.
        cid: newCid(),
        type: 'Dropdown',
        name: 'gender',
        label: 'Gender',
        required: true,
        source: 'static',
        options: [
          { id: 'male', title: 'Male', description: '' },
          { id: 'female', title: 'Female', description: '' },
          { id: 'other', title: 'Other', description: '' },
        ],
      },
      {
        cid: newCid(),
        type: 'TextInput',
        name: 'age',
        label: 'Age',
        inputType: 'number',
        required: true,
      },
      // The date stays last: the slot screen reads it, so it's the final
      // question before "See times".
      { cid: newCid(), type: 'DatePicker', name: 'preferred_date', label: 'Preferred date', required: true },
    ];
    const kept = (current.components || []).filter((c) => c.type !== 'Footer');
    const existingFooter = (current.components || []).find((c) => c.type === 'Footer');
    const screen1: FlowScreen = {
      ...current,
      title: current.title || 'Book an appointment',
      components: [
        ...kept,
        ...detailComps,
        {
          cid: newCid(),
          type: 'Footer',
          buttonLabel: existingFooter?.buttonLabel || 'See times',
          action: 'navigate',
          nextScreen: slotId,
        },
      ],
    };

    // --- Screen 2: the live slot list for that member + date ---
    const screen2: FlowScreen = {
      id: slotId,
      title: 'Pick a time',
      components: [
        { cid: newCid(), type: 'TextHeading', text: 'Pick a time' },
        {
          cid: newCid(),
          type: 'TextBody',
          // The _label twin, not the raw answer: a DatePicker submits epoch
          // milliseconds, so ${data.preferred_date} would read "1793404800000".
          text: 'Available times on ${data.preferred_date_label}',
        },
        defaultComponent('Dropdown', 'slots'),
        { cid: newCid(), type: 'Footer', buttonLabel: 'Confirm booking', action: 'complete' },
      ],
    };

    setScreens((ss) => ss.map((s, i) => (i === activeScreen ? screen1 : s)).concat(screen2));
    const base = positions[`screen_${current.id}`] || { x: 60, y: 60 };
    setPositions((p) => ({
      ...p,
      [`screen_${slotId}`]: { x: base.x + 320, y: base.y },
    }));
  }

  /**
   * One-click "Reschedule" journey:
   *
   *   [this screen: pick the appointment] → [new day + time] → (confirmation)
   *
   * Simpler than booking because nothing is re-collected: the patient, the
   * doctor and the specialisation all come from the appointment they pick, so
   * the only questions are the new day and the new time. The slot list reads
   * the doctor off that appointment, which is why there's no doctor picker.
   *
   * Submitting MOVES the booking rather than adding one, which releases the
   * old slot and takes the new one together.
   */
  function addRescheduleFlow() {
    const current = screens[activeScreen];
    if (!current) return;
    if ((current.components || []).some((c) => c.name === 'reschedule_appointment')) return;

    const taken = new Set(screens.map((s) => s.id));
    const dateId = freeScreenId(taken, slugScreenId('NEW_DATE'));
    taken.add(dateId);
    const slotId = freeScreenId(taken, slugScreenId('NEW_TIME'));

    // As with booking, no confirmation block is created — the existing
    // "Order confirmed" blocks already do that job properly.

    // --- Screen 1 (this one): which booking are we moving? ---
    const kept = (current.components || []).filter((c) => c.type !== 'Footer');
    const existingFooter = (current.components || []).find((c) => c.type === 'Footer');
    const screen1: FlowScreen = {
      ...current,
      title: current.title || 'Reschedule',
      components: [
        ...kept,
        { cid: newCid(), type: 'TextHeading', text: 'Reschedule an appointment' },
        { cid: newCid(), type: 'TextBody', text: 'Which appointment would you like to move?' },
        defaultComponent('RadioButtonsGroup', 'appointments'),
        {
          cid: newCid(),
          type: 'Footer',
          buttonLabel: existingFooter?.buttonLabel || 'Continue',
          action: 'navigate',
          nextScreen: dateId,
        },
      ],
    };

    // --- Screen 2: pick the new day. On ITS OWN screen, because a slot list is
    // built when its screen opens, so it can only know the chosen day if the
    // day was committed on an earlier screen (the same reason booking splits
    // the date and the times). Combined on one screen the list stayed empty
    // ("No times left that day") — the reschedule bug this fixes.
    const screen2: FlowScreen = {
      id: dateId,
      title: 'Pick a new date',
      components: [
        { cid: newCid(), type: 'TextHeading', text: 'Pick a new date' },
        {
          cid: newCid(),
          type: 'TextBody',
          // The label twin, so this reads "Dr. Asha Rao · 10:30 am · 18 Oct 2026"
          // rather than the raw appointment id.
          text: 'Currently booked: ${data.reschedule_appointment_label}',
        },
        { cid: newCid(), type: 'DatePicker', name: 'preferred_date', label: 'New date', required: true },
        { cid: newCid(), type: 'Footer', buttonLabel: 'See times', action: 'navigate', nextScreen: slotId },
      ],
    };

    // --- Screen 3: the times free on that day for the appointment's doctor ---
    const screen3: FlowScreen = {
      id: slotId,
      title: 'Pick a new time',
      components: [
        { cid: newCid(), type: 'TextHeading', text: 'Pick a new time' },
        { cid: newCid(), type: 'TextBody', text: 'Available times on ${data.preferred_date_label}' },
        defaultComponent('Dropdown', 'slots'),
        { cid: newCid(), type: 'Footer', buttonLabel: 'Confirm change', action: 'complete' },
      ],
    };

    setScreens((ss) => ss.map((s, i) => (i === activeScreen ? screen1 : s)).concat(screen2, screen3));
    const base = positions[`screen_${current.id}`] || { x: 60, y: 60 };
    setPositions((p) => ({
      ...p,
      [`screen_${dateId}`]: { x: base.x + 320, y: base.y },
      [`screen_${slotId}`]: { x: base.x + 640, y: base.y },
    }));
  }

  function removeComponent(cid: string) {
    // Reclaim any media this component uploaded in the current session.
    const comp = (screens[activeScreen]?.components || []).find((c) => c.cid === cid);
    if (comp) {
      media.discard(comp.src);
      for (const o of comp.options || []) media.discard(o.image);
    }
    setScreens((ss) =>
      ss.map((s, idx) =>
        idx === activeScreen ? { ...s, components: s.components.filter((c) => c.cid !== cid) } : s,
      ),
    );
  }
  function moveComponent(cid: string, dir: -1 | 1) {
    setScreens((ss) =>
      ss.map((s, idx) => {
        if (idx !== activeScreen) return s;
        const comps = [...s.components];
        const i = comps.findIndex((c) => c.cid === cid);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= comps.length) return s;
        [comps[i], comps[j]] = [comps[j], comps[i]];
        return { ...s, components: comps };
      }),
    );
  }

  function addScreen(pos?: { x: number; y: number }) {
    // Deleting a screen can free up a number, so guard against reusing an id.
    const id = freeScreenId(
      new Set(screens.map((s) => s.id)),
      slugScreenId(`SCREEN ${screens.length + 1}`),
    );
    setScreens((ss) => [
      ...ss,
      {
        id,
        title: `Screen ${ss.length + 1}`,
        components: [
          defaultComponent('TextHeading'),
          { cid: newCid(), type: 'Footer', buttonLabel: 'Continue', action: 'complete' },
        ],
      },
    ]);
    if (pos) setPositions((p) => ({ ...p, [`screen_${id}`]: pos }));
    else setActiveScreen(screens.length);
  }
  /**
   * The screen shown when a dynamic list has nothing in it.
   *
   * A WhatsApp Flow picker must have at least one option, so an empty list —
   * a customer with no orders tapping "My orders" — makes the client fail with
   * "Something went wrong. Try again later.". The runtime swaps this screen in
   * instead. One screen covers every list in the flow.
   *
   * It carries no picker of its own, and its footer completes the flow, so it
   * can be wired to a message block on the map ("Browse the menu").
   */
  function addEmptyStateScreen() {
    if (screens.some((s) => s.emptyState)) return;
    const id = freeScreenId(new Set(screens.map((s) => s.id)), slugScreenId('NOT FOUND'));
    setScreens((ss) => [
      ...ss,
      {
        id,
        title: 'Nothing found',
        emptyState: true,
        components: [
          { cid: newCid(), type: 'TextHeading', text: 'Nothing here yet' },
          {
            cid: newCid(),
            type: 'TextBody',
            text: "You don't have anything here at the moment. Once you place an order it will show up in this list.",
          },
          { cid: newCid(), type: 'Footer', buttonLabel: 'Back', action: 'complete' },
        ],
      },
    ]);
    setActiveScreen(screens.length);
  }
  function removeScreen(i: number) {
    if (screens.length === 1) return;
    const removedId = screens[i].id;
    // Reclaim media this screen uploaded in the current session.
    media.discard(screens[i].msgHeaderMediaUrl);
    for (const c of screens[i].components || []) {
      media.discard(c.src);
      for (const o of c.options || []) media.discard(o.image);
    }
    setScreens((ss) => {
      const next = ss.filter((_, idx) => idx !== i);
      // Clear every navigation that pointed at the removed screen — footers
      // AND per-option branches. Only footers used to be cleaned, so an option
      // kept pointing at a screen that no longer existed; the flow saved fine
      // and then Meta refused to publish it with "Invalid screens found in the
      // routing model", naming a screen the builder no longer showed.
      return next.map((s) => ({
        ...s,
        components: s.components.map((c) => {
          if (c.type === 'Footer' && c.nextScreen === removedId) {
            return { ...c, action: 'complete', nextScreen: undefined };
          }
          if ((c.options || []).some((o) => o.nextScreen === removedId)) {
            return {
              ...c,
              options: (c.options || []).map((o) =>
                o.nextScreen === removedId ? { ...o, nextScreen: undefined } : o,
              ),
            };
          }
          return c;
        }),
      }));
    });
    clearTargetRefs(`screen_${removedId}`);
    setActiveScreen((a) => Math.max(0, a >= i ? a - 1 : a));
  }

  // --- Map wiring: set/clear navigation by connecting node handles ---
  function patchFooter(screenId: string, patch: Partial<FlowComponent>) {
    setScreens((ss) =>
      ss.map((s) =>
        s.id === screenId
          ? { ...s, components: s.components.map((c) => (c.type === 'Footer' ? { ...c, ...patch } : c)) }
          : s,
      ),
    );
  }
  function patchOption(screenId: string, optionId: string, patch: Partial<FlowOption>) {
    setScreens((ss) =>
      ss.map((s) =>
        s.id === screenId
          ? {
              ...s,
              components: s.components.map((c) =>
                SELECTION.has(c.type)
                  ? { ...c, options: (c.options || []).map((o) => (o.id === optionId ? { ...o, ...patch } : o)) }
                  : c,
              ),
            }
          : s,
      ),
    );
  }
  function connectScreen(fromId: string, handle: string, toId: string) {
    if (handle === 'next') patchFooter(fromId, { action: 'navigate', nextScreen: toId, nextFlowId: undefined, blockId: undefined });
    else patchOption(fromId, handle.slice(4), { nextScreen: toId, blockId: undefined, nextFlowId: undefined });
  }
  function connectFlow(fromId: string, handle: string, flowLinkId: string) {
    if (handle === 'next') patchFooter(fromId, { action: 'complete', nextScreen: undefined, nextFlowId: flowLinkId, blockId: undefined });
    else patchOption(fromId, handle.slice(4), { nextScreen: undefined, blockId: undefined, nextFlowId: flowLinkId });
  }
  function connectBlock(fromId: string, handle: string, blockId: string) {
    if (handle === 'next') patchFooter(fromId, { action: 'complete', nextScreen: undefined, nextFlowId: undefined, blockId });
    else patchOption(fromId, handle.slice(4), { nextScreen: undefined, blockId, nextFlowId: undefined });
  }
  function disconnect(fromId: string, handle: string) {
    if (handle === 'next') patchFooter(fromId, { action: 'complete', nextScreen: undefined, nextFlowId: undefined, blockId: undefined });
    else patchOption(fromId, handle.slice(4), { nextScreen: undefined, blockId: undefined, nextFlowId: undefined });
  }
  // --- Flow-link nodes (hand off to another flow) ---
  function addFlowLink(pos?: { x: number; y: number }) {
    const id = `fl_${Date.now().toString(36)}`;
    setFlowLinks((ls) => [...ls, { id, flowId: '' }]);
    if (pos) setPositions((p) => ({ ...p, [`flink_${id}`]: pos }));
  }
  function setFlowLinkFlow(id: string, flowId: string) {
    setFlowLinks((ls) => ls.map((l) => (l.id === id ? { ...l, flowId } : l)));
  }
  function removeFlowLink(id: string) {
    setFlowLinks((ls) => ls.filter((l) => l.id !== id));
    clearTargetRefs(`flink_${id}`);
    // Clear any option/footer that handed off to it.
    setScreens((ss) =>
      ss.map((s) => ({
        ...s,
        components: s.components.map((c) => {
          if (c.type === 'Footer' && c.nextFlowId === id) return { ...c, nextFlowId: undefined };
          if (SELECTION.has(c.type)) return { ...c, options: (c.options || []).map((o) => (o.nextFlowId === id ? { ...o, nextFlowId: undefined } : o)) };
          return c;
        }),
      })),
    );
  }
  async function createNewFlowForLink(linkId: string) {
    try {
      const res = await api.createFlowDef({
        name: `New flow ${new Date().toLocaleDateString()}`,
        screens: [
          {
            id: 'WELCOME',
            title: 'Welcome',
            components: [
              { cid: newCid(), type: 'TextHeading', text: 'Heading text' },
              { cid: newCid(), type: 'Footer', buttonLabel: 'Continue', action: 'complete' },
            ],
          },
        ],
      });
      setFlowLinkFlow(linkId, res.data._id);
      // Refresh the dropdown list so the new flow shows up.
      api.listFlows().then((r) => setOtherFlows((r.data || []).filter((f) => f._id !== (flow?._id || '')).map((f) => ({ _id: f._id, name: f.name }))));
    } catch {
      /* ignore */
    }
  }
  // A block's outgoing port (location valid/invalid, a simple block's `next`, or
  // a reply button `rbtn-<i>`) stores the target node id (screen_/block_/flink_).
  function setBlockTarget(b: FlowBlock, handle: string, target: string | undefined): FlowBlock {
    if (handle === 'valid') return { ...b, validTarget: target };
    if (handle === 'invalid') return { ...b, invalidTarget: target };
    if (handle === 'next') return { ...b, nextTarget: target };
    if (handle.startsWith('rbtn-')) {
      const i = Number(handle.slice(5));
      const bt = [...(b.buttonTargets || [])];
      bt[i] = target || '';
      return { ...b, buttonTargets: bt };
    }
    return b;
  }
  function connectFromBlock(blockId: string, handle: string, targetNodeId: string) {
    setBlocks((bs) => bs.map((b) => (b.id === blockId ? setBlockTarget(b, handle, targetNodeId) : b)));
  }
  function disconnectBlock(blockId: string, handle: string) {
    setBlocks((bs) => bs.map((b) => (b.id === blockId ? setBlockTarget(b, handle, undefined) : b)));
  }
  // Start node → the flow's entry node (a screen or a block).
  function connectStart(targetNodeId: string) {
    setEntryTarget(targetNodeId);
  }
  function disconnectStart() {
    setEntryTarget('');
  }
  // When a node (screen_/block_/flink_) is deleted, drop any block wiring or
  // entry pointer that targeted it so no dangling edges remain.
  function clearTargetRefs(nodeId: string) {
    setBlocks((bs) =>
      bs.map((b) => ({
        ...b,
        validTarget: b.validTarget === nodeId ? undefined : b.validTarget,
        invalidTarget: b.invalidTarget === nodeId ? undefined : b.invalidTarget,
        nextTarget: b.nextTarget === nodeId ? undefined : b.nextTarget,
        buttonTargets: (b.buttonTargets || []).map((t) => (t === nodeId ? '' : t)),
      })),
    );
    setEntryTarget((e) => (e === nodeId ? '' : e));
  }
  function addBlock(spec: BlockSpec, pos?: { x: number; y: number }) {
    const b = makeBlock(spec, vertical.confirm);
    setBlocks((bs) => [...bs, b]);
    if (pos) setPositions((p) => ({ ...p, [`block_${b.id}`]: pos }));
  }
  function patchBlock(id: string, patch: Partial<FlowBlock>) {
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  function patchScreenById(id: string, patch: Partial<FlowScreen>) {
    setScreens((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeBlock(id: string) {
    media.discard(blocks.find((b) => b.id === id)?.headerMediaUrl);
    setBlocks((bs) => bs.filter((b) => b.id !== id));
    clearTargetRefs(`block_${id}`);
    // Clear any option/footer that pointed at it.
    setScreens((ss) =>
      ss.map((s) => ({
        ...s,
        components: s.components.map((c) => {
          if (c.type === 'Footer' && c.blockId === id) return { ...c, blockId: undefined };
          if (SELECTION.has(c.type)) return { ...c, options: (c.options || []).map((o) => (o.blockId === id ? { ...o, blockId: undefined } : o)) };
          return c;
        }),
      })),
    );
  }
  function selectScreenById(id: string) {
    const idx = screens.findIndex((s) => s.id === id);
    if (idx >= 0) {
      setActiveScreen(idx);
      setView('build');
    }
  }

  function currentFlow(id = savedId): WaFlowDef {
    return {
      _id: id,
      name: name.trim() || 'Untitled flow',
      ...msg,
      cta: msg.cta.trim() || 'Open',
      categories: flow?.categories || ['OTHER'],
      screens,
      blocks,
      flowLinks,
      entryTarget,
      positions,
      metaFlowId,
      status,
    };
  }

  const flowJson = useMemo(() => buildFlowJson(currentFlow()), [screens, name, msg]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const endpointMode = useMemo(() => isEndpointMode(currentFlow()), [screens]);

  async function save(): Promise<string> {
    setBusy('save');
    setError('');
    const body = currentFlow();
    try {
      let res;
      if (savedId) res = await api.updateFlowDef(savedId, body);
      else res = await api.createFlowDef(body);
      setSavedId(res.data._id);
      setStatus(res.data.status || 'DRAFT');
      if (res.data.metaFlowId) setMetaFlowId(res.data.metaFlowId);
      baseline.current = snapshot(); // changes are now persisted
      setBusy('');
      return res.data._id;
    } catch (e) {
      setBusy('');
      setError(e instanceof Error ? e.message : 'Save failed');
      throw e;
    }
  }
  async function publish() {
    try {
      const id = await save();
      setBusy('publish');
      setIssues([]);
      const res = await api.publishFlowDef(id);
      setStatus(res.data.status || 'DRAFT');
      if (res.data.metaFlowId) setMetaFlowId(res.data.metaFlowId);
      // The server may have renamed screen ids to satisfy Meta (letters and
      // underscores only). Adopt its version, otherwise the next save would
      // write the rejected ids straight back.
      const served = res.data.screens || [];
      if (served.map((s) => s.id).join('|') !== screens.map((s) => s.id).join('|')) {
        setScreens(served);
        setBlocks(res.data.blocks || []);
        setEntryTarget(res.data.entryTarget || '');
        setPositions(sanitizePositions(res.data.positions));
        baseline.current = JSON.stringify({
          name,
          msg,
          screens: served,
          blocks: res.data.blocks || [],
          flowLinks,
          entryTarget: res.data.entryTarget || '',
          positions: sanitizePositions(res.data.positions),
        });
      }
      setBusy('');
      // Show Meta's actual messages — a bare count isn't actionable.
      const lines = res.warnings?.length ? res.warnings : (res.validationErrors || []).map((e) => e.message || '');
      setIssues(lines.filter(Boolean));
      if (res.published === false) {
        setError(res.publishError || 'Meta rejected the publish. The flow is still a draft.');
        return;
      }
      setError('');
      onSaved(editing ? 'Flow republished to Meta.' : 'Flow published to Meta.');
    } catch {
      setBusy('');
    }
  }

  const screenOptions: KOption[] = screens
    .filter((s) => s.id !== screen?.id)
    .map((s) => ({ value: s.id, label: `${s.title} (${s.id})` }));

  // Fields passed in from earlier screens — insertable as ${data.x} tokens so a
  // later screen can show the choice made on screen 1 dynamically.
  const dynamicFields = useMemo(
    () => (screen ? incomingDataKeys(screens, screen.id) : []),
    [screens, screen],
  );

  /**
   * Does EVERY option on this screen send the customer somewhere of its own?
   *
   * Only then is the footer destination genuinely unreachable. With some
   * options branched and others not, the footer is still the fallback for the
   * rest — so hiding its controls (as this did when *any* option branched)
   * removed the only way to say where those options go.
   */
  const screenBranches = useMemo(() => {
    const bf = screen ? branchFieldOf(screen) : undefined;
    const opts = bf?.options || [];
    return opts.length > 0 && opts.every((o) => o.nextScreen || o.blockId || o.nextFlowId);
  }, [screen]);



  return (
    <VerticalCtx.Provider value={vertical}>
    <MediaCtx.Provider value={media}>
    <div className="page flow-editor">
      <header className="page-head">
        <button className="icon-btn" onClick={handleClose} aria-label="Back">
          <span className="material-icons">arrow_back</span>
        </button>
        <input className="flow-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Flow name" />
        <span className={`flow-status ${status === 'PUBLISHED' ? 'pub' : 'draft'}`}>
          {status === 'PUBLISHED' ? 'Published' : 'Draft'}
        </span>
        {endpointMode && (
          <span className="flow-status endpoint" title="Branching / dynamic data — served by your flow endpoint">
            <span className="material-icons">bolt</span> Endpoint
          </span>
        )}
        <div className="flow-view-toggle">
          <button className={`flow-tab${view === 'build' ? ' on' : ''}`} onClick={() => setView('build')}>
            <span className="material-icons">tune</span> Build
          </button>
          <button className={`flow-tab${view === 'map' ? ' on' : ''}`} onClick={() => setView('map')}>
            <span className="material-icons">account_tree</span> Map
          </button>
        </div>
        <div className="flow-head-actions">
          <button className="k-btn ghost sm icon-only" onClick={undo} disabled={!canUndo} title="Undo">
            <span className="material-icons">undo</span>
          </button>
          <button className="k-btn ghost sm icon-only" onClick={redo} disabled={!canRedo} title="Redo">
            <span className="material-icons">redo</span>
          </button>
          <button className="k-btn ghost sm" onClick={() => setShowJson((v) => !v)}>
            <span className="material-icons">data_object</span> {showJson ? 'Hide JSON' : 'View JSON'}
          </button>
          <button className="k-btn ghost sm" onClick={() => save().then(() => onSaved('Flow saved.')).catch(() => {})} disabled={!!busy}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          <button className="k-btn sm" onClick={publish} disabled={!!busy}>
            <span className="material-icons">cloud_upload</span>
            {busy === 'publish' ? 'Publishing…' : status === 'PUBLISHED' ? 'Republish' : 'Publish'}
          </button>
        </div>
      </header>

      {error && <p className="err flow-err">{error}</p>}
      {issues.length > 0 && (
        <div className="flow-issues">
          <div className="flow-issues-head">
            <span className="material-icons">report_problem</span>
            {issues.length} issue{issues.length === 1 ? '' : 's'} reported by Meta
            <button className="flow-issues-x" onClick={() => setIssues([])} aria-label="Dismiss">
              <span className="material-icons">close</span>
            </button>
          </div>
          <ul>
            {issues.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {view === 'map' ? (
        <ScreenMap
          screens={screens}
          blocks={blocks}
          flowLinks={flowLinks}
          allFlows={otherFlows}
          positions={positions}
          entryTarget={entryTarget}
          onConnectStart={connectStart}
          onDisconnectStart={disconnectStart}
          onConnectScreen={connectScreen}
          onConnectFlow={connectFlow}
          onConnectBlock={connectBlock}
          onConnectFromBlock={connectFromBlock}
          onDisconnect={disconnect}
          onDisconnectBlock={disconnectBlock}
          onSelect={selectScreenById}
          onBlockChange={patchBlock}
          onBlockRemove={removeBlock}
          onDesignPdf={setDesigningId}
          onScreenChange={patchScreenById}
          onPickFlow={setFlowLinkFlow}
          onCreateFlow={createNewFlowForLink}
          onRemoveFlowLink={removeFlowLink}
          onMovePos={(id, pos) => setPositions((p) => ({ ...p, [id]: pos }))}
          onAddScreen={addScreen}
          onAddBlock={addBlock}
          onAddFlowLink={addFlowLink}
        />
      ) : (
      <div className="flow-builder">
        {/* Screens rail */}
        <aside className="flow-screens">
          <div className="fp-title">Screens</div>
          {screens.map((s, i) => (
            <div
              key={s.id + i}
              className={`flow-screen-item${i === activeScreen ? ' active' : ''}`}
              onClick={() => setActiveScreen(i)}
            >
              <span className="material-icons">{s.emptyState ? 'search_off' : 'smartphone'}</span>
              <span className="fsi-name">{s.title || s.id}</span>
              {/* It isn't reached by wiring — the runtime substitutes it — so
                  say so, otherwise it looks like a screen nothing points at. */}
              {s.emptyState && (
                <span className="fsi-tag" title="Shown automatically when a list is empty">
                  auto
                </span>
              )}
              {screens.length > 1 && (
                <button
                  className="fsi-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeScreen(i);
                  }}
                  title="Remove screen"
                >
                  <span className="material-icons">close</span>
                </button>
              )}
            </div>
          ))}
          <button className="flow-add-screen" onClick={() => addScreen()}>
            <span className="material-icons">add</span> Add screen
          </button>
          {/* One per flow, and it covers every list — so it's offered only
              while the flow hasn't got one. */}
          {!screens.some((s) => s.emptyState) && (
            <button
              className="flow-add-screen empty-state"
              onClick={addEmptyStateScreen}
              title="Shown when a list has nothing in it — no orders to track, no open orders to cancel"
            >
              <span className="material-icons">search_off</span> Add “nothing found” screen
            </button>
          )}

          <div className="fp-title" style={{ marginTop: 18 }}>Chat message</div>
          <p className="fp-hint">
            What customers receive. The attachment, text and button are sent with the flow — no
            republish needed for changes here.
          </p>
          <FlowMessageFields
            value={msg}
            onChange={(p) => setMsg((m) => ({ ...m, ...p }))}
            upload={(f) => api.uploadMedia(f, 'flows')}
          />
        </aside>

        {/* Component palette + editor */}
        <div className="flow-build-main">
          <div className="flow-palette-row">
            {PALETTE.map((p) => (
              <button
                key={p.label}
                className={`flow-pal-chip${p.group ? ' accent' : ''}`}
                onClick={() => {
                  if (p.group === 'register') addRegisterFields();
                  else if (p.group === 'booking') addBookingFlow();
                  else if (p.group === 'reschedule') addRescheduleFlow();
                  else if (p.group === 'cancel') addCancelFlow();
                  else if (p.group === 'paymethod') addPaymentMethod();
                  else addComponent(p.type, p.source);
                }}
                title={
                  p.group === 'register'
                    ? 'Adds Name, Business name, locked WhatsApp number, Email and a date picker'
                    : p.group === 'booking'
                      ? 'Builds the booking journey: a details screen (name, locked WhatsApp number, email, gender, age, date) and a second screen whose times come live from the chosen date. Wire its port to an "Order confirmed" block for the confirmation'
                      : p.group === 'reschedule'
                      ? "Builds the reschedule journey: a picker of the customer's own upcoming appointments, then a new date + live times for the same doctor. Submitting moves the booking instead of adding one"
                      : p.group === 'cancel'
                        ? 'Builds the whole cancel journey: open-orders picker, a confirmation screen, and a confirmation message + reply button wired on the map'
                        : p.group === 'paymethod'
                          ? 'Adds a Cash on delivery / Pay online choice the customer picks before submitting'
                          : p.label
                }
              >
                <span className="material-icons">{p.icon}</span>
                {p.label}
              </button>
            ))}
          </div>

          <div className="flow-screen-fields">
            <div className="flow-screen-id-row">
              <div className="k-field">
                <label className="k-label">Screen title</label>
                <input
                  className="k-input"
                  value={screen?.title || ''}
                  onChange={(e) => patchScreen(activeScreen, { title: e.target.value })}
                />
              </div>
              <div className="k-field">
                <label className="k-label">Screen ID</label>
                <input
                  className="k-input"
                  value={screen?.id || ''}
                  onChange={(e) => patchScreen(activeScreen, { id: slugScreenId(e.target.value) })}
                />
              </div>
            </div>

            {screen?.components.map((c) => (
              <ComponentEditor
                key={c.cid}
                component={c}
                screenOptions={screenOptions}
                dynamicFields={dynamicFields}
                branching={screenBranches}
                onChange={(patch) => patchComponent(c.cid, patch)}
                onRemove={() => removeComponent(c.cid)}
                onMove={(dir) => moveComponent(c.cid, dir)}
              />
            ))}
          </div>
        </div>

        {/* Live phone preview */}
        <div className="flow-preview-col">
          {showJson ? (
            <pre className="flow-json">{JSON.stringify(flowJson, null, 2)}</pre>
          ) : (
            <PhonePreview screen={screen} />
          )}
        </div>
      </div>
      )}

      {/* A4 designer for the selected PDF block. */}
      {designingId && (() => {
        const blk = blocks.find((b) => b.id === designingId);
        if (!blk) return null;
        return (
          <PdfDesigner
            template={blk.pdfTemplate}
            fileName={blk.pdfFileName}
            onClose={() => setDesigningId('')}
            onSave={(tpl, fname) => {
              patchBlock(designingId, { pdfTemplate: tpl, pdfFileName: fname });
              setDesigningId('');
            }}
          />
        );
      })()}

      {showDiscard && (
        <div className="disc-backdrop" onClick={() => setShowDiscard(false)}>
          <div className="disc-box" onClick={(e) => e.stopPropagation()}>
            <div className="disc-title">Discard changes?</div>
            <div className="disc-actions">
              <button className="disc-cancel" onClick={() => setShowDiscard(false)}>
                Cancel
              </button>
              <button className="disc-discard" onClick={onBack}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </MediaCtx.Provider>
    </VerticalCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Screen map — a node canvas where each screen is a node with green connection
// dots. Drag a dot to another screen to set navigation (per branch option or
// the footer), or to another flow node to hand off to that flow.
// ---------------------------------------------------------------------------
interface ScreenNodeData {
  title: string;
  subtitle: string;
  handles: { id: string; label: string; connected?: boolean }[];
  screenId: string;
  screen: FlowScreen;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<FlowScreen>) => void;
}

function ScreenMapNode({ data }: NodeProps<ScreenNodeData>) {
  // Screens are form pages — the media header / body / footer belong to the one
  // chat message that opens the flow, which is edited at flow level.
  return (
    <div className="map-node screen" onDoubleClick={() => data.onSelect(data.screenId)}>
      <Handle type="target" position={Position.Left} className="fl-handle" />
      <div className="map-node-title">{data.title}</div>
      <div className="map-node-sub">{data.subtitle}</div>

      <div className="map-node-handles">
        {data.handles.map((h) => (
          <div className={`map-node-port${h.connected ? '' : ' open'}`} key={h.id}>
            <span className="map-port-label">{h.label}</span>
            <Handle
              type="source"
              id={h.id}
              position={Position.Right}
              className={`fl-handle row${h.connected ? '' : ' open'}`}
              title={h.connected ? 'Connected — drag to re-route' : 'Not connected yet — drag to a screen or block'}
              style={{ top: 'auto', transform: 'none', position: 'relative' }}
            />
          </div>
        ))}
      </div>
      <button className="map-node-edit" onClick={() => data.onSelect(data.screenId)} title="Edit screen">
        <span className="material-icons">tune</span>
      </button>
    </div>
  );
}

interface FlowRefData {
  link: FlowLink;
  flows: { _id: string; name: string }[];
  onPickFlow: (linkId: string, flowId: string) => void;
  onCreateFlow: (linkId: string) => void;
  onRemove: (linkId: string) => void;
}
function FlowRefNode({ data }: NodeProps<FlowRefData>) {
  const { link, flows } = data;
  return (
    <div className="map-node flowref">
      <Handle type="target" position={Position.Left} className="fl-handle" />
      <button className="fl-del" onClick={() => data.onRemove(link.id)} title="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <line x1="5" y1="5" x2="19" y2="19" />
          <line x1="19" y1="5" x2="5" y2="19" />
        </svg>
      </button>
      <div className="flowref-head">
        <span className="material-icons">account_tree</span> Flow hand-off
      </div>
      <select
        className="flowref-select nodrag"
        value={link.flowId}
        onChange={(e) => {
          if (e.target.value === '__new__') data.onCreateFlow(link.id);
          else data.onPickFlow(link.id, e.target.value);
        }}
      >
        <option value="">Select a flow…</option>
        {flows.map((f) => (
          <option key={f._id} value={f._id}>{f.name}</option>
        ))}
        <option value="__new__">➕ Create new flow</option>
      </select>
    </div>
  );
}

// A tiny scaled render of the A4 design, so the map shows what will be sent
// without opening the designer.
function PdfThumb({ template }: { template?: PdfTemplate | null }) {
  const els = template?.elements || [];
  if (!els.length) {
    return (
      <div className="fl-pdf-thumb empty">
        <span className="material-icons">picture_as_pdf</span>
        <span>No design yet</span>
      </div>
    );
  }
  const scale = 150 / PDF_A4.width;
  return (
    <div
      className="fl-pdf-thumb"
      style={{ width: 150, height: Math.round(PDF_A4.height * scale), background: template?.background || '#fff' }}
    >
      <div
        style={{
          width: PDF_A4.width,
          height: PDF_A4.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'relative',
        }}
      >
        {els.map((el: PdfElement) => {
          const st: React.CSSProperties = { position: 'absolute', left: el.x, top: el.y, width: el.w };
          if (el.type === 'text') {
            return (
              <div
                key={el.id}
                style={{
                  ...st,
                  fontSize: el.fontSize,
                  fontWeight: el.bold ? 700 : 400,
                  color: el.color,
                  textAlign: el.align,
                  lineHeight: 1.25,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {el.text}
              </div>
            );
          }
          if (el.type === 'image') {
            return el.src ? (
              <img key={el.id} src={el.src} alt="" style={{ ...st, height: el.h, objectFit: 'contain' }} />
            ) : (
              <div key={el.id} style={{ ...st, height: el.h, background: '#eceff1' }} />
            );
          }
          if (el.type === 'box') {
            return (
              <div
                key={el.id}
                style={{ ...st, height: el.h, background: el.fill, borderRadius: el.radius }}
              />
            );
          }
          return (
            <div key={el.id} style={{ ...st, height: el.thickness || 1, background: el.color || '#d9dee3' }} />
          );
        })}
      </div>
    </div>
  );
}

const MEDIA_BLOCKS = new Set<FlowBlockKind>([
  'message', 'reply', 'cta', 'call', 'payment', 'paymethod', 'orderconfirm', 'orderdetails',
]);
// Blocks with a single right-side output port, so they can chain to the next
// node. (Reply branches per button; location branches valid/invalid instead.)
// Catalog is in here because its port fires when the customer sends their cart
// — that's what lets a catalog run on into the Payment type block.
// 'orderconfirm' is here as well as in the buttons list: with no buttons it
// behaves like a message and chains on (e.g. into a confirmation PDF), with
// buttons it branches per button instead.
const BLOCK_SINGLE_OUT = new Set<FlowBlockKind>([
  'message', 'cta', 'call', 'template', 'catalog', 'orderconfirm', 'orderdetails',
]);
// Blocks that branch on an outcome rather than simply continuing. Payment has
// two: the customer paid, or they didn't — and the second is not the same as
// "nothing happened", so it needs its own wire.
const BLOCK_OUTCOME_OUT = new Set<FlowBlockKind>(['payment']);
const BLK_HEADER_ICON: Record<FlowBlockHeader, string> = {
  none: 'block',
  image: 'image',
  video: 'videocam',
  pdf: 'picture_as_pdf',
};
const BLK_ACCEPT: Record<FlowBlockHeader, string> = { none: '', image: 'image/*', video: 'video/*', pdf: 'application/pdf' };

// Rich, inline-editable block node — mirrors the Journeys "Send message" node
// (media header tabs + upload tile + text + styled buttons / fields).
function BlockNode({
  data,
}: NodeProps<{
  block: FlowBlock;
  onChange: (id: string, patch: Partial<FlowBlock>) => void;
  onRemove: (id: string) => void;
  onDesignPdf?: (id: string) => void;
}>) {
  const b = data.block;
  const vertical = useVertical();
  // The confirmation blocks are named for the business type, so a clinic's
  // node reads "Appointment confirmed" rather than "Order confirmed".
  const meta = { ...BLOCK_META[b.kind], label: blockLabel(b.kind, vertical) };
  const fileRef = useRef<HTMLInputElement>(null);
  const { upload, discard } = useMedia();
  const patch = (p: Partial<FlowBlock>) => data.onChange(b.id, p);

  const pickHeader = (h: FlowBlockHeader) => {
    if (h === 'none') discard(b.headerMediaUrl);
    patch({ header: h, ...(h === 'none' ? { headerMediaUrl: '', headerFileName: '' } : {}) });
    if (h !== 'none') setTimeout(() => fileRef.current?.click(), 0);
  };
  const onHeaderFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const previous = b.headerMediaUrl;
    patch({ headerMediaUrl: URL.createObjectURL(f), headerFileName: f.name }); // instant preview
    upload(f)
      .then((url) => {
        patch({ headerMediaUrl: url });
        discard(previous); // replaced → reclaim the old upload
      })
      .catch(() => {});
  };
  const setButton = (i: number, v: string) => patch({ buttons: (b.buttons || []).map((x, idx) => (idx === i ? v : x)) });
  const setOption = (i: number, v: string) => patch({ options: (b.options || []).map((x, idx) => (idx === i ? v : x)) });

  return (
    <div className="fl-node block-node">
      <Handle type="target" position={Position.Left} className="fl-handle" />
      <button className="fl-del" onClick={() => data.onRemove(b.id)} title="Delete block">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <line x1="5" y1="5" x2="19" y2="19" />
          <line x1="19" y1="5" x2="5" y2="19" />
        </svg>
      </button>

      <div className="fl-node-head" style={{ color: meta.color }}>
        <span className="material-icons">{meta.icon}</span>
        {meta.label}
      </div>

      {MEDIA_BLOCKS.has(b.kind) && (
        <div className="fl-header">
          <div className="fl-header-tabs">
            {(['none', 'image', 'video', 'pdf'] as FlowBlockHeader[]).map((h) => (
              <button key={h} className={`fl-htab${(b.header || 'none') === h ? ' active' : ''} nodrag`} onClick={() => pickHeader(h)} title={h}>
                <span className="material-icons">{BLK_HEADER_ICON[h]}</span>
              </button>
            ))}
          </div>
          {b.header && b.header !== 'none' && (
            <div className="fl-header-tile nodrag" onClick={() => fileRef.current?.click()} title="Upload / replace">
              {b.headerMediaUrl ? (
                b.header === 'image' ? (
                  <img src={b.headerMediaUrl} alt="" />
                ) : b.header === 'video' ? (
                  <video src={b.headerMediaUrl} />
                ) : (
                  <div className="fl-pdf-chip">
                    <span className="material-icons">picture_as_pdf</span>
                    <span className="fl-pdf-name">{b.headerFileName || 'document.pdf'}</span>
                  </div>
                )
              ) : (
                <div className="fl-upload-hint">
                  <span className="material-icons">upload</span>
                  <span>Upload {b.header}</span>
                </div>
              )}
            </div>
          )}
          <input ref={fileRef} type="file" hidden accept={BLK_ACCEPT[b.header || 'none']} onChange={onHeaderFile} />
        </div>
      )}

      {b.kind !== 'template' && b.kind !== 'restart' && (
        <textarea
          className="fl-node-text nodrag"
          value={b.text || ''}
          placeholder={
            b.kind === 'location'
              ? 'Prompt text…'
              : b.kind === 'paymethod'
                ? 'Prompt below the summary…'
                : b.kind === 'orderconfirm'
                  ? 'Confirmation wording — one value per line…'
                  : b.kind === 'orderdetails'
                    ? 'Order details wording — one value per line…'
                    : 'Type the message…'
          }
          onChange={(e) => patch({ text: e.target.value })}
          rows={b.kind === 'orderconfirm' || b.kind === 'orderdetails' ? 9 : 2}
        />
      )}

      {/* Sends nothing itself — it just loops back to the Start node, so this
          block has an input but no output. */}
      {b.kind === 'restart' && (
        <div className="fl-restart">
          <span className="material-icons">replay</span>
          <div>
            Goes back to <strong>Start</strong> and runs the flow again, exactly like the customer
            typing &quot;hi&quot;.
          </div>
        </div>
      )}

      {/* Live-value tokens. Reword around them freely — keep the {{…}} parts so
          the real order details still appear in the sent message. */}
      {b.kind !== 'template' && /\{\{/.test(b.text || '') && (
        <div className="fl-tokens">
          <div className="fl-tokens-head">
            <span className="material-icons">bolt</span> Live values — keep these
          </div>
          <div className="fl-tokens-row">
            {[...new Set((b.text || '').match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) || [])].map((t) => (
              <span className="fl-token" key={t}>{t.replace(/[{}\s]/g, '')}</span>
            ))}
          </div>
          <div className="fl-tokens-more">
            Always available: name (the customer&apos;s name — from a form if they filled one, else
            their WhatsApp name) · business_name · today
            <br />
            Also: order_id · order_total · order_status · order_date · order_items · customer_name
            <br />
            After a Catalog block: items_total · delivery_fee · total_payable · cart_items ·
            cart_count
            <br />
            After Payment type: payment_method · after Ask location: delivery_address ·
            location_url
          </div>
        </div>
      )}

      {/* The generated A4 document. The PDF is the attachment, the text above
          is the message body, and the buttons below continue the conversation —
          all delivered as a single WhatsApp message. */}
      {b.kind === 'pdfdoc' && (
        <div className="fl-pdfdoc">
          <button
            type="button"
            className="fl-pdf-preview nodrag"
            onClick={() => data.onDesignPdf?.(b.id)}
            title="Open the A4 designer"
          >
            <PdfThumb template={b.pdfTemplate} />
            <span className="fl-pdf-edit">
              <span className="material-icons">design_services</span> Design PDF
            </span>
          </button>
          <input
            className="fl-list-title nodrag"
            value={b.pdfFileName || ''}
            onChange={(e) => patch({ pdfFileName: e.target.value })}
            placeholder="File name, e.g. receipt-{{order_id}}"
          />
        </div>
      )}

      {/* The costed summary that goes above the prompt. It's generated at send
          time from the cart plus the delivery fee set here, so this is a
          preview with sample figures rather than editable text. */}
      {b.kind === 'paymethod' && (
        <div className="blk-paym">
          <label className="blk-paym-toggle nodrag">
            <input
              type="checkbox"
              checked={b.showSummary !== false}
              onChange={(e) => patch({ showSummary: e.target.checked })}
            />
            <span>Show the payment summary above the text</span>
          </label>

          {b.showSummary !== false && (
            <>
              <input
                className="fl-list-title nodrag"
                value={b.summaryTitle ?? 'Payment'}
                onChange={(e) => patch({ summaryTitle: e.target.value })}
                placeholder="Summary heading (e.g. Payment)"
              />
              <div className="blk-paym-preview">
                <strong>{b.summaryTitle || 'Payment'}</strong>
                <span className="blk-paym-rule" />
                <span className="blk-paym-line">
                  <span>Items</span>
                  <em>₹850</em>
                </span>
                <span className="blk-paym-line">
                  <span>Delivery</span>
                  <em>{Number(b.deliveryFee) > 0 ? `₹${Number(b.deliveryFee)}` : 'FREE'}</em>
                </span>
                <span className="blk-paym-line total">
                  <span>Total payable</span>
                  <em>₹{850 + (Number(b.deliveryFee) || 0)}</em>
                </span>
                <span className="blk-paym-sample">
                  sample figures — the real cart fills these in
                </span>
              </div>
            </>
          )}

          <label className="blk-paym-fee nodrag">
            <span className="material-icons">local_shipping</span>
            <span className="blk-paym-fee-label">Flat delivery fee</span>
            <span className="blk-paym-fee-cur">₹</span>
            <input
              type="number"
              min={0}
              step="1"
              value={b.deliveryFee ?? 0}
              onChange={(e) => patch({ deliveryFee: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <div className="flow-dyn-note">
            <span className="material-icons">bolt</span>
            Items and total come from the customer&apos;s cart — connect a Catalog
            block into this one. A product&apos;s own <strong>Delivery charge</strong> in
            the catalog always wins; this flat fee only applies when every item
            in the cart is free delivery.
          </div>
        </div>
      )}

      {/* What the conversation feeds into this message. Nothing to configure —
          it's a reminder of which steps have to come before it, since a missing
          step silently removes its line from the message. */}
      {b.kind === 'orderconfirm' && (
        <div className="blk-conf">
          <div className="flow-dyn-note">
            <span className="material-icons">bolt</span>
            Every value is live. Any line whose value wasn&apos;t captured is left
            out, so delete what you don&apos;t need and keep the rest.
          </div>
          <div className="blk-conf-src">
            {[
              { k: 'cart_items', icon: 'storefront', label: 'Catalog', need: 'cart' },
              { k: 'total_payable', icon: 'account_balance_wallet', label: 'Payment type', need: 'totals' },
              { k: 'payment_method', icon: 'payments', label: 'Payment type', need: 'method' },
              { k: 'delivery_address', icon: 'location_on', label: 'Ask location', need: 'address' },
              { k: 'category', icon: 'category', label: 'Category screen', need: 'category' },
            ].map((s) => (
              <span
                className={`blk-conf-chip${(b.text || '').includes(`{{${s.k}}}`) ? ' on' : ''}`}
                key={s.k}
                title={`{{${s.k}}} — needs a ${s.label} step earlier in the flow`}
              >
                <span className="material-icons">{s.icon}</span>
                {s.need}
              </span>
            ))}
          </div>
          <div className="blk-conf-order">
            <span className="material-icons">receipt_long</span>
            Saves the order with its own reference, so it lands in Orders.
          </div>
        </div>
      )}

      {/* Where the figures come from. Nothing to configure — it's a reminder
          that an order has to have been chosen before this block runs. */}
      {b.kind === 'orderdetails' && (
        <div className="blk-conf">
          <div className="flow-dyn-note">
            <span className="material-icons">bolt</span>
            Reads the order the customer picked earlier — put this after a
            <strong> My orders</strong> or <strong>Track order</strong> screen. Any
            line whose value is missing is left out.
          </div>
          <div className="blk-conf-src">
            {[
              { k: 'order_id', label: 'reference' },
              { k: 'order_status', label: 'status' },
              { k: 'order_total', label: 'total' },
              { k: 'order_date', label: 'date' },
              { k: 'order_items', label: 'items' },
              { k: 'payment_status', label: 'payment' },
            ].map((s) => (
              <span
                className={`blk-conf-chip${(b.text || '').includes(`{{${s.k}}}`) ? ' on' : ''}`}
                key={s.k}
                title={`{{${s.k}}}`}
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {(b.kind === 'reply'
        || b.kind === 'pdfdoc'
        || b.kind === 'paymethod'
        || b.kind === 'orderconfirm'
        || b.kind === 'orderdetails') && (
        <div className="fl-rows">
          {(b.buttons || []).map((bt, i) => (
            <div className="fl-row reply" key={i}>
              <span className="material-icons fl-row-ic">reply</span>
              <input className="nodrag" value={bt} onChange={(e) => setButton(i, e.target.value)} placeholder="Button" />
              <button className="fl-row-del nodrag" onClick={() => patch({ buttons: (b.buttons || []).filter((_, idx) => idx !== i) })} title="Remove">
                <span className="material-icons">close</span>
              </button>
              <Handle type="source" id={`rbtn-${i}`} position={Position.Right} className="fl-handle row" />
            </div>
          ))}
          {(b.buttons || []).length < 3 && (
            <button className="fl-add-opt nodrag" onClick={() => patch({ buttons: [...(b.buttons || []), `Button ${(b.buttons || []).length + 1}`] })}>
              <span className="material-icons">add</span> Add button
            </button>
          )}
        </div>
      )}

      {b.kind === 'cta' && (
        <div className="fl-fields">
          <input className="nodrag" value={b.ctaLabel || ''} onChange={(e) => patch({ ctaLabel: e.target.value })} placeholder="Button text" />
          <input className="nodrag" value={b.ctaUrl || ''} onChange={(e) => patch({ ctaUrl: e.target.value })} placeholder="https://…" />
        </div>
      )}

      {b.kind === 'call' && (
        <div className="fl-fields">
          <input className="nodrag" value={b.callLabel || ''} onChange={(e) => patch({ callLabel: e.target.value })} placeholder="Button text" />
          <input className="nodrag" value={b.callPhone || ''} onChange={(e) => patch({ callPhone: e.target.value })} placeholder="+91 98765 43210" />
          <div className="fl-call-cta" title="Shown in chat as a call button">
            <span className="material-icons">call</span>
            <span>{b.callLabel || 'Call'}</span>
          </div>
        </div>
      )}

      {b.kind === 'location' && (
        <>
          <div className="fl-loc-btn">
            <span className="material-icons">location_on</span> Send location
          </div>
          <div className="fl-rows">
            <div className="fl-row branch yes">
              <span className="material-icons fl-row-ic ok">check_circle</span>
              <span className="fl-branch-label">Valid</span>
              <Handle type="source" id="valid" position={Position.Right} className="fl-handle row" />
            </div>
            <div className="fl-row branch no">
              <span className="material-icons fl-row-ic bad">cancel</span>
              <span className="fl-branch-label">Not valid</span>
              <Handle type="source" id="invalid" position={Position.Right} className="fl-handle row" />
            </div>
          </div>
        </>
      )}

      {b.kind === 'list' && (
        <div className="fl-rows">
          <input className="fl-list-title nodrag" value={b.listTitle || ''} onChange={(e) => patch({ listTitle: e.target.value })} placeholder="List button label" />
          {(b.options || []).map((o, i) => (
            <div className="fl-row" key={i}>
              <span className="fl-row-num">{i + 1}</span>
              <input className="nodrag" value={o} onChange={(e) => setOption(i, e.target.value)} placeholder="Option" />
              <button className="fl-row-del nodrag" onClick={() => patch({ options: (b.options || []).filter((_, idx) => idx !== i) })} title="Remove">
                <span className="material-icons">close</span>
              </button>
            </div>
          ))}
          {(b.options || []).length < 10 && (
            <button className="fl-add-opt nodrag" onClick={() => patch({ options: [...(b.options || []), `Option ${(b.options || []).length + 1}`] })}>
              <span className="material-icons">add</span> Add option
            </button>
          )}
        </div>
      )}

      {b.kind === 'template' && (
        <input className="fl-list-title nodrag" value={b.templateName || ''} onChange={(e) => patch({ templateName: e.target.value })} placeholder="Approved template name" />
      )}

      {b.kind === 'payment' && (
        <div className="blk-pay">
          <div className="flow-dyn-note">
            <span className="material-icons">bolt</span>
            A real &quot;Review and pay&quot; card. Items and total come from the order; the customer
            pays by UPI inside WhatsApp. The <strong>Paid</strong> wire fires only when the money
            actually arrives, so that&apos;s where the confirmation belongs. Needs a payment
            configuration on this business and something to charge for — a cart, or a fee.
          </div>
          <div className="blk-pay-items dynamic">
            <div className="blk-pay-prow"><span>{'{item}'}</span><span>×{'{qty}'}</span><span>₹{'{price}'}</span></div>
            <div className="blk-pay-prow muted"><span>…</span></div>
          </div>
          <div className="blk-pay-total">Total ₹{'{total}'}</div>
          <div className="blk-pay-wa">
            <span className="material-icons">account_balance_wallet</span> Powered by WhatsApp Pay
          </div>
          <div className="blk-pay-ctas">
            <span className="blk-pay-cta">Review and pay</span>
            <span className="blk-pay-cta">Pay now</span>
          </div>
        </div>
      )}

      {b.kind === 'catalog' && (
        <div className="blk-cat">
          <div className="flow-dyn-note">
            <span className="material-icons">bolt</span>
            Products load live from the selected category&apos;s catalog.
          </div>
          {/* The port on the right fires on the cart, not straight after
              sending — wire it to the Payment type block. */}
          <div className="flow-dyn-note">
            <span className="material-icons">shopping_cart</span>
            Continues when the customer sends their cart — connect the port on
            the right to a Payment type block.
          </div>
          <div className="blk-cat-card">
            <div className="blk-cat-img"><span className="material-icons">storefront</span></div>
            <div className="blk-cat-body">
              <div className="blk-cat-title">{'{category}'}</div>
              <div className="blk-cat-sub">live items</div>
            </div>
          </div>
          <input
            className="fl-list-title nodrag"
            value={b.ctaLabel || ''}
            onChange={(e) => patch({ ctaLabel: e.target.value })}
            placeholder="Button label (e.g. View items)"
          />
          <div className="blk-pay-ctas">
            <span className="blk-pay-cta">{b.ctaLabel || 'View items'}</span>
          </div>
        </div>
      )}

      {BLOCK_SINGLE_OUT.has(b.kind) && (
        <Handle type="source" id="next" position={Position.Right} className="fl-handle" />
      )}
      {/* Payment: one wire per outcome. Labelled, because an unlabelled pair
          of dots gives no clue which is which — and wiring a confirmation to
          the wrong one tells an unpaid customer their order is confirmed. */}
      {BLOCK_OUTCOME_OUT.has(b.kind) && (
        <div className="fl-outcomes">
          <div className="fl-outcome">
            <span className={`fl-outcome-lbl paid${b.nextTarget ? ' on' : ''}`}>Paid</span>
            <Handle type="source" id="next" position={Position.Right} className="fl-handle paid" />
          </div>
          <div className="fl-outcome">
            <span className={`fl-outcome-lbl failed${b.invalidTarget ? ' on' : ''}`}>Not paid</span>
            <Handle type="source" id="invalid" position={Position.Right} className="fl-handle failed" />
          </div>
        </div>
      )}
    </div>
  );
}

// Entry marker. Its single output port designates the flow's first node
// (a screen or a block). At runtime the flow opens on that node.
function StartMapNode() {
  return (
    <div className="map-node start">
      <div className="map-node-title">
        <span className="material-icons" style={{ color: '#107c3f', verticalAlign: 'middle' }}>play_arrow</span> Start
      </div>
      <div className="map-node-sub">Flow entry</div>
      <Handle type="source" id="start" position={Position.Right} className="fl-handle" />
    </div>
  );
}

const mapNodeTypes = { start: StartMapNode, screen: ScreenMapNode, flow: FlowRefNode, block: BlockNode };

/**
 * A connection line with an ✕ button at its middle.
 *
 * React Flow deletes a selected edge on the Delete key, but there was no way
 * to do it with a mouse or on a touchpad — the user had no idea a connection
 * could be removed at all. The button calls back through the edge's `data`,
 * which runs the same disconnect logic as the keyboard path.
 */
function RemovableEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });
  const onRemove = (data as { onRemove?: () => void } | undefined)?.onRemove;
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className="flow-edge-x nodrag nopan"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
          title="Remove this connection"
          aria-label="Remove this connection"
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
const mapEdgeTypes = { removable: RemovableEdge };

/** Identifies which wiring an edge represents, so it can be undone. */
type EdgeRef = { src: 'screen' | 'block' | 'start'; id: string; handle: string };

// The static selection component whose options act as branch ports on the map.
function branchFieldOf(s: FlowScreen): FlowComponent | undefined {
  return s.components.find(
    (c) =>
      SELECTION.has(c.type) &&
      c.source !== 'categories' &&
      c.source !== 'members' &&
      c.source !== 'orders' &&
      c.source !== 'active_orders' &&
      c.source !== 'slots' &&
      c.source !== 'appointments',
  );
}

interface BlockSpec {
  kind: FlowBlockKind;
  buttons?: number;
  header?: FlowBlockHeader;
  // Which document a 'pdfdoc' block starts from. Cancellations and order
  // confirmations are both A4 slips but say opposite things, so each gets its
  // own palette entry and its own seeded template.
  preset?: 'cancel' | 'confirm';
}

/** Fallback wording when no vertical is known (standalone / demo use). */
const DEFAULT_CONFIRM = verticalConfig('other').confirm;

let blkSeq = 1;
function makeBlock(spec: BlockSpec, wording: ConfirmWording = DEFAULT_CONFIRM): FlowBlock {
  const id = `blk_${Date.now().toString(36)}_${blkSeq++}`;
  const b: FlowBlock = { id, kind: spec.kind, header: spec.header || 'none', text: '' };
  switch (spec.kind) {
    case 'message':
      b.text = 'Thanks! We will be in touch shortly.';
      break;
    case 'reply':
      b.text = 'How can we help?';
      b.buttons = Array.from({ length: spec.buttons || 1 }, (_, i) => `Button ${i + 1}`);
      break;
    // Same wire as 'reply', only the wording and buttons start off as a
    // payment question. The costed Items / Delivery / Total payable summary is
    // generated at send time and sits above this text, so all that's stored
    // here is the prompt. Both button labels are editable in the node.
    case 'paymethod':
      b.text = 'Select an option below to confirm.';
      b.buttons = ['Online', 'COD'];
      b.deliveryFee = 0;
      b.showSummary = true;
      b.summaryTitle = 'Payment';
      break;
    case 'cta':
      b.text = 'Check this out';
      b.ctaLabel = 'Open';
      b.ctaUrl = 'https://';
      break;
    case 'call':
      b.text = 'Call us';
      b.callLabel = 'Call';
      b.callPhone = '+91';
      break;
    case 'location':
      b.text = 'Please share your location.';
      break;
    case 'list':
      b.text = 'Choose an option';
      b.listTitle = 'Menu';
      b.options = ['Option 1', 'Option 2'];
      break;
    case 'template':
      b.templateName = '';
      break;
    case 'payment':
      b.text = 'Review your items and pay securely via UPI.';
      b.currency = 'INR';
      break;
    case 'catalog':
      b.text = 'Browse our products. Tap a product for full details, ratings & to add to cart.';
      b.ctaLabel = 'View items';
      break;
    // Everything the conversation captured, in one message. Lines whose live
    // value is empty are dropped at send time, which is what makes the same
    // default work for a delivery business and a walk-in one.
    case 'orderconfirm':
      // Wording comes from the business type: a clinic confirms an appointment
      // with a doctor and a time, a shop confirms a cart with a delivery
      // address. Label-and-colon rather than padded columns, because runs of
      // spaces are collapsed when the live values are filled in.
      b.text = wording.body;
      b.buttons = [];
      break;
    // Reports the record the customer picked earlier. Same rule: a line with no
    // value doesn't get sent, so a business that never records a payment
    // status won't show an empty one.
    case 'orderdetails':
      b.text = wording.detailsBody;
      b.buttons = ['Start'];
      break;
    case 'pdfdoc':
      // One message: the generated PDF, the wording, and reply buttons.
      if (spec.preset === 'confirm') {
        b.text = wording.pdfText;
        b.buttons = ['Start'];
        b.pdfFileName = wording.pdfFileName;
        // The slip layout follows the business type too — a clinic's has no
        // cart, no delivery address and no totals.
        b.pdfTemplate = confirmPdfTemplate(wording.pdf);
      } else {
        // The cancellation slip. Wording follows the business type too — a
        // clinic cancels an appointment, not an order — and it reuses the
        // confirm slip layout with its own heading and note.
        const c = wording.cancel;
        b.text = c.docText;
        b.buttons = ['Start'];
        b.pdfFileName = c.pdfFileName;
        b.pdfTemplate = confirmPdfTemplate({ ...wording.pdf, title: c.pdfTitle, note: c.pdfNote });
      }
      break;
  }
  return b;
}

/**
 * The tenant's vertical, for anything deep in the builder that needs its
 * wording. Passed by context rather than threaded through the map, the node
 * renderers and the inspector, which are several layers apart.
 */
const VerticalCtx = createContext<VerticalConfig>(verticalConfig('other'));
const useVertical = () => useContext(VerticalCtx);

/** Block label, with the confirmation blocks named for the business type. */
function blockLabel(kind: FlowBlockKind, v: VerticalConfig): string {
  if (kind === 'orderconfirm') return v.confirm.label;
  if (kind === 'orderdetails') return v.confirm.detailsLabel;
  return BLOCK_META[kind]?.label || kind;
}

const BLOCK_META: Record<FlowBlockKind, { icon: string; label: string; color: string }> = {
  message: { icon: 'chat', label: 'Message', color: '#0096de' },
  reply: { icon: 'smart_button', label: 'Reply buttons', color: '#8b5cf6' },
  cta: { icon: 'open_in_new', label: 'CTA URL', color: '#0d9488' },
  call: { icon: 'call', label: 'Call button', color: '#f59e0b' },
  location: { icon: 'location_on', label: 'Ask location', color: '#ea4335' },
  list: { icon: 'list', label: 'List menu', color: '#6366f1' },
  template: { icon: 'description', label: 'Template', color: '#107c3f' },
  payment: { icon: 'payments', label: 'Payment (UPI)', color: '#107c3f' },
  catalog: { icon: 'storefront', label: 'Catalog', color: '#0d9488' },
  pdfdoc: { icon: 'picture_as_pdf', label: 'PDF document', color: '#c0392b' },
  restart: { icon: 'restart_alt', label: 'Start over', color: '#25d366' },
  paymethod: { icon: 'account_balance_wallet', label: 'Payment type', color: '#8b5cf6' },
  orderconfirm: { icon: 'task_alt', label: 'Order confirmed', color: '#107c3f' },
  orderdetails: { icon: 'fact_check', label: 'Order details', color: '#0096de' },
};

// Palette of draggable blocks shown on the map (mirrors the Journeys blocks).
const BLOCK_PALETTE: { label: string; icon: string; color: string; spec: BlockSpec }[] = [
  { label: 'Message', icon: 'chat', color: '#0096de', spec: { kind: 'message' } },
  { label: 'Image', icon: 'image', color: '#0096de', spec: { kind: 'message', header: 'image' } },
  { label: 'Video', icon: 'videocam', color: '#0096de', spec: { kind: 'message', header: 'video' } },
  { label: 'Document', icon: 'picture_as_pdf', color: '#0096de', spec: { kind: 'message', header: 'pdf' } },
  { label: '1 reply button', icon: 'smart_button', color: '#8b5cf6', spec: { kind: 'reply', buttons: 1 } },
  { label: '2 reply buttons', icon: 'smart_button', color: '#8b5cf6', spec: { kind: 'reply', buttons: 2 } },
  { label: '3 reply buttons', icon: 'smart_button', color: '#8b5cf6', spec: { kind: 'reply', buttons: 3 } },
  { label: 'CTA URL', icon: 'open_in_new', color: '#0d9488', spec: { kind: 'cta' } },
  { label: 'Call button', icon: 'call', color: '#f59e0b', spec: { kind: 'call' } },
  { label: 'Ask location', icon: 'location_on', color: '#ea4335', spec: { kind: 'location' } },
  { label: 'List menu', icon: 'list', color: '#6366f1', spec: { kind: 'list' } },
  { label: 'Template', icon: 'description', color: '#107c3f', spec: { kind: 'template' } },
  { label: 'Payment (UPI)', icon: 'payments', color: '#107c3f', spec: { kind: 'payment' } },
  { label: 'Catalog', icon: 'storefront', color: '#0d9488', spec: { kind: 'catalog' } },
  // Asks how to pay — image + body + Online / COD buttons, ready to rename.
  { label: 'Payment type', icon: 'account_balance_wallet', color: '#8b5cf6', spec: { kind: 'paymethod', header: 'image' } },
  // Confirmation, two ways: a message on its own, or a message with an A4
  // order slip attached. Businesses that don't want a document use the first.
  { label: 'Order confirmed', icon: 'task_alt', color: '#107c3f', spec: { kind: 'orderconfirm' } },
  { label: 'Order confirmed (PDF)', icon: 'receipt_long', color: '#107c3f', spec: { kind: 'pdfdoc', preset: 'confirm' } },
  // Reports an order the customer picked on a "my orders" / "track order"
  // screen. Starts with an image header, since most businesses brand it.
  { label: 'Order details', icon: 'fact_check', color: '#0096de', spec: { kind: 'orderdetails', header: 'image' } },
  { label: 'Cancellation PDF', icon: 'picture_as_pdf', color: '#c0392b', spec: { kind: 'pdfdoc', preset: 'cancel' } },
  // Wire any ending into this and the conversation begins again from the Start
  // node, the same as the customer typing "hi".
  { label: 'Start over', icon: 'restart_alt', color: '#25d366', spec: { kind: 'restart' } },
];

interface ScreenMapProps {
  screens: FlowScreen[];
  blocks: FlowBlock[];
  flowLinks: FlowLink[];
  allFlows: { _id: string; name: string }[];
  positions: Record<string, { x: number; y: number }>;
  entryTarget: string;
  onConnectStart: (targetNodeId: string) => void;
  onDisconnectStart: () => void;
  onConnectScreen: (fromId: string, handle: string, toId: string) => void;
  onConnectFlow: (fromId: string, handle: string, flowLinkId: string) => void;
  onConnectBlock: (fromId: string, handle: string, blockId: string) => void;
  onConnectFromBlock: (blockId: string, handle: string, targetNodeId: string) => void;
  onDisconnect: (fromId: string, handle: string) => void;
  onDisconnectBlock: (blockId: string, handle: string) => void;
  onSelect: (id: string) => void;
  onBlockChange: (id: string, patch: Partial<FlowBlock>) => void;
  onBlockRemove: (id: string) => void;
  onDesignPdf: (id: string) => void;
  onScreenChange: (id: string, patch: Partial<FlowScreen>) => void;
  onPickFlow: (linkId: string, flowId: string) => void;
  onCreateFlow: (linkId: string) => void;
  onRemoveFlowLink: (linkId: string) => void;
  onMovePos: (id: string, pos: { x: number; y: number }) => void;
  onAddScreen: (pos?: { x: number; y: number }) => void;
  onAddBlock: (spec: BlockSpec, pos?: { x: number; y: number }) => void;
  onAddFlowLink: (pos?: { x: number; y: number }) => void;
}

function ScreenMap(props: ScreenMapProps) {
  return (
    <div className="flow-map">
      <ReactFlowProvider>
        <ScreenMapInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}

function ScreenMapInner({
  screens,
  blocks,
  flowLinks,
  allFlows,
  positions,
  entryTarget,
  onConnectStart,
  onDisconnectStart,
  onConnectScreen,
  onConnectFlow,
  onConnectBlock,
  onConnectFromBlock,
  onDisconnect,
  onDisconnectBlock,
  onSelect,
  onBlockChange,
  onBlockRemove,
  onDesignPdf,
  onScreenChange,
  onPickFlow,
  onCreateFlow,
  onRemoveFlowLink,
  onMovePos,
  onAddScreen,
  onAddBlock,
  onAddFlowLink,
}: ScreenMapProps) {
  const rf = useReactFlow();
  const vertical = useVertical();

  // The callbacks handed to nodes are redefined on every parent render, so
  // depending on them directly would rebuild the whole node array on each
  // keystroke — React Flow would then re-measure every node and the canvas can
  // flicker or come up empty. Keep the live versions in a ref and give the
  // nodes thin wrappers whose identity never changes.
  const cbs = useRef({
    onSelect, onScreenChange, onBlockChange, onBlockRemove, onDesignPdf,
    onPickFlow, onCreateFlow, onRemoveFlowLink,
  });
  cbs.current = {
    onSelect, onScreenChange, onBlockChange, onBlockRemove, onDesignPdf,
    onPickFlow, onCreateFlow, onRemoveFlowLink,
  };
  const stable = useMemo(
    () => ({
      onSelect: (id: string) => cbs.current.onSelect(id),
      onScreenChange: (id: string, p: Partial<FlowScreen>) => cbs.current.onScreenChange(id, p),
      onBlockChange: (id: string, p: Partial<FlowBlock>) => cbs.current.onBlockChange(id, p),
      onBlockRemove: (id: string) => cbs.current.onBlockRemove(id),
      onDesignPdf: (id: string) => cbs.current.onDesignPdf(id),
      onPickFlow: (linkId: string, flowId: string) => cbs.current.onPickFlow(linkId, flowId),
      onCreateFlow: (linkId: string) => cbs.current.onCreateFlow(linkId),
      onRemoveFlowLink: (linkId: string) => cbs.current.onRemoveFlowLink(linkId),
    }),
    [],
  );

  // Nodes derived from the flow definition. This recomputes when the data or a
  // committed position changes — never mid-drag.
  const derived: Node[] = useMemo(() => {
    const list: Node[] = [];
    // Entry point — a single Start node whose output designates the first node.
    list.push({
      id: 'start',
      type: 'start',
      position: positions.start || { x: -200, y: 60 },
      data: {},
      deletable: false,
    });
    screens.forEach((s, i) => {
      const bf = branchFieldOf(s);
      const footer = s.components.find((c) => c.type === 'Footer');
      // Per-option ports AND the footer port, never one instead of the other.
      //
      // This used to be either/or: any static selection on the screen replaced
      // the footer port with one port per option. That silently broke ordinary
      // forms — a Gender dropdown is a question, not a branch, so a booking
      // screen lost its "Continue" port and could not be wired to the slot
      // screen at all.
      //
      // Both is also what the runtime actually does: a chosen option's own
      // target wins when it has one, and the footer is the fallback for every
      // option that doesn't. `connected` drives the styling so unwired ports
      // stand out.
      const optionHandles = (bf?.options || []).map((o) => ({
        id: `opt_${o.id}`,
        label: o.title || o.id,
        connected: !!(o.nextScreen || o.blockId || o.nextFlowId),
      }));
      const footerConnected = !!(footer?.nextScreen || footer?.blockId || footer?.nextFlowId);
      // The footer port is shown while it still has a job to do, which is the
      // only rule that makes sense on both kinds of screen:
      //
      //   • a form (Name, Gender, Age) has options nobody branches, so Continue
      //     is how the screen moves on — without it the screen is unwirable;
      //   • a menu (Pay at hospital / Online) where every option goes somewhere
      //     of its own leaves Continue unreachable, so showing it just invites
      //     a connection that can never fire.
      //
      // An already-wired footer keeps its port regardless, or wiring the last
      // option would strip a port that still has an edge attached to it.
      const allBranched = optionHandles.length > 0 && optionHandles.every((h) => h.connected);
      const handles = [...optionHandles];
      if (!allBranched || footerConnected) {
        handles.push({
          id: 'next',
          label: footer?.buttonLabel || 'Next',
          connected: footerConnected,
        });
      }
      const fieldCount = s.components.filter((c) => c.type !== 'Footer').length;
      list.push({
        id: `screen_${s.id}`,
        type: 'screen',
        position: positions[`screen_${s.id}`] || { x: i * 280, y: 60 },
        data: { title: s.title || s.id, subtitle: `${fieldCount} block${fieldCount === 1 ? '' : 's'}`, handles, screenId: s.id, screen: s, onSelect: stable.onSelect, onChange: stable.onScreenChange },
      });
    });
    blocks.forEach((b, i) => {
      list.push({
        id: `block_${b.id}`,
        type: 'block',
        position: positions[`block_${b.id}`] || { x: 620 + i * 40, y: 320 + i * 180 },
        data: { block: b, onChange: stable.onBlockChange, onRemove: stable.onBlockRemove, onDesignPdf: stable.onDesignPdf },
      });
    });
    flowLinks.forEach((l, i) => {
      list.push({
        id: `flink_${l.id}`,
        type: 'flow',
        position: positions[`flink_${l.id}`] || { x: 920, y: 80 + i * 160 },
        data: { link: l, flows: allFlows, onPickFlow: stable.onPickFlow, onCreateFlow: stable.onCreateFlow, onRemove: stable.onRemoveFlowLink },
      });
    });
    return list;
  }, [screens, blocks, flowLinks, allFlows, positions, stable]);

  // React Flow owns the canvas node state so dragging is smooth: it applies the
  // position changes itself, frame by frame. We mirror `derived` into it when
  // the definition changes, keeping each node's measured size so nothing has to
  // be re-measured (which is what made the canvas flicker/blank before).
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState(derived);
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return derived.map((n) => {
        const old = byId.get(n.id);
        return old ? { ...old, ...n } : n;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived]);

  const edges: Edge[] = useMemo(() => {
    const es: Edge[] = [];
    const line = { animated: true, style: { stroke: '#25d366', strokeWidth: 2 } };
    // Start → entry node.
    if (entryTarget) {
      es.push({ id: 'e_start', source: 'start', sourceHandle: 'start', target: entryTarget, data: { src: 'start', id: 'start', handle: 'start' }, ...line });
    }
    for (const s of screens) {
      const bf = branchFieldOf(s);
      const footer = s.components.find((c) => c.type === 'Footer');
      if (bf) {
        for (const o of bf.options || []) {
          const h = `opt_${o.id}`;
          if (o.nextScreen) es.push({ id: `e_${s.id}_${o.id}_s`, source: `screen_${s.id}`, sourceHandle: h, target: `screen_${o.nextScreen}`, data: { src: 'screen', id: s.id, handle: h }, ...line });
          else if (o.blockId) es.push({ id: `e_${s.id}_${o.id}_b`, source: `screen_${s.id}`, sourceHandle: h, target: `block_${o.blockId}`, data: { src: 'screen', id: s.id, handle: h }, ...line });
          else if (o.nextFlowId) es.push({ id: `e_${s.id}_${o.id}_f`, source: `screen_${s.id}`, sourceHandle: h, target: `flink_${o.nextFlowId}`, data: { src: 'screen', id: s.id, handle: h }, ...line });
        }
      }
      // Not an `else`: a screen can branch per option *and* have a footer
      // destination, which is the fallback for options that don't branch.
      if (footer?.action === 'navigate' && footer.nextScreen) {
        es.push({ id: `e_${s.id}_next`, source: `screen_${s.id}`, sourceHandle: 'next', target: `screen_${footer.nextScreen}`, data: { src: 'screen', id: s.id, handle: 'next' }, ...line });
      }
      if (footer?.nextFlowId) {
        es.push({ id: `e_${s.id}_flow`, source: `screen_${s.id}`, sourceHandle: 'next', target: `flink_${footer.nextFlowId}`, data: { src: 'screen', id: s.id, handle: 'next' }, ...line });
      }
      if (footer?.blockId && !footer.nextScreen) {
        es.push({ id: `e_${s.id}_blk`, source: `screen_${s.id}`, sourceHandle: 'next', target: `block_${footer.blockId}`, data: { src: 'screen', id: s.id, handle: 'next' }, ...line });
      }
    }
    // Block outgoing wiring → their target nodes.
    for (const b of blocks) {
      // Location block valid / not-valid branches.
      if (b.validTarget) es.push({ id: `e_${b.id}_valid`, source: `block_${b.id}`, sourceHandle: 'valid', target: b.validTarget, data: { src: 'block', id: b.id, handle: 'valid' }, ...line });
      if (b.invalidTarget) es.push({ id: `e_${b.id}_invalid`, source: `block_${b.id}`, sourceHandle: 'invalid', target: b.invalidTarget, data: { src: 'block', id: b.id, handle: 'invalid' }, ...line });
      // Single continuation (message / cta / call / template).
      if (b.nextTarget) es.push({ id: `e_${b.id}_next`, source: `block_${b.id}`, sourceHandle: 'next', target: b.nextTarget, data: { src: 'block', id: b.id, handle: 'next' }, ...line });
      // Per reply-button continuations.
      (b.buttonTargets || []).forEach((t, i) => {
        if (t) es.push({ id: `e_${b.id}_rbtn_${i}`, source: `block_${b.id}`, sourceHandle: `rbtn-${i}`, target: t, data: { src: 'block', id: b.id, handle: `rbtn-${i}` }, ...line });
      });
    }
    // Make every edge removable, and hand each one a callback that runs the
    // same disconnect the Delete key would. Done here (not in each push) so the
    // wiring above stays readable.
    return es.map((e) => ({
      ...e,
      type: 'removable',
      data: { ...e.data, onRemove: () => removeEdge(e.data as EdgeRef) },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screens, blocks, entryTarget]);

  // Undo one connection — shared by the ✕ button and the Delete key.
  function removeEdge(d?: EdgeRef) {
    if (!d) return;
    if (d.src === 'start') onDisconnectStart();
    else if (d.src === 'block') onDisconnectBlock(d.id, d.handle);
    else onDisconnect(d.id, d.handle);
  }

  function onConnect(c: Connection) {
    if (!c.source || !c.target) return;
    const handle = c.sourceHandle || 'next';
    // Source is the Start node → set the flow entry target.
    if (c.source === 'start') {
      onConnectStart(c.target);
      return;
    }
    // Source is a block port (valid/invalid, next, rbtn-<i>) → store target id.
    if (c.source.startsWith('block_')) {
      onConnectFromBlock(c.source.replace('block_', ''), handle, c.target);
      return;
    }
    const fromId = c.source.replace('screen_', '');
    if (c.target.startsWith('screen_')) onConnectScreen(fromId, handle, c.target.replace('screen_', ''));
    else if (c.target.startsWith('block_')) onConnectBlock(fromId, handle, c.target.replace('block_', ''));
    else if (c.target.startsWith('flink_')) onConnectFlow(fromId, handle, c.target.replace('flink_', ''));
  }
  // Persist a node's position, ignoring anything non-numeric. A bad value here
  // would push the node off-canvas and make the map look empty.
  const commitPos = (id: string, pos?: { x: number; y: number } | null) => {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
    onMovePos(id, { x: Math.round(pos.x), y: Math.round(pos.y) });
  };

  // Let React Flow apply every change to its own node state — that's what makes
  // the node follow the cursor smoothly. We then persist the position once the
  // drag ends, so the saved layout isn't rewritten on every frame.
  function onNodesChange(changes: NodeChange[]) {
    onNodesChangeInternal(changes);
    for (const ch of changes) {
      if (ch.type === 'position' && ch.dragging === false) commitPos(ch.id, ch.position);
    }
  }
  const onNodeDragStop = (_e: React.MouseEvent, node: Node) => commitPos(node.id, node.position);
  function onEdgesDelete(removed: Edge[]) {
    for (const e of removed) removeEdge(e.data as EdgeRef | undefined);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/flow-palette');
    if (!raw) return;
    const item = JSON.parse(raw) as { type: 'screen' } | { type: 'flow' } | { type: 'block'; spec: BlockSpec };
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (item.type === 'screen') onAddScreen(pos);
    else if (item.type === 'flow') onAddFlowLink(pos);
    else onAddBlock(item.spec, pos);
  }
  function onPaletteDragStart(e: React.DragEvent, payload: unknown) {
    e.dataTransfer.setData('application/flow-palette', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div className="flow-map-layout">
      <aside className="flow-palette map-palette">
        <div className="fp-title">Blocks</div>
        <p className="fp-hint">Drag onto the canvas, then connect the green dots.</p>
        <div className="pal-item" draggable onDragStart={(e) => onPaletteDragStart(e, { type: 'screen' })}>
          <span className="material-icons" style={{ color: '#25d366' }}>smartphone</span> Screen
        </div>
        <div className="pal-item" draggable onDragStart={(e) => onPaletteDragStart(e, { type: 'flow' })}>
          <span className="material-icons" style={{ color: '#6366f1' }}>account_tree</span> Flow hand-off
        </div>
        {BLOCK_PALETTE.map((p) => {
          // Rename the confirmation entries for the business type. The PDF
          // variant keeps its suffix so the two stay distinguishable.
          const label =
            p.spec.kind === 'orderconfirm'
              ? vertical.confirm.label
              : p.spec.kind === 'orderdetails'
                ? vertical.confirm.detailsLabel
                : p.spec.kind === 'pdfdoc' && p.spec.preset === 'confirm'
                  ? `${vertical.confirm.label} (PDF)`
                  : p.spec.kind === 'pdfdoc' && p.spec.preset === 'cancel'
                    ? `${vertical.confirm.cancel.pdfTitle} (PDF)`
                    : p.label;
          return (
            <div key={p.label} className="pal-item" draggable onDragStart={(e) => onPaletteDragStart(e, { type: 'block', spec: p.spec })}>
              <span className="material-icons" style={{ color: p.color }}>{p.icon}</span> {label}
            </div>
          );
        })}
      </aside>
      <div className="flow-map-canvas" onDrop={onDrop} onDragOver={onDragOver}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={mapNodeTypes}
          edgeTypes={mapEdgeTypes}
          onConnect={onConnect}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onEdgesDelete={onEdgesDelete}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          minZoom={0.3}
          defaultEdgeOptions={{ animated: true, style: { stroke: '#25d366', strokeWidth: 2 } }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.6} color="#c9c2b6" />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-component editor card
// ---------------------------------------------------------------------------
function ComponentEditor({
  component: c,
  screenOptions,
  dynamicFields,
  branching = false,
  onChange,
  onRemove,
  onMove,
}: {
  component: FlowComponent;
  screenOptions: KOption[];
  dynamicFields: string[];
  /** True when this screen's options each branch to their own screen. */
  branching?: boolean;
  onChange: (patch: Partial<FlowComponent>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { upload, discard } = useMedia();
  // Matched on type AND data source, skipping the journey presets.
  //
  // Matching on type alone picked whichever palette entry happened to come
  // first, and the presets share their types with real components — so every
  // plain radio list was titled "Cancel order" (then "Reschedule" once that was
  // added) and every text input "Register". A static gender dropdown being
  // labelled "Reschedule" is the visible symptom; the entry it should match is
  // the one with the same source.
  const src = c.source || 'static';
  const meta =
    PALETTE.find((p) => !p.group && p.type === c.type && (p.source || 'static') === src)
    || PALETTE.find((p) => !p.group && p.type === c.type);

  function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const previous = c.src;
    onChange({ src: URL.createObjectURL(f) }); // instant preview
    upload(f)
      .then((url) => {
        onChange({ src: url });
        discard(previous); // replaced → reclaim the old upload
      })
      .catch(() => {});
  }

  function setOption(i: number, patch: Partial<FlowOption>) {
    onChange({ options: (c.options || []).map((o, idx) => (idx === i ? { ...o, ...patch } : o)) });
  }
  function onOptionImage(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const previous = (c.options || [])[i]?.image;
    setOption(i, { image: URL.createObjectURL(f) }); // instant preview
    upload(f)
      .then((url) => {
        setOption(i, { image: url });
        discard(previous);
      })
      .catch(() => {});
  }
  function addOption() {
    const opts = c.options || [];
    onChange({ options: [...opts, { id: `opt_${opts.length + 1}`, title: `Option ${opts.length + 1}`, description: '' }] });
  }
  function removeOption(i: number) {
    discard((c.options || [])[i]?.image);
    onChange({ options: (c.options || []).filter((_, idx) => idx !== i) });
  }

  return (
    <div className="flow-comp">
      <div className="flow-comp-head">
        <span className="material-icons flow-comp-ic">{c.type === 'Footer' ? 'smart_button' : meta?.icon || 'widgets'}</span>
        <span className="flow-comp-title">{c.type === 'Footer' ? 'Footer button' : meta?.label || c.type}</span>
        <div className="flow-comp-tools">
          {c.type !== 'Footer' && (
            <>
              <button onClick={() => onMove(-1)} title="Move up"><span className="material-icons">arrow_upward</span></button>
              <button onClick={() => onMove(1)} title="Move down"><span className="material-icons">arrow_downward</span></button>
              <button onClick={onRemove} title="Remove"><span className="material-icons">delete</span></button>
            </>
          )}
        </div>
      </div>

      {c.type === 'Image' && (
        <div className="flow-img-field">
          <div className="flow-img-tile" onClick={() => fileRef.current?.click()}>
            {c.src ? <img src={c.src} alt="" /> : (
              <div className="flow-upload-hint">
                <span className="material-icons">upload</span>
                <span>Upload 8:1 banner (e.g. 1920×240)</span>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onImage} />
        </div>
      )}

      {TEXTY.has(c.type) && (
        <>
          <input className="k-input" value={c.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="Text" />
          {dynamicFields.length > 0 && (
            <div className="flow-dyn">
              <span className="flow-dyn-label">Insert from earlier screen:</span>
              {dynamicFields.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="flow-dyn-chip"
                  onClick={() => onChange({ text: `${c.text || ''}${c.text ? ' ' : ''}\${data.${f}}` })}
                  title={`Insert \${data.${f}}`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {PICKERS.has(c.type) && (
        <div className="flow-field-row">
          <div className="k-field">
            <label className="k-label">Description</label>
            <input className="k-input" value={c.description || ''} onChange={(e) => onChange({ description: e.target.value })} placeholder="Optional helper text" />
          </div>
          {c.type === 'PhotoPicker' ? (
            <div className="k-field">
              <label className="k-label">Source</label>
              <Dropdown
                options={PHOTO_SOURCES}
                value={c.photoSource || 'camera_gallery'}
                onChange={(v) => onChange({ photoSource: v as 'camera' | 'gallery' | 'camera_gallery' })}
              />
            </div>
          ) : (
            <div className="k-field">
              <label className="k-label">Max files</label>
              <input
                className="k-input"
                type="number"
                min={1}
                value={c.maxFiles || 1}
                onChange={(e) => onChange({ maxFiles: Math.max(1, Number(e.target.value) || 1) })}
              />
            </div>
          )}
        </div>
      )}

      {FIELDY.has(c.type) && (
        <div className="flow-field-row">
          <div className="k-field">
            <label className="k-label">Label</label>
            <input className="k-input" value={c.label || ''} onChange={(e) => onChange({ label: e.target.value })} />
          </div>
          <div className="k-field">
            <label className="k-label">Field name</label>
            <input className="k-input" value={c.name || ''} onChange={(e) => onChange({ name: e.target.value.replace(/\s+/g, '_') })} />
          </div>
        </div>
      )}

      {c.prefill === 'phone' && (
        <div className="flow-dyn-note">
          <span className="material-icons">lock</span>
          Auto-filled with the customer&apos;s WhatsApp number
          {c.locked ? ' and locked so they can’t edit it.' : '.'}
          <button
            type="button"
            className="flow-dyn-chip"
            onClick={() => onChange({ locked: !c.locked })}
            title={c.locked ? 'Allow editing' : 'Lock this field'}
          >
            {c.locked ? 'Unlock' : 'Lock'}
          </button>
        </div>
      )}

      {c.type === 'TextInput' && (
        <div className="flow-field-row">
          <div className="k-field">
            <label className="k-label">Input type</label>
            <Dropdown options={INPUT_TYPES} value={c.inputType || 'text'} onChange={(v) => onChange({ inputType: v as FlowInputType })} />
          </div>
          <div className="k-field">
            <label className="k-label">Helper text</label>
            <input className="k-input" value={c.helperText || ''} onChange={(e) => onChange({ helperText: e.target.value })} />
          </div>
        </div>
      )}

      {c.type === 'DatePicker' && (
        <div className="flow-field-row">
          <div className="k-field">
            <label className="k-label">Latest date (days ahead)</label>
            <input
              className="k-input"
              type="number"
              min={1}
              placeholder="60"
              value={c.maxDaysAhead || ''}
              onChange={(e) => onChange({ maxDaysAhead: Number(e.target.value) || 0 })}
            />
            <div className="k-hint">Past dates are always blocked. This caps how far ahead a date can be picked (default 60).</div>
          </div>
          <div className="k-field">
            <label className="k-label">Helper text</label>
            <input className="k-input" value={c.helperText || ''} placeholder={`Pick a date within the next ${c.maxDaysAhead || 60} days`} onChange={(e) => onChange({ helperText: e.target.value })} />
          </div>
        </div>
      )}

      {FIELDY.has(c.type) && (
        <label className="flow-req">
          <input type="checkbox" checked={!!c.required} onChange={(e) => onChange({ required: e.target.checked })} />
          Required
        </label>
      )}

      {SELECTION.has(c.type) && c.source === 'categories' && (
        <div className="flow-dyn-note">
          <span className="material-icons">bolt</span>
          Rows are loaded live from your catalog categories (name + 1:1 image). This makes the
          flow run in endpoint mode.
        </div>
      )}
      {SELECTION.has(c.type) && c.source === 'members' && (
        <div className="flow-dyn-note">
          <span className="material-icons">bolt</span>
          Rows are loaded live from your Members directory (name, role &amp; photo). If an earlier
          screen used a Category list, only that category&apos;s members are shown. This makes the
          flow run in endpoint mode.
        </div>
      )}
      {SELECTION.has(c.type) && c.source === 'appointments' && (
        <div className="flow-dyn-note">
          <span className="material-icons">bolt</span>
          Rows are this customer&apos;s own upcoming appointments — the doctor, the time and the
          day. Picking one tells a later <strong>Slot list</strong> which doctor to show times
          for, so a reschedule needs no doctor picker. On submit that booking is{' '}
          <strong>moved</strong>, not duplicated. This makes the flow run in endpoint mode.
        </div>
      )}
      {SELECTION.has(c.type) && c.source === 'slots' && (
        <div className="flow-dyn-note">
          <span className="material-icons">bolt</span>
          Times are worked out live from the chosen {''}
          {'member\u2019s'} hours for that weekday, minus anything already booked and
          minus any date they&apos;re unavailable. Needs a <strong>Members list</strong> and a{' '}
          <strong>Date picker</strong> on an earlier screen — without both there is nothing to
          compute from and the list comes back empty. This makes the flow run in endpoint mode.
        </div>
      )}
      {SELECTION.has(c.type) && c.source === 'orders' && (
        <div className="flow-dyn-note">
          <span className="material-icons">bolt</span>
          Rows are loaded live from the customer&apos;s recent orders (reference, total &amp;
          status). This makes the flow run in endpoint mode.
        </div>
      )}
      {SELECTION.has(c.type) && c.source === 'active_orders' && (
        <div className="flow-dyn-note">
          <span className="material-icons">bolt</span>
          Lists only the customer&apos;s <strong>open</strong> orders — delivered and already
          cancelled ones are never shown.
          {c.name === 'cancel_order' ? (
            <> Picking one and confirming <strong>cancels that order</strong>.</>
          ) : (
            <> Rename the field to <code>cancel_order</code> if choosing one should cancel it.</>
          )}
        </div>
      )}

      {SELECTION.has(c.type) && (c.source === 'static' || !c.source) && (
        <div className="flow-options">
          <div className="flow-options-label">Options {screenOptions.length > 0 && '· optionally branch each to a screen'}</div>
          {(c.options || []).map((o, i) => (
            <div className="flow-opt" key={i}>
              <label className="flow-opt-img" title="1:1 image (optional)">
                {o.image ? <img src={o.image} alt="" /> : <span className="material-icons">add_photo_alternate</span>}
                <input type="file" accept="image/*" hidden onChange={(e) => onOptionImage(i, e)} />
              </label>
              <input className="k-input flow-opt-title" value={o.title} onChange={(e) => setOption(i, { title: e.target.value })} placeholder="Title" />
              <input className="k-input flow-opt-desc" value={o.description || ''} onChange={(e) => setOption(i, { description: e.target.value })} placeholder="Description (optional)" />
              {screenOptions.length > 0 && (
                <div className="flow-opt-branch">
                  <Dropdown
                    options={[{ value: '', label: 'No branch' }, ...screenOptions]}
                    value={o.nextScreen || ''}
                    placeholder="→ screen"
                    onChange={(v) => setOption(i, { nextScreen: v || undefined })}
                  />
                </div>
              )}
              <button className="flow-opt-del" onClick={() => removeOption(i)} title="Remove option"><span className="material-icons">close</span></button>
            </div>
          ))}
          <button className="k-btn ghost sm" onClick={addOption}><span className="material-icons">add</span> Add option</button>
        </div>
      )}

      {c.type === 'Footer' && (
        <div className="flow-footer-fields">
          <div className="k-field">
            <label className="k-label">Button label</label>
            <input className="k-input" value={c.buttonLabel || ''} onChange={(e) => onChange({ buttonLabel: e.target.value })} placeholder="Continue" />
          </div>
          {/* When the screen's options each branch to their own screen, the
              destination is decided by whatever the customer picked — a footer
              destination would be meaningless, so we don't offer one. */}
          {branching ? (
            <div className="flow-dyn-note">
              <span className="material-icons">alt_route</span>
              Every option above opens its own screen, so there is nothing left for this button to
              decide. Clear one of those branches and a destination reappears here.
            </div>
          ) : (
            <>
              <div className="k-field">
                <label className="k-label">On tap</label>
                <div className="flow-seg">
                  <button className={`seg${c.action !== 'navigate' ? ' on' : ''}`} onClick={() => onChange({ action: 'complete', nextScreen: undefined })}>
                    Complete flow
                  </button>
                  <button
                    className={`seg${c.action === 'navigate' ? ' on' : ''}`}
                    disabled={screenOptions.length === 0}
                    onClick={() => onChange({ action: 'navigate', nextScreen: screenOptions[0]?.value })}
                  >
                    Go to screen
                  </button>
                </div>
              </div>
              {c.action === 'navigate' && (
                <div className="k-field">
                  <label className="k-label">Next screen</label>
                  <Dropdown options={screenOptions} value={c.nextScreen || ''} placeholder="Select screen" onChange={(v) => onChange({ nextScreen: v })} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp-style phone preview of a single screen
// ---------------------------------------------------------------------------
// Render text with ${data.x}/${form.x} tokens shown as highlighted chips so the
// user can see where a previous screen's value will be injected.
function renderDynamic(text: string) {
  const parts = (text || '').split(/(\$\{(?:data|form)\.[a-zA-Z0-9_]+\})/g);
  return parts.map((p, i) => {
    const m = p.match(/^\$\{(?:data|form)\.([a-zA-Z0-9_]+)\}$/);
    return m ? (
      <span className="fpp-token" key={i}>{m[1]}</span>
    ) : (
      <span key={i}>{p}</span>
    );
  });
}

function PhonePreview({ screen }: { screen?: FlowScreen }) {
  if (!screen) return null;
  const footer = screen.components.find((c) => c.type === 'Footer');
  return (
    <div className="flow-device">
      <div className="flow-device-island" />
      <div className="flow-device-screen">
        <div className="flow-phone">
      <div className="flow-phone-top">
        <span className="material-icons">close</span>
        <span className="flow-phone-ttl">{screen.title || 'Screen'}</span>
        <span className="material-icons">more_horiz</span>
      </div>
      <div className="flow-phone-progress" />
      <div className="flow-phone-body">
        {screen.components.map((c) => {
          switch (c.type) {
            case 'Image':
              return (
                <div className="fpp-banner" key={c.cid}>
                  {c.src ? <img src={c.src} alt="" /> : <span className="material-icons">panorama</span>}
                </div>
              );
            case 'TextHeading':
              return <div className="fpp-heading" key={c.cid}>{renderDynamic(c.text || '')}</div>;
            case 'TextSubheading':
              return <div className="fpp-subheading" key={c.cid}>{renderDynamic(c.text || '')}</div>;
            case 'TextBody':
              return <div className="fpp-body" key={c.cid}>{renderDynamic(c.text || '')}</div>;
            case 'TextCaption':
              return <div className="fpp-caption" key={c.cid}>{renderDynamic(c.text || '')}</div>;
            case 'RadioButtonsGroup':
            case 'CheckboxGroup': {
              const rows = c.source === 'categories'
                ? PREVIEW_CATEGORIES
                : c.source === 'members'
                ? PREVIEW_MEMBERS
                : c.source === 'slots'
                ? PREVIEW_SLOTS
                : c.source === 'appointments'
                ? PREVIEW_APPOINTMENTS
                : c.source === 'active_orders'
                ? PREVIEW_ACTIVE_ORDERS
                : c.source === 'orders'
                  ? PREVIEW_ORDERS
                  : (c.options || []).map((o) => ({ id: o.id, title: o.title, description: o.description, image: o.image || '' }));
              return (
                <div className="fpp-group" key={c.cid}>
                  {c.label && <div className="fpp-field-label">{c.label}</div>}
                  {rows.map((o) => (
                    <div className="fpp-radio" key={o.id}>
                      {'image' in o && o.image && <img className="fpp-radio-img" src={o.image} alt="" />}
                      <div className="fpp-radio-txt">
                        <div className="fpp-radio-title">{o.title}</div>
                        {o.description && <div className="fpp-radio-desc">{o.description}</div>}
                      </div>
                      <span className={`fpp-radio-dot${c.type === 'CheckboxGroup' ? ' sq' : ''}`} />
                    </div>
                  ))}
                </div>
              );
            }
            case 'Dropdown':
              return (
                <div className="fpp-input" key={c.cid}>
                  <div className="fpp-field-label">{c.label}</div>
                  <div className="fpp-dropdown">
                    {c.options?.[0]?.title || 'Select'}
                    <span className="material-icons">expand_more</span>
                  </div>
                </div>
              );
            case 'TextInput':
              return (
                <div className="fpp-input" key={c.cid}>
                  <div className="fpp-field-label">{c.label}{c.required ? ' *' : ''}</div>
                  {c.prefill === 'phone' ? (
                    <div className={`fpp-textbox${c.locked ? ' locked' : ''}`}>
                      +91 98765 43210
                      {c.locked && <span className="material-icons">lock</span>}
                    </div>
                  ) : (
                    <div className="fpp-textbox">{c.helperText || ''}</div>
                  )}
                </div>
              );
            case 'TextArea':
              return (
                <div className="fpp-input" key={c.cid}>
                  <div className="fpp-field-label">{c.label}{c.required ? ' *' : ''}</div>
                  <div className="fpp-textbox tall" />
                </div>
              );
            case 'DatePicker':
              return (
                <div className="fpp-input" key={c.cid}>
                  <div className="fpp-field-label">{c.label}{c.required ? ' *' : ''}</div>
                  <div className="fpp-dropdown">
                    Select date
                    <span className="material-icons">event</span>
                  </div>
                  <div className="fpp-caption">{c.helperText || `Pick a date within the next ${c.maxDaysAhead || 60} days`}</div>
                </div>
              );
            case 'PhotoPicker':
              return (
                <div className="fpp-input" key={c.cid}>
                  <div className="fpp-field-label">{c.label}{c.required ? ' *' : ''}</div>
                  {c.description && <div className="fpp-caption">{c.description}</div>}
                  <div className="fpp-picker">
                    <span className="material-icons">
                      {c.photoSource === 'gallery' ? 'photo_library' : 'photo_camera'}
                    </span>
                    {c.photoSource === 'gallery'
                      ? 'Choose from gallery'
                      : c.photoSource === 'camera'
                        ? 'Take a photo'
                        : 'Camera or gallery'}
                  </div>
                </div>
              );
            case 'DocumentPicker':
              return (
                <div className="fpp-input" key={c.cid}>
                  <div className="fpp-field-label">{c.label}{c.required ? ' *' : ''}</div>
                  {c.description && <div className="fpp-caption">{c.description}</div>}
                  <div className="fpp-picker">
                    <span className="material-icons">upload_file</span>
                    Upload document
                  </div>
                </div>
              );
            default:
              return null;
          }
        })}
      </div>
      <div className="flow-phone-footer">
        <button className="fpp-cta">{footer?.buttonLabel || 'Continue'}</button>
        <div className="fpp-managed">Managed by the business. <span>Learn more</span></div>
      </div>
        </div>
      </div>
      <div className="flow-device-bar" />
    </div>
  );
}
