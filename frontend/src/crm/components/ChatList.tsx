// Left pane: the conversation list.
import { useMemo, useState, useRef, useEffect } from 'react';
import type { Chat, SandboxContacts } from '../types';
import { chatDisplayName, listTime } from '../utils';
import { DefaultAvatar } from './DefaultAvatar';
import { TemplateSearchSvg } from './TemplateIcons';
import { COUNTRIES } from '../../site/PhoneField';
import { CountryFlag } from './CountryFlag';
import { COMING_SOON } from '../features';
import { SoonPill } from './ComingSoon';
import { usePlan } from '../PlanContext';
import './PlanLocked.css';

// Channel tabs above the list: All, WhatsApp, Instagram, Messenger.
type ChannelTab = 'all' | 'whatsapp' | 'instagram' | 'messenger';
const TAB_KEY = 'crm_chats_channel_tab';
const CHANNEL_TABS: { key: ChannelTab; label: string; icon?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'whatsapp', label: 'WhatsApp', icon: '/whatsapp.svg' },
  { key: 'instagram', label: 'Instagram', icon: '/channel-instagram.svg' },
  { key: 'messenger', label: 'Messenger', icon: '/channel-messenger.svg' },
];
const EMPTY_TEXT: Record<ChannelTab, string> = {
  all: 'No chats found',
  whatsapp: 'No WhatsApp chats yet',
  instagram: 'No Instagram chats yet',
  messenger: 'No Messenger chats yet',
};
/** '' and 'whatsapp' are WhatsApp; 'facebook' is Messenger. */
const tabOf = (c: Chat): Exclude<ChannelTab, 'all'> =>
  c.channel === 'instagram' ? 'instagram' : c.channel === 'messenger' || c.channel === 'facebook' ? 'messenger' : 'whatsapp';

interface Props {
  chats: Chat[];
  activePhone: string | null;
  typingPhone?: string | null;
  /** First load still in flight: show placeholder rows instead of "No conversations". */
  loading?: boolean;
  onOpen: (phone: string) => void;
  onAddContact?: (phone: string, name?: string) => void;
  /** On the shared test number: contacts linked out of the limit. null = hidden. */
  sandboxContacts?: SandboxContacts | null;
  /** Opens the connect-your-own-WhatsApp flow. */
  onConnectClick?: () => void;
  needsConnect?: boolean;
}

/** Daily Meta messaging limit bar matching the Campaign Overview KPI card. */
function DailyMessagingLimitBar({
  contacts,
  onConnectClick,
}: {
  contacts: SandboxContacts;
  onConnectClick?: () => void;
}) {
  const { linked, limit, full } = contacts;
  const pct = limit > 0 ? Math.min(100, Math.max(0, Math.round((linked / limit) * 100))) : 0;
  const tip =
    `You're using a WhatsApp test inbox. Up to ${limit} unique contacts can join and chat. ` +
    (full ? 'Your test inbox limit is reached. ' : '') +
    'Connect your own WhatsApp account to remove the limit and unlock higher messaging tiers.';

  return (
    <div className={`chats-limit-card${full ? ' full' : ''}`} data-testid="daily-messaging-limit-card">
      <div className="chats-limit-head">
        <div className="chats-limit-title-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={full ? '#ef4444' : '#24d06e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span className="chats-limit-title">Total Contacts</span>
          <span className="chats-limit-info" title={tip}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="8" cy="8" r="6.25" stroke="#9ca3af" strokeWidth="1.25" />
              <path d="M6.5 6.25C6.5 5.42157 7.17157 4.75 8 4.75C8.82843 4.75 9.5 5.42157 9.5 6.25C9.5 6.84587 9.15175 7.36014 8.64731 7.59918C8.2435 7.79054 8 8.1969 8 8.64453V9" stroke="#9ca3af" strokeWidth="1.25" strokeLinecap="round" />
              <circle cx="8" cy="11.25" r="0.75" fill="#9ca3af" />
            </svg>
          </span>
        </div>
      </div>
      <div className="chats-limit-body">
        <div className="chats-limit-bar">
          <div
            className="chats-limit-bar-fill"
            style={{
              width: `${pct}%`,
              background: full ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#24d06e',
            }}
          />
        </div>
        <div className="chats-limit-bottom-row">
          <span className="chats-limit-stat" data-testid="chats-limit-stat">
            {linked} / {limit} unique contacts{full ? ' · Full' : ''}
          </span>
          <button
            type="button"
            className="chats-limit-connect"
            onClick={onConnectClick}
            title="Connect your own WhatsApp to remove the limit"
          >
            {full ? 'Unlock limit' : 'Connect WhatsApp'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Placeholder rows shown while the chat list loads. */
function ChatSkeleton() {
  return (
    <div className="chat-skeletons" aria-busy="true" aria-label="Loading chats">
      {Array.from({ length: 8 }, (_, i) => (
        <div className="chat-item sk-row" key={i}>
          <span className="sk sk-avatar" />
          <div className="ci-main">
            <div className="ci-top">
              <span className="sk sk-line" style={{ width: `${48 + ((i * 17) % 30)}%` }} />
              <span className="sk sk-line sk-time" />
            </div>
            <div className="ci-bottom">
              <span className="sk sk-line sk-thin" style={{ width: `${62 + ((i * 11) % 26)}%` }} />
              {i % 3 === 0 && <span className="sk sk-pill" />}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}


// Detect a media/system message from the stored preview text and map it to a
// Material icon + clean label (so the list shows an icon, not a raw emoji).
function parsePreview(body: string): { icon: string | null; label: string } {
  const b = body || '';
  const rules: { re: RegExp; icon: string; fallback: string }[] = [
    { re: /^\[image\]\s*/i, icon: 'image', fallback: 'Photo' },
    { re: /^\[video\]\s*/i, icon: 'videocam', fallback: 'Video' },
    { re: /^\[audio\]\s*/i, icon: 'headphones', fallback: 'Audio' },
    { re: /^\[document\]\s*/i, icon: 'description', fallback: 'Document' },
    { re: /^📷\s*/, icon: 'image', fallback: 'Photo' },
    { re: /^🎥\s*/, icon: 'videocam', fallback: 'Video' },
    { re: /^🎤\s*/, icon: 'mic', fallback: 'Voice message' },
    { re: /^🎵\s*/, icon: 'headphones', fallback: 'Audio' },
    { re: /^📄\s*/, icon: 'description', fallback: 'Document' },
    { re: /^📍\s*/, icon: 'location_on', fallback: 'Location' },
    { re: /^🧾\s*/, icon: 'receipt_long', fallback: 'Order' },
    // Markers left by automatic replies.
    { re: /^\[(flow|journey)\]\s*/i, icon: 'smart_toy', fallback: 'Automated reply' },
    { re: /^\[template\]\s*/i, icon: 'description', fallback: 'Template' },
    { re: /^📋\s*/, icon: 'dynamic_form', fallback: 'Form' },
  ];
  for (const r of rules) {
    if (r.re.test(b)) {
      const rest = b.replace(r.re, '').trim();
      return { icon: r.icon, label: rest || r.fallback };
    }
  }
  return { icon: null, label: b };
}

interface AddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (phone: string, name?: string) => void;
}

interface CountryValidationRule {
  min: number;
  max: number;
  exact?: number;
  hint: string;
  placeholder: string;
}

const COUNTRY_RULES: Record<string, CountryValidationRule> = {
  IN: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 98765 43210' },
  US: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 202 555 0123' },
  CA: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 416 555 0123' },
  GB: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 7911 123456' },
  AE: { exact: 9, min: 9, max: 9, hint: '9 digits', placeholder: 'e.g. 50 123 4567' },
  SA: { exact: 9, min: 9, max: 9, hint: '9 digits', placeholder: 'e.g. 50 123 4567' },
  AU: { exact: 9, min: 9, max: 9, hint: '9 digits', placeholder: 'e.g. 412 345 678' },
  SG: { exact: 8, min: 8, max: 8, hint: '8 digits', placeholder: 'e.g. 8123 4567' },
  KW: { exact: 8, min: 8, max: 8, hint: '8 digits', placeholder: 'e.g. 5123 4567' },
  QA: { exact: 8, min: 8, max: 8, hint: '8 digits', placeholder: 'e.g. 3312 3456' },
  OM: { exact: 8, min: 8, max: 8, hint: '8 digits', placeholder: 'e.g. 9123 4567' },
  BH: { exact: 8, min: 8, max: 8, hint: '8 digits', placeholder: 'e.g. 3912 3456' },
  BD: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 1712 345678' },
  NP: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 9841 234567' },
  LK: { exact: 9, min: 9, max: 9, hint: '9 digits', placeholder: 'e.g. 71 234 5678' },
  PK: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 300 1234567' },
  FR: { exact: 9, min: 9, max: 9, hint: '9 digits', placeholder: 'e.g. 6 12 34 56 78' },
  IT: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 312 345 6789' },
  ES: { exact: 9, min: 9, max: 9, hint: '9 digits', placeholder: 'e.g. 612 34 56 78' },
  BR: { exact: 11, min: 11, max: 11, hint: '11 digits', placeholder: 'e.g. 11 91234 5678' },
  MX: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 55 1234 5678' },
  ZA: { exact: 9, min: 9, max: 9, hint: '9 digits', placeholder: 'e.g. 82 123 4567' },
  NG: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 802 123 4567' },
  KE: { exact: 9, min: 9, max: 9, hint: '9 digits', placeholder: 'e.g. 712 345678' },
  PH: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 917 123 4567' },
  JP: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 90 1234 5678' },
  KR: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 10 1234 5678' },
  CN: { exact: 11, min: 11, max: 11, hint: '11 digits', placeholder: 'e.g. 138 1234 5678' },
  RU: { exact: 10, min: 10, max: 10, hint: '10 digits', placeholder: 'e.g. 912 345 6789' },
  MY: { min: 9, max: 10, hint: '9–10 digits', placeholder: 'e.g. 12 345 6789' },
  DE: { min: 10, max: 11, hint: '10–11 digits', placeholder: 'e.g. 151 23456789' },
  ID: { min: 9, max: 12, hint: '9–12 digits', placeholder: 'e.g. 812 3456 7890' },
};

function getCountryRule(country: (typeof COUNTRIES)[number]): CountryValidationRule {
  if (COUNTRY_RULES[country.iso]) return COUNTRY_RULES[country.iso];
  if (country.len) {
    return {
      min: country.len,
      max: country.len,
      exact: country.len,
      hint: `${country.len} digits`,
      placeholder: `e.g. ${country.len}-digit mobile number`,
    };
  }
  return {
    min: 6,
    max: 13,
    hint: '6–13 digits',
    placeholder: 'e.g. Mobile number',
  };
}

function extractNationalDigits(digits: string, dial: string, rule: CountryValidationRule): string {
  let d = digits;
  if (d.startsWith(dial) && (rule.exact ? d.length === dial.length + rule.exact : d.length >= dial.length + rule.min)) {
    d = d.slice(dial.length);
  }
  if (d.startsWith('0') && rule.exact && d.length === rule.exact + 1) {
    d = d.slice(1);
  }
  return d;
}

function AddContactModal({ isOpen, onClose, onAdd }: AddContactModalProps) {
  const [selectedIso, setSelectedIso] = useState('IN');
  const [mobileNumber, setMobileNumber] = useState('');
  const [contactName, setContactName] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [error, setError] = useState('');

  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setMobileNumber('');
      setContactName('');
      setError('');
      setDropdownOpen(false);
      setCountrySearch('');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (dropdownOpen) {
          setDropdownOpen(false);
        } else {
          onClose();
        }
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, dropdownOpen, onClose]);

  const currentCountry = COUNTRIES.find((c) => c.iso === selectedIso) || COUNTRIES[0];
  const rule = useMemo(() => getCountryRule(currentCountry), [currentCountry]);

  const rawDigits = mobileNumber.replace(/\D/g, '');
  const nationalDigits = useMemo(
    () => extractNationalDigits(rawDigits, currentCountry.dial, rule),
    [rawDigits, currentCountry.dial, rule],
  );

  const isValid = useMemo(() => {
    if (rule.exact) {
      return nationalDigits.length === rule.exact;
    }
    return nationalDigits.length >= rule.min && nationalDigits.length <= rule.max;
  }, [nationalDigits, rule]);

  if (!isOpen) return null;

  const filteredCountries = COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      c.dial.includes(countrySearch) ||
      c.iso.toLowerCase().includes(countrySearch.toLowerCase()),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      if (!nationalDigits) {
        setError('Please enter a mobile number');
      } else {
        setError(`Please enter a valid ${rule.hint} for ${currentCountry.name}`);
      }
      return;
    }

    const full = `${currentCountry.dial}${nationalDigits}`;
    onAdd(full, contactName.trim());
    onClose();
  };

  return (
    <div className="ac-modal-overlay" onClick={onClose}>
      <div className="ac-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Top Banner Image with Close Button */}
        <div className="ac-modal-banner-wrap">
          <img
            src="/add_contact_banner.png"
            alt="Add Contact"
            className="ac-modal-banner"
          />
          <button
            type="button"
            className="ac-modal-close-btn"
            onClick={onClose}
            title="Close"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="ac-modal-body">
          <h3 className="ac-modal-title">
            Add a contact to chat on WhatsApp
          </h3>
          <p className="ac-modal-sub">
            Enter customer's country code and mobile number to start a new chat in Kapso CRM.
          </p>

          <form onSubmit={handleSubmit} id="add-contact-form">
            <div className="ac-form-card">
              {/* Country Code & Mobile Number */}
              <div className="ac-field">
                <label className="ac-label">
                  <span>Country Code &amp; Mobile Number</span>
                  <span className={`ac-label-hint${isValid ? ' hint-valid' : nationalDigits.length > 0 ? ' hint-count' : ''}`}>
                    {isValid
                      ? `✓ ${rule.hint}`
                      : nationalDigits.length > 0
                      ? `${nationalDigits.length}/${rule.exact || rule.min} digits`
                      : rule.hint}
                  </span>
                </label>

                <div className={`ac-phone-input-group${error ? ' bad' : ''}${dropdownOpen ? ' is-open' : ''}`} ref={dropdownRef}>
                  {/* Country Code button */}
                  <button
                    type="button"
                    className="ac-country-select-btn"
                    onClick={() => setDropdownOpen((v) => !v)}
                    title="Select Country Code"
                    aria-expanded={dropdownOpen}
                  >
                    <CountryFlag iso={currentCountry.iso} size={20} />
                    <span className="ac-dial-code">+{currentCountry.dial}</span>
                    <span className="ac-chevron">▼</span>
                  </button>

                  {/* Country Dropdown */}
                  {dropdownOpen && (
                    <div className="ac-country-dropdown" onClick={(e) => e.stopPropagation()}>
                      <div className="ac-dropdown-search-box">
                        <svg className="ac-search-icon" width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                          <path d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <input
                          type="text"
                          className="ac-dropdown-search-input"
                          placeholder="Search country or code…"
                          value={countrySearch}
                          onChange={(e) => setCountrySearch(e.target.value)}
                          autoFocus
                        />
                        {countrySearch && (
                          <button
                            type="button"
                            className="ac-search-clear-btn"
                            onClick={() => setCountrySearch('')}
                            title="Clear search"
                            aria-label="Clear search"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <div className="ac-dropdown-list">
                        {filteredCountries.length === 0 ? (
                          <div className="ac-dropdown-empty">
                            No countries found for "{countrySearch}"
                          </div>
                        ) : (
                          filteredCountries.map((c) => {
                            const isSelected = c.iso === selectedIso;
                            return (
                              <button
                                key={`${c.iso}-${c.dial}`}
                                type="button"
                                className={`ac-dropdown-item${isSelected ? ' active' : ''}`}
                                onClick={() => {
                                  setSelectedIso(c.iso);
                                  setDropdownOpen(false);
                                  setCountrySearch('');
                                  inputRef.current?.focus();
                                }}
                              >
                                <div className="ac-dropdown-item-left">
                                  <CountryFlag iso={c.iso} size={20} />
                                  <span className="ac-dropdown-country-name">{c.name}</span>
                                </div>
                                <div className="ac-dropdown-item-right">
                                  <span className="ac-dropdown-dial">+{c.dial}</span>
                                  {isSelected && <span className="ac-dropdown-check">✓</span>}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}

                  {/* Mobile Number text input */}
                  <input
                    ref={inputRef}
                    type="tel"
                    className="ac-mobile-input"
                    placeholder={rule.placeholder}
                    value={mobileNumber}
                    maxLength={rule.max ? rule.max + 5 : 20}
                    onChange={(e) => {
                      setMobileNumber(e.target.value.replace(/[^\d\s-]/g, ''));
                      if (error) setError('');
                    }}
                    autoFocus
                  />
                </div>

                {error && <p className="ac-error-text">{error}</p>}
              </div>

              {/* Contact Name (Optional) */}
              <div className="ac-field">
                <label className="ac-label">
                  <span>Contact Name</span>
                  <span className="ac-label-hint">Optional</span>
                </label>
                <input
                  type="text"
                  className="ac-name-input"
                  placeholder="e.g. Rahul Sharma"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
            </div>
          </form>
        </div>

        {/* Modal Footer */}
        <div className="ac-modal-footer">
          <p className="ac-disclaimer">
            By continuing, you accept{' '}
            <a
              href="https://www.whatsapp.com/legal/business-platform-terms/"
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp Business Platform Terms
            </a>{' '}
            and{' '}
            <a
              href="https://www.whatsapp.com/legal/commerce-policy/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Messaging Policies
            </a>
            .
          </p>

          <button
            type="submit"
            form="add-contact-form"
            className="ac-get-started-btn"
            disabled={!isValid}
          >
            Add Contact
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatList({
  chats,
  activePhone,
  typingPhone,
  loading = false,
  onOpen,
  onAddContact,
  sandboxContacts = null,
  onConnectClick,
  needsConnect = false,
}: Props) {
  const [query, setQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [tab, setTab] = useState<ChannelTab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as ChannelTab | null;
      return saved && CHANNEL_TABS.some((t) => t.key === saved) ? saved : 'all';
    } catch {
      return 'all';
    }
  });
  const pickTab = (t: ChannelTab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };

  // Unread conversations per tab (the badge on each tab).
  const unreadByTab = useMemo(() => {
    const out: Record<ChannelTab, number> = { all: 0, whatsapp: 0, instagram: 0, messenger: 0 };
    for (const c of chats) {
      if (c.unread > 0) {
        out.all += 1;
        out[tabOf(c)] += 1;
      }
    }
    return out;
  }, [chats]);

  const filtered = useMemo(() => {
    const inTab = tab === 'all' ? chats : chats.filter((c) => tabOf(c) === tab);
    const q = query.trim().toLowerCase();
    if (!q) return inTab;
    const digits = q.replace(/\D/g, '');
    return inTab.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.handle || '').toLowerCase().includes(q) ||
        (digits !== '' && c.phone.includes(digits)) ||
        (c.lastMessageBody || '').toLowerCase().includes(q),
    );
  }, [chats, query, tab]);

  const currentContacts =
    sandboxContacts ||
    (needsConnect
      ? {
          linked: chats.length,
          limit: 10,
          full: chats.length >= 10,
        }
      : null);

  const isFull = Boolean(
    needsConnect &&
      (currentContacts?.full ||
        (currentContacts?.linked !== undefined &&
          currentContacts?.limit !== undefined &&
          currentContacts.linked >= currentContacts.limit) ||
        chats.length >= 10),
  );

  // The plan's contact limit (Free: its first 10 contacts). Chats after that
  // arrive locked from the server; adding another contact needs an upgrade.
  const { limits: planLimits, openPlans } = usePlan();
  const planContactLimit = !needsConnect ? planLimits?.contacts ?? null : null;
  const waContacts = chats.filter((c) => !c.channel || c.channel === 'whatsapp').length;
  const lockedCount = chats.filter((c) => c.locked).length;
  const planFull = planContactLimit !== null && waContacts >= planContactLimit;
  const upgradeForContacts = () =>
    openPlans({ tier: 'basic', reason: `The Free plan includes chats with ${planContactLimit} contacts. Basic and up have no limit.` });

  return (
    <>
      <aside className="chats">
        <div className="chats-head">
          <h2>Chats</h2>
          <button
            type="button"
            className={`chats-add-btn${isFull || planFull ? ' is-locked' : ''}`}
            title={isFull
              ? 'Contact limit reached (10/10). Connect WhatsApp to unlock.'
              : planFull
                ? `Your Free plan includes ${planContactLimit} contacts. Upgrade to add more.`
                : 'Add contact / New chat'}
            onClick={() => {
              if (isFull) {
                onConnectClick?.();
              } else if (planFull) {
                upgradeForContacts();
              } else {
                setShowAddModal(true);
              }
            }}
            aria-label={isFull || planFull ? 'Contact limit reached' : 'Add contact'}
            data-testid="chats-add"
          >
            {isFull || planFull ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
        {(needsConnect || sandboxContacts) && (
          <DailyMessagingLimitBar
            contacts={currentContacts || { linked: chats.length, limit: 10, full: chats.length >= 10 }}
            onConnectClick={onConnectClick}
          />
        )}
        {planContactLimit !== null && (
          <div className="plan-contact-bar" data-testid="plan-contact-bar">
            <span className="material-icons" aria-hidden="true">lock</span>
            <span>
              Free plan: chats with {Math.min(waContacts, planContactLimit)}/{planContactLimit} contacts
              {lockedCount > 0 ? ` · ${lockedCount} more waiting` : ''}
            </span>
            <button type="button" className="k-link-btn" onClick={upgradeForContacts}>Upgrade</button>
          </div>
        )}
        <div className="chats-search">
          <div className="cs-pill">
            <span className="cs-search-icon" aria-hidden="true">
              <TemplateSearchSvg width={18} height={18} />
            </span>
            <input
              type="text"
              placeholder="Search or start a new chat"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="cs-clear" onClick={() => setQuery('')} aria-label="Clear search">
                <span className="material-icons">close</span>
              </button>
            )}
          </div>
        </div>
        <div className="chats-tabs" role="tablist" aria-label="Channel">
          {CHANNEL_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`chats-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => pickTab(t.key)}
              title={t.key === 'all' ? 'All chats' : `${t.label} chats`}
              data-testid={`chats-tab-${t.key}`}
            >
              {t.icon && <img src={t.icon} alt="" className="chats-tab-icon" />}
              <span className="chats-tab-text">{t.label}</span>
              {(t.key === 'instagram' || t.key === 'messenger') && COMING_SOON[t.key] && unreadByTab[t.key] === 0 && (
                <span className="material-icons soon-tab-lock" aria-label="Coming soon" data-testid={`chats-tab-soon-${t.key}`}>lock</span>
              )}
              {unreadByTab[t.key] > 0 && (
                <span className="chats-tab-badge" aria-label={`${unreadByTab[t.key]} unread`}>
                  {unreadByTab[t.key] > 99 ? '99+' : unreadByTab[t.key]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="chats-list">
          {loading && chats.length === 0 && <ChatSkeleton />}
          {!loading && filtered.length === 0 && (
            <div className="empty">
              {!query && (tab === 'instagram' || tab === 'messenger') && COMING_SOON[tab] ? (
                <>
                  <SoonPill className="lg" />
                  <p data-testid={`chats-soon-${tab}`}>{tab === 'instagram' ? 'Instagram chats are coming soon' : 'Messenger chats are coming soon'}</p>
                  <small className="chats-empty-hint">
                    {tab === 'instagram' ? 'Instagram Direct messages' : 'Messages to your Facebook Page'} will arrive here once Meta approves it for every business.
                  </small>
                </>
              ) : (
                <>
                  <p>{query ? 'No chats found' : EMPTY_TEXT[tab]}</p>
                  {!query && tab === 'instagram' && (
                    <small className="chats-empty-hint">Direct messages to your connected Instagram account appear here.</small>
                  )}
                  {!query && tab === 'messenger' && (
                    <small className="chats-empty-hint">Messages to your connected Facebook Page appear here.</small>
                  )}
                </>
              )}
              {tab !== 'instagram' && tab !== 'messenger' && query.replace(/\D/g, '').length >= 6 && (
                <button
                  type="button"
                  className="chats-start-new-btn"
                  onClick={() => {
                    if (isFull) {
                      onConnectClick?.();
                      return;
                    }
                    const digits = query.replace(/\D/g, '');
                    onAddContact?.(digits);
                    onOpen(digits);
                    setQuery('');
                  }}
                >
                  {isFull
                    ? 'Limit reached (10/10) · Connect WhatsApp'
                    : `Start chat with +${query.replace(/\D/g, '')}`}
                </button>
              )}
            </div>
          )}
          {filtered.map((c) => {
            const pv = parsePreview(c.lastMessageBody);
            return (
              <button
                key={c.phone}
                className={`chat-item${c.phone === activePhone ? ' active' : ''}${c.unread > 0 ? ' unread' : ''}${c.locked ? ' is-plan-locked' : ''}`}
                onClick={() => onOpen(c.phone)}
                data-locked={c.locked ? 'true' : undefined}
              >
                <DefaultAvatar channel={c.channel || 'whatsapp'} photoUrl={c.avatarUrl} />
                <div className="ci-main">
                  <div className="ci-top">
                    <span className="ci-name">
                      {chatDisplayName(c)}
                      {c.locked && (
                        <span className="ci-plan-lock" title="Upgrade to reply to this contact">
                          <span className="material-icons" aria-hidden="true">lock</span>Upgrade
                        </span>
                      )}
                    </span>
                    <span className="ci-time">{listTime(c.lastMessageAt || c.lastInboundAt)}</span>
                  </div>
                  <div className="ci-bottom">
                    {c.phone === typingPhone ? (
                      <span className="ci-preview typing-text">typing…</span>
                    ) : (
                      <span className="ci-preview">
                        {pv.icon && <span className="material-icons ci-pv-icon">{pv.icon}</span>}
                        <span className="ci-pv-label">{pv.label || 'No messages yet'}</span>
                      </span>
                    )}
                    {c.unread > 0 && (
                      <span className="badge" aria-label={`${c.unread} unread`}>{c.unread > 99 ? '99+' : c.unread}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Add Contact Modal */}
      <AddContactModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={(phone, name) => {
          onAddContact?.(phone, name);
          onOpen(phone);
        }}
      />
    </>
  );
}
