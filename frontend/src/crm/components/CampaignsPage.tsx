// Campaigns view: send an approved template in bulk to a recipient list.
// Modeled on enterprise WhatsApp marketing platforms (Pick Campaign Type,
// Schedule, Dynamic Variable Mapping from Excel/CSV, Live Phone Preview).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CrmApi } from '../api';
import type {
  BusinessProfile, CampaignDetail, CampaignDrip, CampaignInput, CampaignStartRequest, MetaCampaignInitialContent, MetaChannel, TemplateItem,
} from '../types';
import { MetaCampaignCreate } from './MetaCampaignCreate';
import './MetaMessaging.css';
import { Dropdown, type KOption } from './Dropdown';
import { CountryFlag } from './CountryFlag';
import { TemplatePhonePreview, previewPropsFromTemplate } from './TemplatePhonePreview';
import { useNotify, useConfirm } from './Dialogs';
import { CalendarSvg, AddToListSvg, CancelIconSvg, TemplateDraftSvg, SendNowSvg, ContactsSvg } from './TemplateIcons';
import { CampaignOverview } from './CampaignOverview';
import { TemplateComposerPage } from './TemplateComposerPage';
import { CustomDateTimePicker } from './CustomDateTimePicker';
import { CreateDripModal, type DripCampaign, type DripMessageStep } from './CreateDripModal';
import { FlagSvg, COUNTRIES, countryOf, phoneProblem } from '../../site/PhoneField';
import { authBodyWithCode, isAuthTemplate, otpProblem } from '../authTemplate';

interface Props {
  api: CrmApi;
  business?: BusinessProfile;
  demo?: boolean;
  onNavigate?: (view: any) => void;
  /** Open this campaign's results, e.g. from a notification (`n` changes per request). */
  focusRequest?: { id: string; n: number } | null;
  /** Start a new campaign from another page (Templates → Template Library). `n` changes per request. */
  startRequest?: CampaignStartRequest | null;
  onStartRequestHandled?: () => void;
}

type Status = 'queued' | 'sending' | 'sent' | 'failed';

/** A random id for one Send / Schedule click (see submitCampaign). */
function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `cmp-${crypto.randomUUID()}`;
  } catch { /* fall through */ }
  return `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

interface Recipient {
  phone: string;
  name: string;
  status: Status;
  error?: string;
  bodyParams?: string[];
  /** Authentication templates: this contact's code from the file ('' = generated at send time). */
  code?: string;
}

/** ISO date → local "YYYY-MM-DDTHH:mm" datetime-local string */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// Paste your demo-video URL here (YouTube embed, .mp4, etc.) to show it in the demo modal.
const DEMO_VIDEO_URL = '';

// The Excel/CSV reader (~400 KB) is downloaded only when a contact file is uploaded.
const loadXlsx = () => import('xlsx');

/** Extract all variable keys {{1}}, {{2}} from a template */
function extractTemplateVariables(template?: TemplateItem | null): { index: number; name: string; key: string }[] {
  if (!template) return [];
  // Authentication templates take one value, the code (generated per contact when blank).
  if (isAuthTemplate(template)) return [{ index: 1, name: 'code', key: '{{1}}' }];
  const bodyText = template.components?.find((c) => c.type === 'BODY')?.text || template.bodyText || '';
  const matches = [...bodyText.matchAll(/\{\{\s*([\w\d]+)\s*\}\}/g)];
  const seen = new Set<string>();
  const vars: { index: number; name: string; key: string }[] = [];

  matches.forEach((m, idx) => {
    const rawKey = m[1];
    if (seen.has(rawKey)) return;
    seen.add(rawKey);
    const num = parseInt(rawKey, 10);
    const mapped = template.variables?.find((v) => v.index === (Number.isNaN(num) ? idx + 1 : num));
    const varName = (mapped?.source === 'other' && mapped?.name?.trim())
      ? mapped.name.trim()
      : mapped?.name?.trim() || mapped?.source || (num === 1 ? 'Customer Name' : num === 2 ? 'Order / Code' : num === 3 ? 'Discount / Value' : `var${rawKey}`);
    vars.push({
      index: Number.isNaN(num) ? idx + 1 : num,
      name: varName,
      key: `{{${rawKey}}}`,
    });
  });
  return vars;
}

function CountryPickerDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const current = countryOf(value);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.iso.toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <div className="camp-cc-picker-wrap" ref={pickerRef}>
      <button
        type="button"
        className="camp-cc-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Select country code, currently +${current.dial}`}
        title={`${current.name} (+${current.dial})`}
      >
        <span className="au-cc-flag" style={{ marginRight: '3px', width: '20px', height: '14px' }}>
          <FlagSvg iso={current.iso} />
        </span>
        <span className="camp-cc-trigger-text">
          +{current.dial}
        </span>
        <svg width="10" height="10" viewBox="0 0 20 20" fill="none" style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="au-cc-dropdown camp-cc-dropdown" role="listbox">
          <div className="au-cc-search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="au-cc-search-input"
              placeholder="Search country or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="au-cc-options-list">
            {filtered.map((c) => (
              <button
                key={c.iso}
                type="button"
                className={`au-cc-option ${c.iso === current.iso ? 'selected' : ''}`}
                onClick={() => {
                  onChange(c.iso);
                  setOpen(false);
                  setSearch('');
                }}
                role="option"
              >
                <span className="au-cc-flag">
                  <FlagSvg iso={c.iso} />
                </span>
                <span className="au-cc-option-name">{c.name}</span>
                <span className="au-cc-option-dial">+{c.dial}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '12px 10px', fontSize: '12.5px', color: '#94a3b8', textAlign: 'center' }}>
                No countries found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CampaignsPage({ api, business, demo, onNavigate, focusRequest, startRequest, onStartRequestHandled }: Props) {
  const notify = useNotify();
  const confirm = useConfirm();
  const [viewMode, setViewMode] = useState<'overview' | 'create' | 'create-template' | 'meta-create'>('overview');
  // Create template from the Template Library: the page starts filled in from it.
  const [templateSeed, setTemplateSeed] = useState<TemplateItem | null>(null);
  // New campaign → which channel. WhatsApp is the editor below; Messenger /
  // Instagram have their own (MetaCampaignCreate).
  const [channelPickOpen, setChannelPickOpen] = useState(false);
  const [metaChannel, setMetaChannel] = useState<MetaChannel>('messenger');
  const [metaInitial, setMetaInitial] = useState<CampaignDetail | null>(null);
  // "Use in campaign": the quick message / utility template to preselect in a new one.
  const [metaInitialContent, setMetaInitialContent] = useState<MetaCampaignInitialContent | null>(null);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [campaignType, setCampaignType] = useState<'single' | 'drip' | ''>('single');
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1);
    return toLocalInput(d.toISOString());
  });
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const schedulePopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (schedulePopoverRef.current && !schedulePopoverRef.current.contains(e.target as Node)) {
        setIsScheduleOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Drip campaigns state & modal (dummy drips removed)
  const [drips, setDrips] = useState<DripCampaign[]>(() => {
    try {
      const raw = localStorage.getItem('crm_drip_campaigns');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((d: any) => d.id !== 'drip-1' && d.id !== 'drip-2');
        }
      }
    } catch {}
    return [];
  });

  const dripOptions: KOption[] = useMemo(() => {
    return drips.map((d) => ({
      value: d.id,
      label: `${d.name} (${d.messages.length} messages)`,
    }));
  }, [drips]);

  // Clean up legacy dummy drips from localStorage once on load
  useEffect(() => {
    try {
      const raw = localStorage.getItem('crm_drip_campaigns');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter((d: any) => d.id !== 'drip-1' && d.id !== 'drip-2');
          if (cleaned.length !== parsed.length) {
            localStorage.setItem('crm_drip_campaigns', JSON.stringify(cleaned));
          }
        }
      }
    } catch {}
  }, []);

  const [selectedDripId, setSelectedDripId] = useState<string>('');
  const [isDripModalOpen, setIsDripModalOpen] = useState(false);
  const selectedDrip = useMemo(() => drips.find((d) => d.id === selectedDripId) || null, [drips, selectedDripId]);

  /**
   * A resumed drip campaign: select its sequence. One that isn't in this
   * browser's list (another device, or deleted) is added back from what the
   * campaign stored.
   */
  function pickStoredDrip(d: CampaignDrip, campaignId: string) {
    const id = d.id || `drip_${campaignId}`;
    const unitOf = (ms: number): { delay: number; delayUnit: DripMessageStep['delayUnit'] } => {
      if (ms > 0 && ms % 86400000 === 0) return { delay: ms / 86400000, delayUnit: 'Days' };
      if (ms > 0 && ms % 3600000 === 0) return { delay: ms / 3600000, delayUnit: 'Hours' };
      return { delay: Math.round(ms / 60000), delayUnit: 'Minutes' };
    };
    setDrips((list) => {
      if (list.some((x) => x.id === id)) return list;
      const restored: DripCampaign = {
        id,
        name: d.name || 'Drip sequence',
        stopOnReply: d.stopOnReply !== false,
        createdAt: new Date().toISOString(),
        messages: d.steps.map((s, i) => ({ id: `step-${i + 1}`, enabled: true, templateName: s.templateName, ...unitOf(Number(s.delayMs) || 0) })),
      };
      const next = [restored, ...list];
      try {
        localStorage.setItem('crm_drip_campaigns', JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
    setSelectedDripId(id);
  }

  
  function handleSaveDrip(newDrip: DripCampaign) {
    const updated = [newDrip, ...drips];
    setDrips(updated);
    setSelectedDripId(newDrip.id);
    
    try {
      localStorage.setItem('crm_drip_campaigns', JSON.stringify(updated));
    } catch {}
    notify('success', 'Drip Campaign Created', `"${newDrip.name}" has been created and selected.`);
  }

  const [showDirectAdd, setShowDirectAdd] = useState(true);
  const [directIso, setDirectIso] = useState('IN');
  const [directPhone, setDirectPhone] = useState('');
  const [directName, setDirectName] = useState('');
  const [directError, setDirectError] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  // The latest list, readable straight after a change (see mergeRecipients).
  const recipientsRef = useRef<Recipient[]>(recipients);
  recipientsRef.current = recipients;
  // A save/send request is in flight (the sending itself happens on the server).
  const [sending, setSending] = useState(false);
  // Set at once on click (state updates too late to stop a fast double click).
  const inFlightRef = useRef(false);
  const requestIdRef = useRef(newRequestId());
  // The draft or scheduled campaign being edited, when resumed from the overview.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  // Templates and campaigns need the business's own number (the shared test
  // number can't send templates).
  const notConnected = !demo && !!business && !business.whatsappConnected;
  const fileRef = useRef<HTMLInputElement>(null);

  // Not connected yet: the shared test number's sample templates are listed on
  // Template Messages → WhatsApp too (marked Sample). Campaigns can't send them
  // (they go from a chat), so the campaign editor only offers the business's own.
  function reloadTemplates() {
    return api.getTemplates({ includeShared: true }).then((res) => {
      const list = res.data || [];
      setTemplates(list);
    });
  }

  useEffect(() => {
    reloadTemplates();
    // Pre-fill the audience from existing chats for convenience — only if
    // nothing is there yet: a file uploaded or a draft resumed before the chats
    // arrive must not be replaced by them.
    api.getChats().then((res) => {
      // Campaigns are WhatsApp templates: Messenger / Instagram chats have no number.
      const fromChats = (res.data || []).filter((c) => !c.channel || c.channel === 'whatsapp').map((c) => ({
        phone: c.phone,
        name: c.name || `+${c.phone}`,
        status: 'queued' as Status,
      }));
      if (recipientsRef.current.length) return;
      recipientsRef.current = fromChats;
      setRecipients((prev) => (prev.length ? prev : fromChats));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A campaign started from another page (Templates → Template Library).
  useEffect(() => {
    const r = startRequest;
    if (!r) return;
    if (r.channel === 'whatsapp') {
      reloadTemplates();
      setEditingId(null);
      setCampaignName('');
      setCampaignType('');
      setTemplateName(r.templateName || '');
      setViewMode('create');
    } else {
      setMetaChannel(r.channel);
      setMetaInitial(null);
      setMetaInitialContent({ quickMessageId: r.quickMessageId, utilityTemplateId: r.utilityTemplateId });
      setViewMode('meta-create');
    }
    // Handled once: coming back to Campaigns later shows the overview again.
    onStartRequestHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startRequest?.n]);

  // The business's own templates: what a campaign (or a drip) can send.
  const ownTemplates = useMemo(() => templates.filter((t) => !t.shared), [templates]);
  const templateOptions: KOption[] = useMemo(
    () =>
      ownTemplates.map((t) => {
        const cat = t.category ? t.category.charAt(0) + t.category.slice(1).toLowerCase() : 'Marketing';
        const label = t.status === 'APPROVED'
          ? `${t.name} (Meta Approved • ${cat})`
          : `${t.name} (${t.status})`;
        return {
          value: t.name,
          label,
          icon: <TemplateDraftSvg width={16} height={16} />,
        };
      }),
    [ownTemplates],
  );

  const selectedTemplate = ownTemplates.find((t) => t.name === templateName);
  const templateVars = useMemo(() => extractTemplateVariables(selectedTemplate), [selectedTemplate]);
  const isAuth = isAuthTemplate(selectedTemplate);
  // Authentication: a code given for a contact must be one Meta accepts.
  const badCodes = isAuth ? recipients.filter((r) => r.code?.trim() && otpProblem(r.code)) : [];
  const codeProblem = badCodes.length
    ? `A code can be at most 15 characters, with no spaces. Check the code for ${badCodes
        .slice(0, 3)
        .map((r) => `+${r.phone}`)
        .join(', ')}${badCodes.length > 3 ? ', …' : ''}.`
    : '';

  // Limited-time offers
  const offer = selectedTemplate?.kind === 'lto' ? selectedTemplate.lto || null : null;
  const [ltoCode, setLtoCode] = useState('');
  const [ltoEndsAt, setLtoEndsAt] = useState(''); // datetime-local value
  useEffect(() => {
    setLtoCode(offer?.code || '');
    setLtoEndsAt(
      offer?.endsAt && new Date(offer.endsAt).getTime() > Date.now()
        ? toLocalInput(offer.endsAt)
        : toLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateName]);

  const ltoEndMs = ltoEndsAt ? new Date(ltoEndsAt).getTime() : NaN;
  const ltoProblem = !offer
    ? ''
    : offer.hasCopyCode && !ltoCode.trim()
      ? 'Add the offer code for this campaign.'
      : offer.hasExpiration && (Number.isNaN(ltoEndMs) || ltoEndMs <= Date.now())
        ? 'Choose a future end time for the offer.'
        : '';

  const canSend =
    !sending &&
    !notConnected &&
    campaignName.trim().length > 0 &&
    !!selectedTemplate &&
    selectedTemplate.status === 'APPROVED' &&
    !ltoProblem &&
    !codeProblem &&
    recipients.length > 0 &&
    Boolean(campaignType) &&
    (campaignType !== 'drip' || !!selectedDripId);

  // Merge new recipients into list, deduped by phone. Returns how many were new.
  //
  // The count is worked out here, against the list as it is now
  // (recipientsRef), not inside the setRecipients updater: React may run that
  // updater later, after this function has returned, which used to report
  // "No valid phone numbers found" for a file whose contacts were added.
  function mergeRecipients(entries: Recipient[]) {
    const clean = entries
      .map((e) => ({ ...e, phone: (e.phone || '').replace(/\D/g, '') }))
      .filter((e) => e.phone.length >= 8);
    const seen = new Set(recipientsRef.current.map((r) => r.phone));
    const fresh: Recipient[] = [];
    for (const e of clean) {
      if (!seen.has(e.phone)) {
        seen.add(e.phone);
        fresh.push(e);
      }
    }
    if (!fresh.length) return 0;
    recipientsRef.current = [...recipientsRef.current, ...fresh];
    setRecipients((prev) => {
      const have = new Set(prev.map((r) => r.phone));
      return [...prev, ...fresh.filter((e) => !have.has(e.phone))];
    });
    return fresh.length;
  }

  function handleAddDirectContact() {
    const national = directPhone.replace(/\D/g, '');
    const c = countryOf(directIso);
    if (!national) {
      setDirectError('Please enter a phone number');
      return;
    }
    const problem = phoneProblem(directIso, national);
    if (problem) {
      setDirectError(problem);
      return;
    }
    const fullDigits = `${c.dial}${national}`;
    const newEntry: Recipient = {
      phone: fullDigits,
      name: directName.trim() || `+${fullDigits}`,
      status: 'queued',
      // A name isn't a code: an authentication template's code is generated per contact.
      bodyParams: templateVars.length > 0 && !isAuth ? templateVars.map((_, i) => (i === 0 && directName.trim() ? directName.trim() : '')) : undefined,
    };
    const added = mergeRecipients([newEntry]);
    if (added > 0) {
      notify('success', 'Contact Added', `Added +${fullDigits} to campaign.`);
      setDirectPhone('');
      setDirectName('');
      setDirectError('');
    } else {
      setDirectError('This contact is already in your campaign list.');
    }
  }

  // Parse rows from an uploaded CSV/XLSX into Recipient entries.
  // Supports base columns (country, phone, name) + dynamic variable columns (var1, var2...)
  function parseRows(rows: Record<string, unknown>[]): Recipient[] {
    const out: Recipient[] = [];
    for (const row of rows) {
      const entries = Object.entries(row);
      let country = '';
      let phone = '';
      let name = '';
      const extraEntries: { key: string; val: string }[] = [];

      for (const [k, v] of entries) {
        const key = String(k).toLowerCase().trim();
        const val = String(v ?? '').trim();
        if (!country && /(country|dial|isd|ccode|country[_\s]?code)/.test(key)) {
          country = val;
        } else if (!phone && /(phone|mobile|number|whats|wa|contact|msisdn)/.test(key)) {
          const d = val.replace(/\D/g, '');
          if (d.length >= 7 && d.length <= 15) phone = d;
        } else if (!name && /name/.test(key) && val) {
          name = val;
        } else if (val) {
          extraEntries.push({ key, val });
        }
      }
      if (!phone) {
        for (const [, v] of entries) {
          const d = String(v ?? '').replace(/\D/g, '');
          if (d.length >= 7 && d.length <= 15) {
            phone = d;
            break;
          }
        }
      }
      if (!name) {
        for (const [, v] of entries) {
          const s = String(v ?? '').trim();
          if (s && !/^\+?[\d\s()-]{6,}$/.test(s)) {
            name = s;
            break;
          }
        }
      }
      // A country column: added unless the number already starts with it AND
      // is longer than a national number (an Indian mobile can begin with "91").
      // No country column: a national-length number takes the country picked
      // for "Add contact" (India by default), so it isn't sent abroad.
      const cc = country.replace(/\D/g, '') || (phone && phone.length <= 10 ? countryOf(directIso).dial.replace(/\D/g, '') : '');
      phone = phone.replace(/^00(?=\d{8,})/, '');
      if (cc && phone && !(phone.startsWith(cc) && phone.length > 10)) phone = cc + phone;

      // Extract dynamic bodyParams
      const bodyParams: string[] = [];
      if (templateVars.length > 0) {
        for (let i = 0; i < templateVars.length; i++) {
          const tv = templateVars[i];
          const tvNameNorm = tv.name.toLowerCase().trim();
          const tvNameUnderscore = tvNameNorm.replace(/\s+/g, '_');
          const tvNameNoSpace = tvNameNorm.replace(/[\s_]+/g, '');
          const matched =
            extraEntries.find((e) => {
              const k = e.key.toLowerCase().trim();
              const kUnderscore = k.replace(/\s+/g, '_');
              const kNoSpace = k.replace(/[\s_]+/g, '');
              return (
                k === tvNameNorm ||
                kUnderscore === tvNameUnderscore ||
                kNoSpace === tvNameNoSpace ||
                k === `var${i + 1}` ||
                k === `param${i + 1}` ||
                k === `{{${i + 1}}}` ||
                k === `${i + 1}`
              );
            })?.val ||
            (isAuth ? '' : (extraEntries[i] ? extraEntries[i].val : '') || (i === 0 && name ? name : ''));
          bodyParams.push(matched);
        }
      } else if (extraEntries.length > 0) {
        bodyParams.push(...extraEntries.map((e) => e.val));
      }

      if (phone && phone.length >= 8) {
        const code = isAuth ? (bodyParams[0] || '').trim() : '';
        out.push({
          phone,
          name: name || `+${phone}`,
          status: 'queued',
          ...(isAuth
            ? code ? { code, bodyParams: [code] } : {}
            : { bodyParams: bodyParams.length > 0 ? bodyParams : undefined }),
        });
      }
    }
    return out;
  }


  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const [buf, XLSX] = await Promise.all([file.arrayBuffer(), loadXlsx()]);
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      const parsed = parseRows(rows);
      const added = mergeRecipients(parsed);
      if (added > 0) {
        notify('success', 'File Imported', `Imported ${added} contact${added === 1 ? '' : 's'} from ${file.name}.`);
      } else {
        notify('error', 'Import Notice', `No valid phone numbers found in ${file.name}.`);
      }
    } catch {
      notify('error', 'Could not read that file', 'Please upload a .csv, .xlsx or .xls file.');
    }
  }



  async function handleDroppedFile(file: File) {
    try {
      const [buf, XLSX] = await Promise.all([file.arrayBuffer(), loadXlsx()]);
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      const parsed = parseRows(rows);
      const added = mergeRecipients(parsed);
      if (added > 0) {
        notify('success', 'File Imported', `Imported ${added} contact${added === 1 ? '' : 's'} from ${file.name}.`);
      } else {
        notify('error', 'Import Notice', `No valid phone numbers found in ${file.name}.`);
      }
    } catch {
      notify('error', 'Could not read that file', 'Please upload a .csv, .xlsx or .xls file.');
    }
  }

  async function removeRecipient(phone: string, name?: string) {
    const displayName = name && name !== phone ? `${name} (+${phone})` : `+${phone}`;
    const ok = await confirm({
      title: 'Remove Contact?',
      message: `Are you sure you want to remove ${displayName} from this campaign?`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    setRecipients((prev) => prev.filter((r) => r.phone !== phone));
  }

  async function clearAllRecipients() {
    if (recipients.length === 0) return;
    const count = recipients.length;
    const ok = await confirm({
      title: 'Clear All Contacts?',
      message: `Are you sure you want to remove all ${count} contact${count === 1 ? '' : 's'} from this campaign? This action cannot be undone.`,
      confirmLabel: 'Clear All',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    setRecipients([]);
    notify('success', 'Contacts Cleared', `Removed all ${count} contacts.`);
  }

  /** The page's campaign as the server expects it. */
  function campaignInput(mode: CampaignInput['mode']): CampaignInput {
    const sched = scheduledAt ? new Date(scheduledAt) : null;
    const keepSchedule = mode === 'schedule' || (mode === 'draft' && scheduleMode === 'later');
    return {
      name: campaignName.trim() || (selectedTemplate ? selectedTemplate.name.replace(/_/g, ' ') : ''),
      templateName: selectedTemplate?.name || templateName || '',
      language: selectedTemplate?.language || 'en_US',
      type: campaignType === 'drip' ? 'drip' : 'single',
      // The picked sequence goes with the campaign: the server sends its follow-ups.
      ...(campaignType === 'drip' && selectedDrip
        ? {
            drip: {
              id: selectedDrip.id,
              name: selectedDrip.name,
              stopOnReply: selectedDrip.stopOnReply,
              steps: selectedDrip.messages.map((m) => ({ templateName: m.templateName, delay: m.delay, delayUnit: m.delayUnit, enabled: m.enabled })),
            },
          }
        : {}),
      requestId: requestIdRef.current,
      recipients: recipients.map((r) => ({
        phone: r.phone,
        name: r.name,
        // Authentication: only a code from the file; none = a new code per contact.
        ...(isAuth
          ? r.code?.trim() ? { bodyParams: [r.code.trim()] } : {}
          : r.bodyParams && r.bodyParams.length > 0 ? { bodyParams: r.bodyParams } : {}),
      })),
      ...(offer
        ? {
            ...(offer.hasCopyCode ? { ltoCode: ltoCode.trim() } : {}),
            ...(offer.hasExpiration && ltoEndsAt && !Number.isNaN(new Date(ltoEndsAt).getTime())
              ? { ltoExpiresAt: new Date(ltoEndsAt).toISOString() }
              : {}),
          }
        : {}),
      mode,
      ...(keepSchedule && sched && !Number.isNaN(sched.getTime()) ? { scheduledAt: sched.toISOString() } : {}),
    };
  }

  /**
   * Create the campaign, or update the draft/scheduled one being edited.
   * One request at a time (a second click while one is in flight is ignored),
   * and the same `requestId` until it succeeds: if the answer is lost and the
   * user clicks again, the server returns the campaign it already made rather
   * than sending it twice.
   */
  async function submitCampaign(mode: CampaignInput['mode']) {
    // A repeat click while the first is still saving: do nothing (no toast).
    if (inFlightRef.current) return null;
    inFlightRef.current = true;
    setSending(true);
    try {
      const body = campaignInput(mode);
      const res = editingId ? await api.updateCampaign(editingId, body) : await api.createCampaign(body);
      setEditingId(null);
      requestIdRef.current = newRequestId();
      return res.data;
    } finally {
      inFlightRef.current = false;
      setSending(false);
    }
  }

  // Save campaign as draft for later resumption
  async function saveDraftCampaign() {
    if (!campaignName.trim()) {
      notify('error', 'Campaign Name Required', 'Please enter a campaign name to save as draft.');
      return;
    }
    try {
      const saved = await submitCampaign('draft');
      if (!saved) return;
      notify(
        'success',
        'Campaign Saved as Draft',
        `“${saved.name}” has been saved as draft. You can resume or edit it anytime from Overview.`,
      );
      setViewMode('overview');
    } catch (e) {
      notify('error', 'Could not save the draft', (e as Error).message || 'Please try again.');
    }
  }

  // Schedule campaign for future execution (sent by the server when due)
  async function scheduleCampaign() {
    if (!selectedTemplate || recipients.length === 0 || notConnected) return;
    const schedDate = new Date(scheduledAt);
    if (Number.isNaN(schedDate.getTime()) || schedDate.getTime() <= Date.now()) {
      notify('error', 'Invalid schedule time', 'Please pick a future date and time for this campaign.');
      return;
    }
    const when =
      schedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ', ' +
      schedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    try {
      const saved = await submitCampaign('schedule');
      if (!saved) return;
      notify(
        'success',
        'Campaign Scheduled!',
        `“${saved.name}” scheduled for ${when} with ${recipients.length} contacts.`,
      );
      setViewMode('overview');
    } catch (e) {
      notify('error', 'Could not schedule the campaign', (e as Error).message || 'Please try again.');
    }
  }

  // Send now. The server sends it (it keeps going if this tab closes); the
  // overview shows each message's real status as WhatsApp reports it.
  async function send() {
    if (!canSend || !selectedTemplate) return;
    const totalCount = recipients.length;
    try {
      const saved = await submitCampaign('now');
      if (!saved) return;
      notify(
        'success',
        'Campaign Started!',
        `“${saved.name}” is sending to ${totalCount} contact${totalCount === 1 ? '' : 's'}. Delivery results update as WhatsApp reports them.`,
      );
      setViewMode('overview');
    } catch (e) {
      notify('error', 'Could not start the campaign', (e as Error).message || 'Please try again.');
    }
  }

  // Clean rendered preview props with dynamic variable replacement so NO raw {{ }} appears
  const cleanPreviewProps = useMemo(() => {
    if (!selectedTemplate) return null;
    const base = previewPropsFromTemplate(selectedTemplate);
    const sampleRecipient = recipients[0];
    if (isAuthTemplate(selectedTemplate)) {
      return { ...base, body: authBodyWithCode(selectedTemplate, sampleRecipient?.code || '123456'), highlightVars: false };
    }
    let renderedBody = base.body;
    if (renderedBody) {
      renderedBody = renderedBody.replace(/\{\{\s*([\w\d]+)\s*\}\}/g, (_match, p1) => {
        const num = parseInt(p1, 10);
        const idx = Number.isNaN(num) ? 0 : num - 1;
        if (sampleRecipient?.bodyParams && sampleRecipient.bodyParams[idx]) {
          return sampleRecipient.bodyParams[idx];
        }
        if (idx === 0 && sampleRecipient?.name) {
          return sampleRecipient.name;
        }
        const mapped = selectedTemplate.variables?.find((v) => v.index === num);
        return mapped?.fallback || mapped?.name || mapped?.source || (idx === 0 ? 'Alex' : idx === 1 ? 'SAVE20' : 'SPECIAL');
      });
    }
    return {
      ...base,
      body: renderedBody,
      highlightVars: false,
    };
  }, [selectedTemplate, recipients]);

  // Sub-view: Create Template directly inside campaigns
  if (viewMode === 'create-template') {
    return (
      <TemplateComposerPage
        key={templateSeed ? `lib-${templateSeed.name}` : 'new'}
        api={api}
        template={templateSeed}
        prefill={!!templateSeed}
        business={business}
        demo={demo}
        onNavigate={onNavigate}
        onBack={() => setViewMode('overview')}
        onCreated={() => {
          reloadTemplates();
          setViewMode('overview');
        }}
      />
    );
  }

  // Sub-view: a Messenger / Instagram campaign
  if (viewMode === 'meta-create') {
    return (
      <MetaCampaignCreate
        key={metaInitial?._id || `new-${metaChannel}-${metaInitialContent?.quickMessageId || metaInitialContent?.utilityTemplateId || ''}`}
        api={api}
        channel={metaChannel}
        initial={metaInitial}
        initialContent={metaInitial ? null : metaInitialContent}
        onBack={() => setViewMode('overview')}
        onSaved={() => setViewMode('overview')}
        onNavigate={onNavigate}
      />
    );
  }

  // Sub-view: Campaign Overview Dashboard & Template Library
  if (viewMode === 'overview') {
    const pickChannel = (ch: 'whatsapp' | MetaChannel) => {
      setChannelPickOpen(false);
      if (ch === 'whatsapp') {
        setEditingId(null);
        setCampaignName('');
        setCampaignType('');
        setTemplateName('');
        setViewMode('create');
        return;
      }
      setMetaChannel(ch);
      setMetaInitial(null);
      setMetaInitialContent(null);
      setViewMode('meta-create');
    };
    return (
      <>
      <CampaignOverview
        api={api}
        business={business}
        demo={demo}
        focusRequest={focusRequest}
        templates={templates}
        onCreateNew={(tName, draftData) => {
          // Messenger / Instagram draft or scheduled campaign: its own editor.
          // A new one may come with its quick message / utility template preselected ("Use in campaign").
          if (draftData?.channel === 'messenger' || draftData?.channel === 'instagram') {
            setMetaChannel(draftData.channel);
            setMetaInitial(draftData.meta || null);
            setMetaInitialContent(draftData.meta ? null : draftData.initialContent || null);
            setViewMode('meta-create');
            return;
          }
          // Template Messages → WhatsApp → New Campaign: straight to the WhatsApp editor.
          if (draftData?.channel === 'whatsapp' && draftData.fresh) {
            pickChannel('whatsapp');
            return;
          }
          // A brand-new campaign: WhatsApp (Messenger / Instagram campaigns are hidden).
          if (!tName && !draftData && !demo) {
            pickChannel('whatsapp');
            return;
          }
          // Resuming a draft (or a scheduled campaign) edits that row.
          setEditingId(draftData?.id || null);
          if (draftData) {
            setCampaignName(draftData.campaignName || '');
            setCampaignType(draftData.campaignType || 'single');
            setTemplateName(draftData.templateName || tName || '');
            setScheduleMode(draftData.scheduleMode || 'now');
            if (draftData.scheduledAt) setScheduledAt(draftData.scheduledAt);
            if (draftData.recipients) setRecipients(draftData.recipients);
            if (draftData.ltoCode) setLtoCode(draftData.ltoCode);
            if (draftData.ltoEndsAt) setLtoEndsAt(draftData.ltoEndsAt);
            if (draftData.drip) pickStoredDrip(draftData.drip as CampaignDrip, draftData.id || '');
            
          } else if (tName) {
            setTemplateName(tName);
            setCampaignName('');
            setCampaignType('');
            
          } else {
            setCampaignName('');
            setCampaignType('');
            setTemplateName('');
            
          }
          
          setViewMode('create');
        }}
        onCreateTemplate={(from) => {
          setTemplateSeed(from || null);
          setViewMode('create-template');
        }}
        onNavigate={onNavigate}
        onTemplatesChanged={() => { reloadTemplates(); }}
      />
      {channelPickOpen && (
        <div className="mm-backdrop" onClick={() => setChannelPickOpen(false)}>
          <div className="mm-modal camp-channel-modal" role="dialog" aria-modal="true" aria-label="Choose a channel" data-testid="camp-channel-pick" onClick={(e) => e.stopPropagation()}>
            <header className="mm-modal-head">
              <h3>New campaign: choose a channel</h3>
              <button type="button" className="icon-btn" onClick={() => setChannelPickOpen(false)} aria-label="Close">
                <span className="material-icons">close</span>
              </button>
            </header>
            <div className="mm-modal-body">
              {([
                ['whatsapp', 'WhatsApp', '/whatsapp.svg', 'Approved WhatsApp templates to any number, from your own WhatsApp number.'],
              ] as const).map(([key, title, icon, text]) => (
                <button type="button" key={key} className="camp-channel-opt" onClick={() => pickChannel(key)} data-testid={`camp-channel-${key}`}>
                  <img src={icon} alt="" />
                  <div>
                    <strong>{title}</strong>
                    <span>{text}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      </>
    );
  }

  return (
    <div className="page campaign-create-page">
      <header className="page-head campaign-create-head">
        <div className="camp-head-left">
          <button
            className="k-btn ghost sm camp-back-btn"
            onClick={() => setViewMode('overview')}
            title="Back to Campaigns Overview"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Campaigns Overview</span>
          </button>
          <span className="camp-head-sep">/</span>
          <h2>Create New Campaign</h2>
        </div>
        <div className="camp-head-actions">

          <button
            type="button"
            className="k-btn tc-draft-btn camp-top-draft"
            onClick={saveDraftCampaign}
            disabled={sending || !campaignName.trim()}
            title="Save campaign as Draft"
          >
            <TemplateDraftSvg width={18} height={18} />
            <span>Draft</span>
          </button>

          <div className="camp-schedule-popover-wrap" ref={schedulePopoverRef}>
            <button
              type="button"
              className={`k-btn camp-top-schedule-btn${isScheduleOpen ? ' active' : ''}${scheduleMode === 'later' ? ' scheduled' : ''}`}
              onClick={() => setIsScheduleOpen((v) => !v)}
              title="Schedule Campaign"
            >
              <CalendarSvg width={18} height={18} />
              <span>
                {scheduleMode === 'later' && scheduledAt
                  ? `Scheduled: ${new Date(scheduledAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                  : 'Schedule'}
              </span>
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {isScheduleOpen && (
              <div className="camp-schedule-popover">
                <div className="camp-sched-pop-head">
                  <div className="camp-sched-pop-title">
                    <CalendarSvg width={18} height={18} />
                    <span>Schedule Campaign</span>
                  </div>
                  <button
                    type="button"
                    className="camp-sched-pop-close"
                    onClick={() => setIsScheduleOpen(false)}
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <div className="camp-sched-pop-body">
                  <p className="camp-sched-pop-hint">
                    Pick a future date and time for automatic dispatch:
                  </p>
                  <CustomDateTimePicker
                    value={scheduledAt}
                    onChange={(val) => {
                      setScheduledAt(val);
                      setScheduleMode('later');
                    }}
                    showTime={true}
                    hidePastDates={true}
                    align="right"
                  />
                  <div className="camp-sched-pop-actions">
                    <button
                      type="button"
                      className="k-btn ghost sm"
                      onClick={() => {
                        setScheduleMode('now');
                        setIsScheduleOpen(false);
                      }}
                    >
                      Clear Schedule
                    </button>
                    <button
                      type="button"
                      className="k-btn primary sm"
                      disabled={sending || notConnected || !selectedTemplate || recipients.length === 0 || !campaignType}
                      title={notConnected ? 'Connect your own WhatsApp number to send campaigns' : undefined}
                      onClick={() => {
                        setIsScheduleOpen(false);
                        scheduleCampaign();
                      }}
                    >
                      Confirm Schedule
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            className="k-btn camp-top-start-btn"
            onClick={send}
            disabled={!canSend || sending}
            title={
              notConnected
                ? 'Connect your own WhatsApp number to send campaigns'
                : !campaignName.trim()
                ? 'Please enter a Campaign Name'
                : !selectedTemplate
                  ? 'Please select an Approved WhatsApp Template'
                  : selectedTemplate.status !== 'APPROVED'
                    ? 'Selected template must be approved'
                    : ltoProblem
                      ? ltoProblem
                      : codeProblem
                        ? codeProblem
                      : !campaignType
                        ? 'Please choose an Execution Model'
                        : campaignType === 'drip' && !selectedDripId
                          ? 'Please select a Nurture Drip Sequence'
                          : recipients.length === 0
                            ? 'Please upload or enter at least one contact'
                            : 'Start Campaign Now'
            }
          >
            <SendNowSvg width={18} height={18} color="#ffffff" />
            <span>{sending ? 'Saving…' : 'Start Campaign'}</span>
          </button>
        </div>
      </header>

      <div className="composer-split campaign-split">
        <div className="page-body campaign-body">
          <div className="campaign-setup">
            {/* 1. CAMPAIGN NAME */}
            <div className="camp-field-block">
              <label className="camp-field-label" htmlFor="camp-name-input">
                CAMPAIGN NAME <span className="camp-req-star">*</span>
              </label>
              <div className="camp-input-wrap">
                <input
                  id="camp-name-input"
                  className="k-input camp-name-input"
                  value={campaignName}
                  maxLength={50}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="Flash Sales Oct 2026"
                  aria-label="Campaign Name"
                />
                <span className="camp-char-count">{campaignName.length}/50</span>
              </div>
            </div>

            {/* 2. APPROVED WHATSAPP TEMPLATE */}
            <div className="camp-field-block">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label className="camp-field-label" style={{ margin: 0 }}>
                  APPROVED WHATSAPP TEMPLATE <span className="camp-req-star">*</span>
                </label>
                <button
                  type="button"
                  className="camp-manage-tmpl-link"
                  onClick={() => setViewMode('create-template')}
                >
                  + Manage Meta Templates
                </button>
              </div>

              {templateOptions.length ? (
                <Dropdown
                  options={templateOptions}
                  value={templateName}
                  onChange={(val) => setTemplateName(val)}
                  placeholder="Select approved WhatsApp template"
                />
              ) : (
                <p className="page-note">No templates found. Please create or sync templates with Meta.</p>
              )}

              {selectedTemplate && selectedTemplate.status !== 'APPROVED' && (
                <p className="err" style={{ marginTop: '8px' }}>
                  This template is {selectedTemplate.status}. Only APPROVED templates can be sent.
                </p>
              )}

              {isAuth && (
                <p className="k-hint" style={{ marginTop: '8px' }}>
                  Authentication template: each contact gets their own one-time code. Add a <strong>code</strong>{' '}
                  column to your file to choose the codes; otherwise a new 6-digit code is generated for every contact
                  when the campaign sends, and shown in their chat.
                </p>
              )}
              {codeProblem && <p className="err" style={{ marginTop: '8px' }}>{codeProblem}</p>}

              {offer && (offer.hasCopyCode || offer.hasExpiration) && (
                <div className="k-field" style={{ marginTop: '14px', marginBottom: 0 }}>
                  <label className="k-label">Offer for this campaign</label>
                  <div className="camp-offer">
                    {offer.hasCopyCode && (
                      <input
                        className="k-input"
                        value={ltoCode}
                        maxLength={15}
                        placeholder="Offer code"
                        onChange={(e) => {
                          setLtoCode(e.target.value.toUpperCase().replace(/\s+/g, ''));
                        }}
                        aria-label="Offer code"
                      />
                    )}
                    {offer.hasExpiration && (
                      <div className="camp-lto-dt-wrap">
                        <CustomDateTimePicker
                          value={ltoEndsAt || toLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())}
                          onChange={(val) => setLtoEndsAt(val)}
                          showTime={true}
                          hidePastDates={true}
                        />
                      </div>
                    )}
                  </div>
                  {ltoProblem && <p className="err">{ltoProblem}</p>}
                </div>
              )}
            </div>

            {/* 3. EXECUTION MODEL */}
            <div className="camp-field-block">
              <label className="camp-field-label" style={{ marginBottom: '6px' }}>
                EXECUTION MODEL <span className="camp-req-star">*</span>
              </label>
              <div className="camp-exec-grid">
                {/* Option 1: Single Broadcast */}
                <div
                  className={`camp-exec-card camp-exec-single${campaignType === 'single' ? ' selected' : ''}`}
                  onClick={() => setCampaignType('single')}
                  role="button"
                  tabIndex={0}
                >
                  <div className="camp-exec-radio">
                    {campaignType === 'single' && <span className="camp-exec-radio-dot" />}
                  </div>
                  <div className="camp-exec-body">
                    <span className="camp-exec-title">Single Broadcast</span>
                  </div>
                </div>

                {/* Option 2: Multi-Step Drip Sequence */}
                <div
                  className={`camp-exec-card camp-exec-drip${campaignType === 'drip' ? ' selected' : ''}`}
                  onClick={() => {
                    setCampaignType('drip');
                    if (!selectedDripId && drips.length > 0) {
                      setSelectedDripId(drips[0].id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="camp-exec-radio">
                    {campaignType === 'drip' && <span className="camp-exec-radio-dot" />}
                  </div>
                  <div className="camp-exec-body">
                    <span className="camp-exec-title">Multi-Step Drip Sequence</span>
                  </div>
                </div>
              </div>

              {/* If Drip is selected: show Drip Sequence Selector */}
              {campaignType === 'drip' && (
                <div className="camp-drip-picker" style={{ marginTop: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label className="k-label" style={{ margin: 0, fontWeight: 600 }}>
                      Select Nurture Drip Sequence <span className="camp-req-star">*</span>
                    </label>
                    <button
                      type="button"
                      className="camp-new-drip-btn"
                      onClick={() => setIsDripModalOpen(true)}
                    >
                      + New Drip Campaign
                    </button>
                  </div>
                  {dripOptions.length ? (
                    <Dropdown
                      options={dripOptions}
                      value={selectedDripId}
                      onChange={(val) => setSelectedDripId(val)}
                      placeholder="Select a drip campaign..."
                    />
                  ) : (
                    <div className="page-note" style={{ margin: 0 }}>
                      No drip sequences configured yet.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 4. AUDIENCE & UPLOAD CONTACTS */}
            <div className="camp-field-block">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label className="camp-field-label" style={{ margin: 0 }}>
                  AUDIENCE & UPLOAD CONTACTS{recipients.length === 0 && <span className="camp-req-star">*</span>}
                </label>
                <button
                  type="button"
                  className={`camp-plus-contact-btn${showDirectAdd ? ' active' : ''}`}
                  onClick={() => setShowDirectAdd((v) => !v)}
                  title={showDirectAdd ? 'Close manual add' : 'Add direct contact'}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>Add Direct Contact</span>
                </button>
              </div>

              {/* Direct Contact Input Form */}
              {showDirectAdd && (
                <>
                  <div className="camp-direct-add-card">
                  <div className="camp-direct-add-header">
                    <span className="camp-direct-add-title">Add Direct Contact</span>
                    <button
                      type="button"
                      className="camp-direct-add-close"
                      onClick={() => setShowDirectAdd(false)}
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="camp-direct-add-body">
                    <div className="camp-direct-add-row">
                      <div className="camp-direct-country-col">
                        <label className="k-label" style={{ fontSize: '11px', marginBottom: '4px' }}>Country</label>
                        <CountryPickerDropdown
                          value={directIso}
                          onChange={(iso) => {
                            setDirectIso(iso);
                            setDirectError('');
                          }}
                        />
                      </div>

                      <div className="camp-direct-phone-col">
                        <label className="k-label" style={{ fontSize: '11px', marginBottom: '4px' }}>Phone Number</label>
                        <input
                          type="tel"
                          className="k-input camp-direct-phone-input"
                          value={directPhone}
                          onChange={(e) => {
                            setDirectPhone(e.target.value.replace(/\D/g, ''));
                            setDirectError('');
                          }}
                          placeholder={countryOf(directIso).len ? `${countryOf(directIso).len} digits` : 'Phone number'}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddDirectContact();
                            }
                          }}
                        />
                      </div>

                      <div className="camp-direct-name-col">
                        <label className="k-label" style={{ fontSize: '11px', marginBottom: '4px' }}>Name (Optional)</label>
                        <input
                          type="text"
                          className="k-input"
                          value={directName}
                          onChange={(e) => setDirectName(e.target.value)}
                          placeholder="Contact Name"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddDirectContact();
                            }
                          }}
                        />
                      </div>

                      <div className="camp-direct-btn-col">
                        <label className="k-label" style={{ fontSize: '11px', marginBottom: '4px', visibility: 'hidden' }}>Add</label>
                        <button
                          type="button"
                          className="k-btn primary sm camp-direct-submit-btn"
                          onClick={handleAddDirectContact}
                          disabled={!directPhone.trim()}
                        >
                          <AddToListSvg width={16} height={16} />
                          <span>Add</span>
                        </button>
                      </div>
                    </div>

                    {directError && <p className="err" style={{ marginTop: '6px', fontSize: '12px' }}>{directError}</p>}
                  </div>
                </div>

                  <div className="camp-or-divider">
                    <span className="camp-or-badge">or</span>
                  </div>
                </>
              )}

              {/* Dashed Dropzone */}
              <div
                className="camp-dropzone"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleDroppedFile(file);
                }}
              >
                <div className="camp-drop-icon">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                    <polyline points="12 12 12 16" />
                    <polyline points="9 13 12 10 15 13" />
                  </svg>
                </div>
                <div className="camp-drop-text">
                  Upload
                </div>
                <div className="camp-drop-sub">
                  Supports .csv, .xlsx, or .xls files up to 25MB (max 100,000 rows)
                </div>
                <div className="camp-drop-pills">
                  <span className="camp-drop-pill">
                    <span className="camp-drop-dot" /> Required columns:{' '}
                    <strong>
                      country, mobile
                      {!isAuth && templateVars.length > 0
                        ? `, ${templateVars.map((v) => v.name || v.key).join(', ')}`
                        : ''}
                    </strong>
                    {isAuth && <> · optional: <strong>code</strong> (blank = a new code per contact)</>}
                  </span>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={onFile}
                />
              </div>
            </div>
          </div>

          {/* Contacts List */}
          <div className="campaign-list">
            <div className="cl-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ContactsSvg width={18} height={18} />
                <span>Contacts ({recipients.length})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="camp-cl-plus-btn"
                  onClick={() => setShowDirectAdd(true)}
                  title="Add direct contact"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
                {recipients.length > 0 && !sending && (
                  <button
                    type="button"
                    className="k-btn ghost sm"
                    onClick={clearAllRecipients}
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>
            <div className="cl-rows">
              {recipients.length === 0 && (
                <div className="cl-empty-state">
                  <img src="/nocontacts.svg" alt="No contacts" className="cl-empty-img" />
                </div>
              )}
              {recipients.map((r) => {
                return (
                  <div className="cl-row" key={r.phone}>
                    <CountryFlag phone={r.phone} size={20} className="cl-flag" />
                    <div className="cl-main">
                      <div className="cl-name">{r.name}</div>
                      <div className="cl-phone">+{r.phone}</div>
                      {isAuth ? (
                        <div className="cl-var-badges">
                          <span className="cl-var-pill" title="One-time code">
                            {r.code?.trim() ? `Code ${r.code.trim()}` : 'Code: generated when sent'}
                          </span>
                        </div>
                      ) : r.bodyParams && r.bodyParams.length > 0 && (
                        <div className="cl-var-badges">
                          {r.bodyParams.map((v, i) => (
                            <span key={i} className="cl-var-pill" title={`Variable ${i + 1}`}>
                              {v || `[Var ${i + 1}]`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {!sending && (
                      <button
                        type="button"
                        className="cl-del"
                        onClick={() => removeRecipient(r.phone, r.name)}
                        title="Remove"
                      >
                        <CancelIconSvg width={16} height={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Clean WhatsApp preview without raw {{ }} */}
        <div className="composer-preview campaign-preview">
          <div className="campaign-preview-col">
            <div className="campaign-preview-meta">
              <span className="campaign-preview-name" title={selectedTemplate?.name || 'Template preview'}>
                {selectedTemplate?.name || 'Template preview'}
              </span>
              {selectedTemplate && (
                <span className={`k-chip sm ${selectedTemplate.status === 'APPROVED' ? 'green' : 'amber'}`}>
                  {selectedTemplate.status || 'PENDING'}
                </span>
              )}
            </div>
            {cleanPreviewProps ? (
              <TemplatePhonePreview
                {...cleanPreviewProps}
                showTitle={false}
                {...(offer
                  ? {
                      offer: {
                        ...offer,
                        code: ltoCode,
                        endsAt: ltoEndsAt ? new Date(ltoEndsAt).toISOString() : null,
                      },
                    }
                  : {})}
              />
            ) : (
              <TemplatePhonePreview
                header={{ type: 'none' }}
                body=""
                placeholder="Choose an approved template to preview your campaign here."
                showTitle={false}
              />
            )}
          </div>
        </div>
      </div>

      {showDemo && (
        <div className="demo-backdrop" onClick={() => setShowDemo(false)}>
          <div className="demo-box" onClick={(e) => e.stopPropagation()}>
            <div className="demo-head">
              <span>How to upload contacts</span>
              <button className="demo-close" onClick={() => setShowDemo(false)} aria-label="Close">
                <CancelIconSvg width={18} height={18} />
              </button>
            </div>
            <div className="demo-video">
              {DEMO_VIDEO_URL ? (
                /\.(mp4|webm|ogg)$/i.test(DEMO_VIDEO_URL) ? (
                  <video src={DEMO_VIDEO_URL} controls autoPlay />
                ) : (
                  <iframe
                    src={DEMO_VIDEO_URL}
                    title="Demo video"
                    allow="autoplay; encrypted-media; fullscreen"
                    allowFullScreen
                  />
                )
              ) : (
                <div className="demo-placeholder">
                  <span className="material-icons">movie</span>
                  <p>Demo video coming soon.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Drip Campaign Modal (Matching Image 4) */}
      <CreateDripModal
        isOpen={isDripModalOpen}
        onClose={() => setIsDripModalOpen(false)}
        onSave={handleSaveDrip}
        templates={ownTemplates}
      />
    </div>
  );
}
