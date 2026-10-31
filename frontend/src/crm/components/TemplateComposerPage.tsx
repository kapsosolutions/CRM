// Full-page template creator: left = fields, right = large live WhatsApp preview.
// Three kinds, all Meta-approved formats:
//   standard  — header (none/text/image/video/document) + body + footer + buttons
//   carousel  — a message bubble + 2–10 swipeable media cards (Marketing only)
//   lto       — limited-time offer: offer label, countdown, copy-code + link (Marketing only)
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type { BusinessProfile, TemplateItem, TemplateSource, TemplateVariable, TriggerEvent } from '../types';
import { Dropdown, type KOption } from './Dropdown';
import { usePlan } from '../PlanContext';
import { TIER_NAMES, tierFor } from '../plans';
import { TemplatePhonePreview, type PreviewHeader } from './TemplatePhonePreview';
import { AutoSendFields, triggerHasRules, type TriggerDraft } from './TemplateAutoSend';
import { useConfirm, useNotify } from './Dialogs';
import { useBackHandler } from '../useBackHandler';
import { templateReason } from '../templateReasons';
import { TemplateBodyEditor } from './TemplateBodyEditor';
import { TemplateDuplicateSvg, TemplateDraftSvg } from './TemplateIcons';
import { CustomDateTimePicker } from './CustomDateTimePicker';
import { AuthTemplateFields } from './AuthTemplateFields';
import {
  EMPTY_AUTH, authBodyText, authFooterText, authForSubmit, authFromTemplate, authPreviewButtons, authProblem, isAuthTemplate,
} from '../authTemplate';

type ButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
type Kind = 'standard' | 'carousel' | 'lto';
type HeaderType = 'none' | 'text' | 'image' | 'video' | 'document';

interface TemplateButton {
  type: ButtonType;
  text: string;
  url?: string;
  phone?: string;
}
/** A carousel card being composed. Button values line up with `cardButtonTypes`. */
interface CardDraft {
  file: File | null;
  previewUrl: string;
  /** Media already stored for this card (viewing / duplicating a template). */
  existingUrl?: string;
  body: string;
  buttons: { text: string; url: string; phone: string }[];
}

interface Props {
  api: CrmApi;
  onBack: () => void;
  onCreated: () => void;
  /**
   * 'create' (blank, or a duplicate when `template` is given) or 'view': the
   * saved template read-only. Meta reviews every change to a template, so the
   * content isn't edited here — duplicate it to make a new version. Auto-send
   * stays editable, since it's ours and never goes to Meta.
   */
  mode?: 'create' | 'view';
  template?: TemplateItem | null;
  /** View mode: start a new template from this one. */
  onDuplicate?: (t: TemplateItem) => void;
  /** View mode: auto-send was saved, so the list should refresh. */
  onChanged?: () => void;
  /** Register an "are there unsaved changes?" probe with the shell (tab switches). */
  registerDirty?: (fn: (() => boolean) | null) => void;
  business?: BusinessProfile;
  demo?: boolean;
  onNavigate?: (view: any) => void;
  onConnectWhatsApp?: () => void;
  /** Create mode: `template` is a starting point (Template Library), so its name is kept as-is (no "_copy"). */
  prefill?: boolean;
}

const CATEGORY_OPTIONS: KOption[] = [
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'UTILITY', label: 'Utility' },
  { value: 'AUTHENTICATION', label: 'Authentication (one-time code)' },
];
const LANGUAGE_OPTIONS: KOption[] = [
  { value: 'en_US', label: 'English (US)' },
  { value: 'en', label: 'English' },
];

function StandardTemplateSvg() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M6.75 2C5.24011 2 4 3.24011 4 4.75V19.25C4 20.7599 5.24011 22 6.75 22H17.25C18.7599 22 20 20.7599 20 19.25V4.75C20 3.24011 18.7599 2 17.25 2H6.75ZM6.75 3.5H17.25C17.9491 3.5 18.5 4.05089 18.5 4.75V19.25C18.5 19.9491 17.9491 20.5 17.25 20.5H6.75C6.05089 20.5 5.5 19.9491 5.5 19.25V4.75C5.5 4.05089 6.05089 3.5 6.75 3.5ZM7.75 5C7.65062 4.99859 7.55194 5.01696 7.45972 5.05402C7.36749 5.09108 7.28355 5.1461 7.21277 5.21588C7.142 5.28566 7.08579 5.36882 7.04743 5.46051C7.00907 5.5522 6.98932 5.65061 6.98932 5.75C6.98932 5.84939 7.00907 5.9478 7.04743 6.03949C7.08579 6.13118 7.142 6.21434 7.21277 6.28412C7.28355 6.3539 7.36749 6.40892 7.45972 6.44598C7.55194 6.48304 7.65062 6.50141 7.75 6.5H13.25C13.3494 6.50141 13.4481 6.48304 13.5403 6.44598C13.6325 6.40892 13.7164 6.3539 13.7872 6.28412C13.858 6.21434 13.9142 6.13118 13.9526 6.03949C13.9909 5.9478 14.0107 5.84939 14.0107 5.75C14.0107 5.65061 13.9909 5.5522 13.9526 5.46051C13.9142 5.36882 13.858 5.28566 13.7872 5.21588C13.7164 5.1461 13.6325 5.09108 13.5403 5.05402C13.4481 5.01696 13.3494 4.99859 13.25 5H7.75ZM7.75 8C7.55109 8.00002 7.36034 8.07904 7.21969 8.21969C7.07904 8.36034 7.00002 8.55109 7 8.75V18.25C7.00002 18.4489 7.07904 18.6397 7.21969 18.7803C7.36034 18.921 7.55109 19 7.75 19H16.25C16.4489 19 16.6397 18.921 16.7803 18.7803C16.921 18.6397 17 18.4489 17 18.25V8.75C17 8.55109 16.921 8.36034 16.7803 8.21969C16.6397 8.07904 16.4489 8.00002 16.25 8H7.75ZM8.5 9.5H15.5V17.5H8.5V9.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CarouselTemplateSvg() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M8.25 2.5C7.10466 2.5 6.18218 3.3874 6.05078 4.5H4.25C3.01625 4.5 2 5.51625 2 6.75V17.25C2 18.4838 3.01625 19.5 4.25 19.5H6.05078C6.18218 20.6126 7.10466 21.5 8.25 21.5H15.75C16.8953 21.5 17.8178 20.6126 17.9492 19.5H19.75C20.9838 19.5 22 18.4838 22 17.25V6.75C22 5.51625 20.9838 4.5 19.75 4.5H17.9492C17.8178 3.3874 16.8953 2.5 15.75 2.5H8.25ZM8.25 4H15.75C16.1732 4 16.5 4.32675 16.5 4.75V5.12695C16.4868 5.20747 16.4868 5.2896 16.5 5.37012V18.627C16.4868 18.7075 16.4868 18.7896 16.5 18.8701V19.25C16.5 19.6733 16.1732 20 15.75 20H8.25C7.82675 20 7.5 19.6733 7.5 19.25V18.873C7.51323 18.7925 7.51323 18.7104 7.5 18.6299V5.37305C7.51323 5.29253 7.51323 5.2104 7.5 5.12988V4.75C7.5 4.32675 7.82675 4 8.25 4ZM4.25 6H6V18H4.25C3.82675 18 3.5 17.6732 3.5 17.25V6.75C3.5 6.32675 3.82675 6 4.25 6ZM18 6H19.75C20.1733 6 20.5 6.32675 20.5 6.75V17.25C20.5 17.6732 20.1733 18 19.75 18H18V6Z"
        fill="currentColor"
      />
    </svg>
  );
}

function LtoTemplateSvg() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M8.90294 1.99514C8.58693 1.98498 8.25914 2.03047 7.92735 2.16799C7.04252 2.53435 6.643 3.33895 6.33262 4.00979C6.02225 4.68063 5.75385 5.29155 5.52305 5.52248H5.52208C5.26741 5.77745 4.65552 6.05177 3.98985 6.36233C3.32418 6.67289 2.52975 7.05569 2.16856 7.92776C1.80751 8.79989 2.09908 9.63296 2.3502 10.3233C2.60132 11.0136 2.83961 11.6396 2.83946 12C2.83932 12.3267 2.59831 12.9487 2.34337 13.6426C2.08842 14.3365 1.80183 15.1885 2.16856 16.0733C2.53492 16.9581 3.33952 17.3576 4.01036 17.668C4.6812 17.9784 5.29114 18.2468 5.52208 18.4776V18.4785H5.52305C5.77802 18.7332 6.05136 19.3451 6.36192 20.0108C6.67248 20.6764 7.05528 21.4709 7.92735 21.8321C8.79948 22.1931 9.63255 21.9015 10.3229 21.6504C11.0132 21.3993 11.6402 21.161 12.0006 21.1612C12.3272 21.1613 12.9493 21.4023 13.6432 21.6572C14.3371 21.9122 15.1881 22.1988 16.0729 21.8321C16.9577 21.4657 17.3572 20.6611 17.6676 19.9903C17.978 19.3194 18.2473 18.7095 18.4781 18.4785V18.4776C18.7328 18.2226 19.3447 17.9493 20.0104 17.6387C20.676 17.3281 21.4714 16.9453 21.8326 16.0733C22.1937 15.2011 21.9021 14.3681 21.651 13.6778C21.3999 12.9875 21.1606 12.3604 21.1607 12C21.1609 11.6734 21.4029 11.0513 21.6578 10.3574C21.9128 9.66355 22.1994 8.81254 21.8326 7.92776C21.4663 7.04293 20.6617 6.64341 19.9908 6.33303C19.32 6.02265 18.7091 5.75328 18.4781 5.52248C18.2232 5.26782 17.9488 4.65593 17.6383 3.99026C17.3277 3.32458 16.9449 2.52918 16.0729 2.16799C15.2007 1.80694 14.3677 2.09851 13.6774 2.34963C12.987 2.60075 12.361 2.84001 12.0006 2.83987C11.6739 2.83973 11.0519 2.59774 10.358 2.3428C10.0111 2.21532 9.62471 2.08015 9.21446 2.02248C9.1119 2.00807 9.00827 1.99853 8.90294 1.99514ZM8.73399 3.50686C9.00188 3.49369 9.37517 3.58005 9.84044 3.751C10.4608 3.97893 11.1583 4.33951 11.9996 4.33987C12.8497 4.34022 13.5654 3.98606 14.19 3.75881C14.8143 3.53172 15.2691 3.45909 15.4986 3.55373C15.7276 3.64855 15.9978 4.02159 16.2789 4.62405C16.5599 5.2263 16.8165 5.98229 17.4176 6.58303C18.0126 7.17773 18.7612 7.41686 19.3609 7.69436C19.9607 7.97186 20.3387 8.23983 20.4469 8.501V8.50198C20.5552 8.76319 20.4775 9.22048 20.2496 9.84084C20.0217 10.4612 19.6611 11.1587 19.6607 12C19.6604 12.8501 20.0145 13.5658 20.2418 14.1905C20.4691 14.8151 20.5418 15.2697 20.4469 15.499C20.3521 15.728 19.979 15.9983 19.3766 16.2793C18.7743 16.5603 18.0183 16.8169 17.4176 17.418C16.8229 18.0131 16.5838 18.7606 16.3063 19.3604C16.0288 19.9602 15.7608 20.3382 15.4996 20.4463H15.4986C15.2374 20.5546 14.7801 20.478 14.1598 20.25C13.5394 20.0221 12.8419 19.6615 12.0006 19.6612C11.1505 19.6608 10.4349 20.014 9.81016 20.2412C9.18547 20.4685 8.73094 20.5413 8.50157 20.4463C8.27264 20.3515 8.00236 19.9785 7.7213 19.376C7.44023 18.7735 7.18416 18.0178 6.58262 17.417C5.98756 16.8223 5.24002 16.5842 4.64024 16.3067C4.04046 16.0292 3.66244 15.7602 3.5543 15.499C3.44603 15.2378 3.52266 14.7805 3.75059 14.1602C3.97852 13.5398 4.3391 12.8424 4.33946 12.001C4.33981 11.1509 3.98663 10.4353 3.75938 9.81057C3.53229 9.18633 3.45966 8.7315 3.5543 8.50198C3.64912 8.27305 4.02216 8.00277 4.62462 7.7217C5.22707 7.44064 5.98277 7.18457 6.5836 6.58303C7.1783 5.98797 7.41645 5.23945 7.69395 4.63967C7.97145 4.03989 8.2404 3.66187 8.50157 3.55373C8.56687 3.52667 8.64469 3.51125 8.73399 3.50686ZM15.7359 7.49319C15.5412 7.49886 15.3562 7.58012 15.2203 7.71975L7.72032 15.2197C7.64834 15.2889 7.59088 15.3716 7.55129 15.4632C7.5117 15.5548 7.49079 15.6534 7.48977 15.7532C7.48876 15.853 7.50766 15.9519 7.54538 16.0443C7.5831 16.1367 7.63887 16.2206 7.70943 16.2912C7.77998 16.3617 7.86391 16.4175 7.95629 16.4552C8.04868 16.493 8.14766 16.5119 8.24743 16.5108C8.34721 16.5098 8.44579 16.4889 8.53738 16.4493C8.62898 16.4097 8.71176 16.3523 8.78087 16.2803L16.2809 8.7803C16.3891 8.67492 16.4629 8.53933 16.4928 8.39128C16.5227 8.24323 16.5071 8.0896 16.4483 7.95052C16.3894 7.81144 16.2899 7.69337 16.1628 7.61177C16.0357 7.53017 15.8869 7.48884 15.7359 7.49319ZM9.25059 7.50002C8.78646 7.50002 8.34134 7.6844 8.01315 8.01259C7.68497 8.34077 7.50059 8.78589 7.50059 9.25002C7.50059 9.71415 7.68497 10.1593 8.01315 10.4875C8.34134 10.8156 8.78646 11 9.25059 11C9.71472 11 10.1598 10.8156 10.488 10.4875C10.8162 10.1593 11.0006 9.71415 11.0006 9.25002C11.0006 8.78589 10.8162 8.34077 10.488 8.01259C10.1598 7.6844 9.71472 7.50002 9.25059 7.50002ZM14.7506 13C14.2865 13 13.8413 13.1844 13.5132 13.5126C13.185 13.8408 13.0006 14.2859 13.0006 14.75C13.0006 15.2142 13.185 15.6593 13.5132 15.9875C13.8413 16.3156 14.2865 16.5 14.7506 16.5C15.2147 16.5 15.6598 16.3156 15.988 15.9875C16.3162 15.6593 16.5006 15.2142 16.5006 14.75C16.5006 14.2859 16.3162 13.8408 15.988 13.5126C15.6598 13.1844 15.2147 13 14.7506 13Z"
        fill="currentColor"
      />
    </svg>
  );
}

function HeaderTextSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3.5 4H16.5M10 4V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7.5 16H12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function HeaderImageSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2.5" y="3" width="15" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="7" cy="7.5" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M3 14L7.5 10L10.5 12.5L13 10L17 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function HeaderVideoSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="4" width="11" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M13 8L17.5 5.5V14.5L13 12V8Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function HeaderDocumentSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M5 2.5H11L15.5 7V17C15.5 17.8284 14.8284 18.5 14 18.5H5C4.17157 18.5 3.5 17.8284 3.5 17V4C3.5 3.17157 4.17157 2.5 5 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M11 2.5V7H15.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M6 11H13M6 13.5H13M6 16H10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

function HeaderNoneSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 15.5L15.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TemplateLockSvg({ width = 16, height = 16, className = '' }: { width?: number; height?: number; className?: string } = {}) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <rect x="3.5" y="8" width="13" height="9.5" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6.5 8V5.5C6.5 3.567 8.067 2 10 2C11.933 2 13.5 3.567 13.5 5.5V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="10" cy="12.5" r="1" fill="currentColor"/>
      <path d="M10 13.5V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function UploadSvg({ width = 20, height = 20, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <path
        d="M10 13V3M6 7L10 3L14 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 12V15.5C4 16.3284 4.67157 17 5.5 17H14.5C15.3284 17 16 16.3284 16 15.5V12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const KINDS: { value: Kind; label: string; icon: ReactNode; hint: string }[] = [
  { value: 'standard', label: 'Standard', icon: <StandardTemplateSvg />, hint: 'Text, media, buttons' },
  { value: 'carousel', label: 'Carousel', icon: <CarouselTemplateSvg />, hint: '2–10 swipeable cards' },
  { value: 'lto', label: 'Limited-time offer', icon: <LtoTemplateSvg />, hint: 'Countdown + offer code' },
];

const HEADER_CHOICES: { value: HeaderType; label: string; icon: ReactNode }[] = [
  { value: 'none', label: 'None', icon: <HeaderNoneSvg /> },
  { value: 'text', label: 'Text', icon: <HeaderTextSvg /> },
  { value: 'image', label: 'Image', icon: <HeaderImageSvg /> },
  { value: 'video', label: 'Video', icon: <HeaderVideoSvg /> },
  { value: 'document', label: 'Document', icon: <HeaderDocumentSvg /> },
];

const MAX_CARDS = 10;
const emptyCard = (n: number): CardDraft => ({
  file: null,
  previewUrl: '',
  body: '',
  buttons: Array.from({ length: n }, () => ({ text: '', url: '', phone: '' })),
});

function kindLabel(t: ButtonType): string {
  return t === 'URL' ? 'URL' : t === 'PHONE_NUMBER' ? 'Call' : 'Reply';
}
const VAR_RE = /\{\{\s*\d+\s*\}\}/;

/** A horizontal row of selectable options (radio semantics). */
function OptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: T; label: string; icon: string | ReactNode; hint?: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: (v: T) => string | false;
}) {
  return (
    <div className="tc-opts" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const why = disabled?.(o.value) || false;
        const on = o.value === value;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={on}
            key={o.value}
            className={`tc-opt${on ? ' on' : ''}${o.hint ? ' has-hint' : ''}`}
            disabled={!!why}
            title={why || o.hint || o.label}
            onClick={() => onChange(o.value)}
          >
            {typeof o.icon === 'string' ? (
              <span className="material-icons">{o.icon}</span>
            ) : (
              <span className="tc-opt-svg-icon">{o.icon}</span>
            )}
            <span className="tc-opt-text">
              <span className="tc-opt-label">{o.label}</span>
              {o.hint && <span className="tc-opt-hint">{why || o.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** ISO date → the local "YYYY-MM-DDTHH:mm" a datetime-local input expects. */
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const asButtonType = (t: string): ButtonType | null => {
  const k = String(t || '').toUpperCase();
  return k === 'URL' || k === 'PHONE_NUMBER' || k === 'QUICK_REPLY' ? k : null;
};

/**
 * Form values from a saved template (Meta's components + our stored copies).
 * Used to show a template read-only, and to start a duplicate from it.
 */
function seedFrom(t: TemplateItem | null | undefined, duplicate: boolean) {
  const comps = t?.components || [];
  const header = comps.find((c) => c.type === 'HEADER');
  const fmt = String(header?.format || '').toLowerCase();
  const kind: Kind = t?.kind === 'carousel' || t?.kind === 'lto' ? t.kind : 'standard';
  const allButtons = comps.find((c) => c.type === 'BUTTONS')?.buttons || [];
  const toDraft = (b: (typeof allButtons)[number]): TemplateButton | null => {
    const type = asButtonType(b.type);
    return type ? { type, text: b.text || '', url: b.url || '', phone: b.phone || b.phone_number || '' } : null;
  };
  const link = kind === 'lto' ? allButtons.find((b) => asButtonType(b.type) === 'URL') : undefined;
  const firstCard = t?.cards?.[0];
  const cardTypes = (firstCard?.buttons || []).map((b) => asButtonType(b.type)).filter(Boolean) as ButtonType[];

  return {
    name: t ? (duplicate ? `${t.name}_copy`.slice(0, 512) : t.name) : '',
    category: t?.category ? String(t.category).toUpperCase() : 'MARKETING',
    language: t?.language || 'en_US',
    kind,
    headerType: (['text', 'image', 'video', 'document'].includes(fmt) ? fmt : 'none') as HeaderType,
    headerText: fmt === 'text' ? header?.text || '' : '',
    bodyText: comps.find((c) => c.type === 'BODY')?.text || t?.bodyText || '',
    footerText: comps.find((c) => c.type === 'FOOTER')?.text || '',
    buttons: kind === 'standard' ? (allButtons.map(toDraft).filter(Boolean) as TemplateButton[]) : [],
    // The stored copy of the header media; a duplicate re-uses it.
    mediaUrl: fmt && fmt !== 'text' ? t?.headerMediaUrl || '' : '',
    mediaName: fmt === 'document' ? t?.headerFileName || 'Document.pdf' : t?.headerMediaUrl ? `Current ${fmt}` : '',
    cardFormat: (firstCard?.mediaFormat === 'video' ? 'video' : 'image') as 'image' | 'video',
    cardHasText: firstCard ? !!firstCard.body : true,
    cardButtonTypes: cardTypes.length ? cardTypes : (['QUICK_REPLY'] as ButtonType[]),
    cards: t?.cards?.length
      ? t.cards.map((c) => ({
          file: null,
          previewUrl: c.mediaUrl,
          existingUrl: c.mediaUrl,
          body: c.body || '',
          buttons: c.buttons.map((b) => ({ text: b.text || '', url: b.url || '', phone: b.phone || '' })),
        }))
      : [emptyCard(1), emptyCard(1)],
    ltoText: t?.lto?.text || '',
    ltoHasExpiration: t?.lto ? !!t.lto.hasExpiration : true,
    // A fresh end time (tomorrow); an old one has likely passed.
    ltoEndsAt: duplicate
      ? toLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
      : t?.lto?.endsAt
        ? toLocalInput(t.lto.endsAt)
        : toLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
    ltoHasCode: t?.lto ? !!t.lto.hasCopyCode : true,
    ltoCode: t?.lto?.code || '',
    ltoLinkText: link?.text || '',
    ltoLinkUrl: link?.url || '',
    variables: t?.variables || [],
    auth: isAuthTemplate(t) ? authFromTemplate(t) : { ...EMPTY_AUTH },
    trigger: {
      enabled: !!t?.trigger?.enabled,
      keywords: t?.trigger?.keywords || [],
      statuses: t?.trigger?.statuses || [],
      events: t?.trigger?.events || [],
    } as TriggerDraft,
  };
}

const STATUS_TONE: Record<string, string> = { APPROVED: 'green', REJECTED: 'red', PAUSED: 'grey', DISABLED: 'grey', DRAFT: 'amber' };

export function TemplateComposerPage({
  api,
  onBack,
  onCreated,
  mode = 'create',
  template = null,
  onDuplicate,
  onChanged,
  registerDirty,
  business,
  demo: _demo,
  onNavigate,
  onConnectWhatsApp,
  prefill = false,
}: Props) {
  const readOnly = mode === 'view';
  const notify = useNotify();
  const confirm = useConfirm();

  const isWhatsAppConnected = Boolean(business?.whatsappConnected || (business?.phoneNumberId && business?.hasAccessToken));

  // Seeded once: from the template being viewed / duplicated, else blank.
  const [seed] = useState(() => seedFrom(template, mode === 'create' && !!template && !prefill));

  const [name, setName] = useState(seed.name);
  const [category, setCategory] = useState(seed.category);
  const [language, setLanguage] = useState(seed.language);
  const [kind, setKind] = useState<Kind>(seed.kind);
  const [headerType, setHeaderType] = useState<HeaderType>(seed.headerType);
  const [headerText, setHeaderText] = useState(seed.headerText);
  const [bodyText, setBodyText] = useState(seed.bodyText);
  const [footerText, setFooterText] = useState(seed.footerText);
  const [buttons, setButtons] = useState<TemplateButton[]>(seed.buttons);

  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaName, setMediaName] = useState(seed.mediaName);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState(seed.mediaUrl);
  // Already-stored header media (viewing / duplicating). Cleared when a new
  // file is picked or the header type changes.
  const [existingMediaUrl, setExistingMediaUrl] = useState(seed.mediaUrl);

  // ---- Carousel ----
  const [cardFormat, setCardFormat] = useState<'image' | 'video'>(seed.cardFormat);
  const [cardHasText, setCardHasText] = useState(seed.cardHasText);
  const [cardButtonTypes, setCardButtonTypes] = useState<ButtonType[]>(seed.cardButtonTypes);
  const [cards, setCards] = useState<CardDraft[]>(seed.cards);

  // ---- Limited-time offer ----
  const [ltoText, setLtoText] = useState(seed.ltoText);
  const [ltoHasExpiration, setLtoHasExpiration] = useState(seed.ltoHasExpiration);
  const [ltoEndsAt, setLtoEndsAt] = useState(seed.ltoEndsAt);
  const [ltoHasCode, setLtoHasCode] = useState(seed.ltoHasCode);
  const [ltoCode, setLtoCode] = useState(seed.ltoCode);
  const [ltoLinkText, setLtoLinkText] = useState(seed.ltoLinkText);
  const [ltoLinkUrl, setLtoLinkUrl] = useState(seed.ltoLinkUrl);

  // ---- Authentication (one-time code) ----
  const [auth, setAuth] = useState(seed.auth);
  const isAuth = category === 'AUTHENTICATION';
  const { limits: planLimits, openPlans } = usePlan();

  // ---- Auto-send ----
  const [trigger, setTrigger] = useState<TriggerDraft>(seed.trigger);
  const [savedTrigger, setSavedTrigger] = useState<TriggerDraft>(seed.trigger);
  const [orderStatuses, setOrderStatuses] = useState<string[]>([]);
  const [triggerEvents, setTriggerEvents] = useState<TriggerEvent[]>([]);
  const [savingTrigger, setSavingTrigger] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  // ---- Live values for {{n}} placeholders --------------------------------
  const [sources, setSources] = useState<TemplateSource[]>([]);
  const [variables, setVariables] = useState<TemplateVariable[]>(seed.variables);
  const [otherDrafts, setOtherDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    api
      .getTemplateSources()
      .then((r) => {
        setSources(r.data || []);
        setOrderStatuses(r.statuses || []);
        setTriggerEvents(r.events || []);
      })
      .catch(() => setSources([]));
  }, [api]);

  // Driven by the text itself: the mapping rows follow whatever {{n}} the body
  // currently contains, so deleting a placeholder drops its row.
  const indexes = useMemo(
    () =>
      [...new Set([...bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort(
        (a, b) => a - b,
      ),
    [bodyText],
  );
  const nextIndex = (indexes.length ? Math.max(...indexes) : 0) + 1;
  const varFor = (i: number) => variables.find((v) => v.index === i);
  const unmapped = indexes.filter((i) => {
    const v = varFor(i);
    if (!v?.source) return true;
    const nameVal = v.name?.trim() || otherDrafts[i]?.trim();
    if (v.source === 'other' && !nameVal) return true;
    return false;
  });

  function setVariable(index: number, patch: Partial<TemplateVariable>) {
    setVariables((list) => {
      const found = list.find((v) => v.index === index);
      if (found) return list.map((v) => (v.index === index ? { ...v, ...patch } : v));
      return [...list, { index, source: '', ...patch }];
    });
  }

  const bodyMax = kind === 'lto' ? 600 : 1024;
  const nameValid = useMemo(() => /^[a-z0-9_]+$/.test(name), [name]);
  // Authentication templates have no body of their own (Meta writes it).
  const formValid = nameValid && (isAuth || !!bodyText.trim());

  // ---- Kind / header switching ------------------------------------------
  function chooseKind(k: Kind) {
    setKind(k);
    setError('');
    // Carousels and offers only exist as Marketing templates.
    if (k !== 'standard') setCategory('MARKETING');
    // Offers take an image/video header or none; carousels have no header.
    if (k === 'lto' && (headerType === 'text' || headerType === 'document')) chooseHeader('none');
  }
  function chooseHeader(h: HeaderType) {
    if (h === headerType) return;
    setHeaderType(h);
    // A file picked for another header type doesn't carry over.
    setMediaFile(null);
    setMediaName('');
    setMediaPreviewUrl('');
    setExistingMediaUrl('');
  }
  const headerChoices = kind === 'lto'
    ? HEADER_CHOICES.filter((h) => h.value === 'none' || h.value === 'image' || h.value === 'video')
    : HEADER_CHOICES;

  function onMedia(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setMediaFile(f);
    setMediaName(f?.name ?? '');
    setMediaPreviewUrl(f && /^(image|video)\//.test(f.type) ? URL.createObjectURL(f) : '');
    if (f) setExistingMediaUrl('');
  }

  // ---- Standard buttons --------------------------------------------------
  function addButton(type: ButtonType) {
    setButtons((b) => [...b, { type, text: '', url: '', phone: '' }]);
  }
  function removeButton(i: number) {
    setButtons((b) => b.filter((_, idx) => idx !== i));
  }
  function updateButton(i: number, patch: Partial<TemplateButton>) {
    setButtons((b) => b.map((btn, idx) => (idx === i ? { ...btn, ...patch } : btn)));
  }

  // ---- Carousel cards ----------------------------------------------------
  function updateCard(i: number, patch: Partial<CardDraft>) {
    setCards((list) => list.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function updateCardButton(i: number, j: number, patch: Partial<CardDraft['buttons'][number]>) {
    setCards((list) =>
      list.map((c, idx) =>
        idx === i ? { ...c, buttons: c.buttons.map((b, k) => (k === j ? { ...b, ...patch } : b)) } : c,
      ),
    );
  }
  function onCardMedia(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!f) return;
    updateCard(i, { file: f, previewUrl: URL.createObjectURL(f), existingUrl: undefined });
  }
  function addCard() {
    setCards((list) => (list.length >= MAX_CARDS ? list : [...list, emptyCard(cardButtonTypes.length)]));
  }
  function removeCard(i: number) {
    setCards((list) => (list.length <= 2 ? list : list.filter((_, idx) => idx !== i)));
  }
  /** Card buttons are shared in shape (WhatsApp needs every card identical). */
  function setCardButtonType(j: number, t: ButtonType | null) {
    const next = [...cardButtonTypes];
    if (t === null) next.splice(j, 1);
    else next[j] = t;
    setCardButtonTypes(next);
    setCards((list) =>
      list.map((c) => {
        const btns = [...c.buttons];
        if (t === null) btns.splice(j, 1);
        while (btns.length < next.length) btns.push({ text: '', url: '', phone: '' });
        return { ...c, buttons: btns.slice(0, next.length) };
      }),
    );
  }
  function setCardFormatAndReset(f: 'image' | 'video') {
    if (f === cardFormat) return;
    setCardFormat(f);
    // Media picked as images can't stand in for videos (and vice versa).
    setCards((list) => list.map((c) => ({ ...c, file: null, previewUrl: '', existingUrl: undefined })));
  }

  // ---- Validation + submit -----------------------------------------------
  function validate(): string {
    if (isAuth) {
      if (!nameValid) return 'Give the template a name: lowercase letters, numbers and underscores only.';
      return authProblem(auth);
    }
    if (!formValid) return 'A lowercase name and a body are required.';
    const trimmedBody = bodyText.trim();
    if (trimmedBody.length > bodyMax) return `The message can be at most ${bodyMax} characters.`;
    // Meta rejects a template whose body starts or ends with a variable.
    if (/^\{\{\s*\d+\s*\}\}/.test(trimmedBody) || /\{\{\s*\d+\s*\}\}$/.test(trimmedBody)) {
      return 'The body can’t start or end with a variable. Add a word (or punctuation) before the first or after the last {{…}}.';
    }

    if (kind === 'carousel') {
      if (cards.length < 2) return 'A carousel needs at least 2 cards.';
      if (!cardButtonTypes.length) return 'Cards need at least one button.';
      for (const [i, c] of cards.entries()) {
        const n = i + 1;
        if (!c.file && !c.existingUrl) return `Card ${n} needs an ${cardFormat}.`;
        if (cardHasText && !c.body.trim()) return `Card ${n} needs its text (or switch off card text).`;
        if (c.body.length > 160) return `Card ${n}: card text can be at most 160 characters.`;
        if (VAR_RE.test(c.body)) return `Card ${n}: card text can’t contain {{…}} variables.`;
        for (const [j, t] of cardButtonTypes.entries()) {
          const b = c.buttons[j];
          if (!b?.text.trim()) return `Card ${n}: button ${j + 1} needs a label.`;
          if (t === 'URL' && !b.url.trim()) return `Card ${n}: add the link for “${b.text}”.`;
          if (t === 'URL' && VAR_RE.test(b.url)) return `Card ${n}: card links can’t contain {{…}} variables.`;
          if (t === 'PHONE_NUMBER' && !b.phone.trim()) return `Card ${n}: add the phone number for “${b.text}”.`;
        }
      }
      return '';
    }

    if ((headerType === 'image' || headerType === 'video' || headerType === 'document') && !mediaFile && !existingMediaUrl) {
      return `Please choose a ${headerType} file for the header.`;
    }

    if (kind === 'lto') {
      if (!ltoText.trim()) return 'Add the offer label (for example “Expiring offer!”).';
      if (ltoText.trim().length > 16) return 'The offer label can be at most 16 characters.';
      if (ltoHasCode && (!ltoCode.trim() || ltoCode.trim().length > 15)) return 'Add an offer code of up to 15 characters.';
      if (ltoHasExpiration) {
        const end = ltoEndsAt ? new Date(ltoEndsAt).getTime() : NaN;
        if (Number.isNaN(end)) return 'Choose when the offer ends.';
        if (end <= Date.now()) return 'The offer end time has to be in the future.';
      }
      if (!ltoLinkText.trim() || !ltoLinkUrl.trim()) return 'A limited-time offer needs a link button (label + URL).';
      if (VAR_RE.test(ltoLinkUrl)) return 'The offer link can’t contain {{…}} variables.';
      return '';
    }

    const cleanButtons = buttons.filter((b) => b.text.trim());
    if (cleanButtons.some((b) => b.type === 'URL' && !b.url?.trim())) return 'Add a URL for the CTA button.';
    if (cleanButtons.some((b) => b.type === 'PHONE_NUMBER' && !b.phone?.trim())) return 'Add a phone number for the call button.';
    for (const i of indexes) {
      const v = varFor(i);
      const valName = v?.name?.trim() || otherDrafts[i]?.trim();
      if (v?.source === 'other' && !valName) {
        return `Please enter a value name for variable {{${i}}} (used as column name in campaigns).`;
      }
    }
    return '';
  }

  async function submitTemplate(isDraft = false) {
    if (isDraft) {
      if (!name.trim()) {
        setError('Please enter a template name to save as draft.');
        return;
      }
    } else {
      if (!isWhatsAppConnected) {
        notify('error', 'WhatsApp not connected', 'Please connect WhatsApp to submit templates to Meta for approval, or save as Draft.');
        if (onConnectWhatsApp) onConnectWhatsApp();
        else if (onNavigate) onNavigate('channel-status');
        return;
      }
      const problem = validate();
      if (problem) {
        setError(problem);
        return;
      }
    }
    setSaving(true);
    setError('');
    setOk(false);

    const fd = new FormData();
    fd.append('name', name.trim().toLowerCase().replace(/\s+/g, '_'));
    fd.append('category', category);
    fd.append('language', language);
    fd.append('kind', kind);
    fd.append('bodyText', bodyText);
    if (isDraft) {
      fd.append('isDraft', 'true');
      fd.append('status', 'DRAFT');
    } else {
      fd.append('status', 'PENDING');
    }

    if (isAuth) {
      // Only the settings: Meta writes the body, footer and button text.
      fd.append('auth', JSON.stringify(authForSubmit(auth)));
    } else if (kind === 'carousel') {
      fd.append('cardFormat', cardFormat);
      fd.append(
        'cards',
        JSON.stringify(
          cards.map((c) => ({
            body: cardHasText ? c.body.trim() : '',
            // No new file: re-use the media already stored for this card.
            ...(!c.file && c.existingUrl ? { mediaUrl: c.existingUrl } : {}),
            buttons: cardButtonTypes.map((t, j) => ({
              type: t,
              text: c.buttons[j]?.text.trim() || '',
              url: c.buttons[j]?.url.trim() || '',
              phone: c.buttons[j]?.phone.trim() || '',
            })),
          })),
        ),
      );
      cards.forEach((c, i) => c.file && fd.append(`card_${i}`, c.file));
    } else {
      fd.append('headerType', headerType);
      if (headerType === 'text') fd.append('headerText', headerText || '');
      if (headerType !== 'none' && headerType !== 'text') {
        if (mediaFile) fd.append('headerMedia', mediaFile);
        else if (existingMediaUrl) {
          // Duplicating: the server re-uses the stored copy instead of an upload.
          fd.append('headerMediaUrl', existingMediaUrl);
          if (headerType === 'document' && mediaName) fd.append('headerFileName', mediaName);
        }
      }
      if (kind === 'lto') {
        fd.append(
          'lto',
          JSON.stringify({
            text: ltoText.trim(),
            hasExpiration: ltoHasExpiration,
            endsAt: ltoHasExpiration && ltoEndsAt ? new Date(ltoEndsAt).toISOString() : null,
            hasCopyCode: ltoHasCode,
            code: ltoHasCode ? ltoCode.trim() : '',
          }),
        );
        fd.append('buttons', JSON.stringify([{ type: 'URL', text: ltoLinkText.trim(), url: ltoLinkUrl.trim() }]));
      } else {
        fd.append('footerText', footerText || '');
        const cleanButtons = buttons.filter((b) => b.text.trim());
        if (cleanButtons.length) fd.append('buttons', JSON.stringify(cleanButtons));
      }
    }
    // Only placeholders still present in the body, and only mapped ones.
    const cleanVars = variables
      .filter((v) => indexes.includes(v.index) && v.source)
      .map((v) => {
        if (v.source === 'other' && !v.name?.trim() && otherDrafts[v.index]?.trim()) {
          return { ...v, name: otherDrafts[v.index].trim() };
        }
        return v;
      });
    if (cleanVars.length && !isAuth) fd.append('variables', JSON.stringify(cleanVars));
    if (trigger.enabled && triggerHasRules(trigger)) fd.append('trigger', JSON.stringify(trigger));

    try {
      await api.createTemplate(fd);
      setSaving(false);
      setOk(true);
      if (isDraft) {
        notify('success', 'Template saved as draft', `“${name}” was saved as a draft.`);
      } else {
        notify('success', 'Template submitted', `“${name}” was sent to WhatsApp for approval.`);
      }
      setTimeout(() => {
        if (onChanged) onChanged();
        onCreated();
      }, 600);
    } catch (err) {
      setSaving(false);
      const msg = err instanceof Error ? err.message : (isDraft ? 'Save draft failed' : 'Submit failed');
      setError(msg);
      notify('error', isDraft ? 'Draft not saved' : 'Template not submitted', msg);
    }
  }

  /** View mode: save auto-send (ours only, never sent to Meta). */
  async function saveTrigger(enabled: boolean) {
    if (!template) return;
    setSavingTrigger(true);
    try {
      const next = { ...trigger, enabled };
      await api.setTemplateAutomation(template.name, { ...next, variables: template.variables });
      const on = enabled && triggerHasRules(next);
      setTrigger({ ...next, enabled: on });
      setSavedTrigger({ ...next, enabled: on });
      notify(
        'success',
        on ? 'Auto-send is on' : 'Auto-send is off',
        on && template.status !== 'APPROVED' ? 'It starts once WhatsApp approves the template.' : undefined,
      );
      onChanged?.();
    } catch (e) {
      notify('error', 'Auto-send not saved', e instanceof Error ? e.message : undefined);
    } finally {
      setSavingTrigger(false);
    }
  }
  const triggerDirty = JSON.stringify(trigger) !== JSON.stringify(savedTrigger);

  // ---- Unsaved-changes guard --------------------------------------------
  // Everything the user can change, as one comparable string. The first
  // render's value is the baseline (blank, or the template being duplicated).
  const snapshot = JSON.stringify({
    name, category, language, kind, headerType, headerText, bodyText, footerText, buttons,
    media: mediaFile ? `${mediaFile.name}:${mediaFile.size}` : existingMediaUrl,
    cardFormat, cardHasText, cardButtonTypes,
    cards: cards.map((c) => ({
      f: c.file ? `${c.file.name}:${c.file.size}` : c.existingUrl || '', b: c.body, x: c.buttons,
    })),
    ltoText, ltoHasExpiration, ltoEndsAt, ltoHasCode, ltoCode, ltoLinkText, ltoLinkUrl,
    variables, trigger, auth,
  });
  const baseline = useRef(snapshot);
  // Viewing: only auto-send is editable. Creating: anything, until submitted.
  const dirty = readOnly ? triggerDirty : !ok && snapshot !== baseline.current;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Switching tabs in the left rail asks too (the shell owns that navigation).
  useEffect(() => {
    registerDirty?.(() => dirtyRef.current);
    return () => registerDirty?.(null);
  }, [registerDirty]);

  // Closing the browser tab or refreshing loses the draft just as surely.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  /** Back arrow: confirm before throwing away unsaved work. */
  async function goBack() {
    if (dirtyRef.current) {
      const discard = await confirm({
        title: 'Discard changes?',
        message: readOnly
          ? 'Your auto-send changes haven’t been saved. Leaving now loses them.'
          : 'This template hasn’t been submitted yet. Leaving now loses everything you’ve entered.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
      });
      if (!discard) return;
    }
    registerDirty?.(null);
    onBack();
  }

  // Browser Back / swipe-back behaves like the arrow (including the prompt).
  useBackHandler(true, () => {
    goBack();
  });

  function duplicate() {
    if (!template || !onDuplicate) return;
    // Unsaved auto-send edits on this view would be lost by moving on.
    if (dirtyRef.current) {
      confirm({
        title: 'Discard changes?',
        message: 'Your auto-send changes haven’t been saved. Duplicating now loses them.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
      }).then((ok2) => ok2 && onDuplicate(template));
      return;
    }
    onDuplicate(template);
  }

  // ---- Preview -----------------------------------------------------------
  const previewHeader: PreviewHeader =
    headerType === 'text'
      ? { type: 'text', text: headerText }
      : headerType === 'image' || headerType === 'video'
        ? { type: headerType, url: mediaPreviewUrl }
        : headerType === 'document'
          ? { type: 'document', fileName: mediaName }
          : { type: 'none' };


  // A viewed template may use a category/language this form doesn't offer.
  // The plan: authentication templates (Pro and up) and carousels (Basic and
  // up). A locked choice opens the plans dialog; the server refuses it too.
  const authLocked = !readOnly && !!planLimits && !planLimits.authTemplates;
  const carouselLocked = !readOnly && !!planLimits && !planLimits.carousel;
  const baseCategories = authLocked
    ? CATEGORY_OPTIONS.map((o) => (o.value === 'AUTHENTICATION'
      ? { ...o, label: `${o.label} · ${TIER_NAMES[tierFor('authTemplates')]} plan`, icon: <span className="material-icons" style={{ fontSize: 15 }} aria-hidden="true">lock</span> }
      : o))
    : CATEGORY_OPTIONS;
  const categoryOptions = baseCategories.some((o) => o.value === category)
    ? baseCategories
    : [...baseCategories, { value: category, label: category.charAt(0) + category.slice(1).toLowerCase() }];
  const languageOptions = LANGUAGE_OPTIONS.some((o) => o.value === language)
    ? LANGUAGE_OPTIONS
    : [...LANGUAGE_OPTIONS, { value: language, label: language }];
  // A duplicate is a brand-new template, so it starts out pending like any other.
  const status = String((readOnly && template?.status) || 'PENDING').toUpperCase();

  return (
    <div className={`page composer-page${readOnly ? ' tc-readonly' : ''}`}>
      <header className="page-head">
        <button className="icon-btn" onClick={goBack} aria-label="Back to templates">
          <span className="material-icons">arrow_back</span>
        </button>
        {readOnly && template ? (
          <>
            <h2 className="tc-view-title">
              {template.name}
              <span className={`tl-status ${STATUS_TONE[status] || 'amber'}`}>
                {status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')}
              </span>
              {status === 'APPROVED' && (
                <span className="tc-approved-lock" title="Approved template cannot be edited">
                  <TemplateLockSvg />
                </span>
              )}
            </h2>
            <div className="tc-head-actions">
              {status === 'DRAFT' && (
                <button
                  type="button"
                  className={`k-btn tc-create-btn${!isWhatsAppConnected ? ' is-locked' : ''}`}
                  onClick={() => {
                    if (!isWhatsAppConnected) {
                      notify('error', 'Connect WhatsApp number', 'Connect your WhatsApp number to unlock and submit templates for Meta approval.');
                      if (onConnectWhatsApp) onConnectWhatsApp();
                      else if (onNavigate) onNavigate('channel-status');
                      return;
                    }
                    submitTemplate(false);
                  }}
                  disabled={saving}
                  title={!isWhatsAppConnected ? 'Connect your WhatsApp number to unlock and submit templates' : 'Submit template for Meta approval'}
                >
                  {!isWhatsAppConnected && (
                    <TemplateLockSvg width={15} height={15} className="tc-btn-lock-icon" />
                  )}
                  <span>{saving ? 'Submitting…' : 'Submit'}</span>
                </button>
              )}
              {onDuplicate && (
                <button className="k-btn ghost" onClick={duplicate}>
                  <TemplateDuplicateSvg width={18} height={18} /> Duplicate
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h2>{prefill ? 'New template from the library' : template ? 'Duplicate template' : 'New template'}</h2>
            <div className="tc-head-actions">
              <button
                type="button"
                className="k-btn tc-draft-btn"
                onClick={() => submitTemplate(true)}
                disabled={saving || !name.trim()}
                title="Save template as Draft"
              >
                <TemplateDraftSvg width={18} height={18} />
                <span>Draft</span>
              </button>
              <button
                type="button"
                className={`k-btn tc-create-btn${!isWhatsAppConnected ? ' is-locked' : ''}`}
                onClick={() => {
                  if (!isWhatsAppConnected) {
                    notify('error', 'Connect WhatsApp number', 'Connect your WhatsApp number to unlock and create templates for Meta approval.');
                    if (onConnectWhatsApp) onConnectWhatsApp();
                    else if (onNavigate) onNavigate('channel-status');
                    return;
                  }
                  submitTemplate(false);
                }}
                disabled={saving}
                title={!isWhatsAppConnected ? 'Connect your WhatsApp number to unlock and create templates' : (template?.status === 'DRAFT' ? 'Submit template for Meta approval' : 'Create template')}
              >
                {!isWhatsAppConnected && (
                  <TemplateLockSvg width={15} height={15} className="tc-btn-lock-icon" />
                )}
                <span>{saving ? 'Submitting…' : (template?.status === 'DRAFT' ? 'Submit' : 'Create')}</span>
              </button>
            </div>
          </>
        )}
      </header>

      <div className="composer-split">
        {/* Left: fields */}
        <div className="composer-fields">
          {error && <p className="err">{error}</p>}
          {ok && <p className="ok">Template submitted for approval.</p>}
          {readOnly && templateReason(template?.rejectedReason) && (
            <div className="tc-reject-note" role="alert">
              <span className="material-icons">error</span>
              <span>
                <strong>Rejected by WhatsApp: {templateReason(template?.rejectedReason)!.title}.</strong>{' '}
                {templateReason(template?.rejectedReason)!.fix} A rejected template can’t be edited, so use{' '}
                <strong>Duplicate</strong>, change it and submit the copy.
              </span>
            </div>
          )}
          {template && !readOnly && (existingMediaUrl || cards.some((c) => c.existingUrl)) && (
            <p className="k-hint">The original media is reused. Pick a new file to replace it.</p>
          )}

          {/* Read-only: one disabled fieldset locks every input, button and picker inside. */}
          <fieldset className="tc-fieldset" disabled={readOnly}>

          <div className="k-field">
            <label className="k-label">Name (lowercase, no spaces)</label>
            <input
              className="k-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="demo_followup"
            />
          </div>
          <div className="two">
            <div className="k-field">
              <label className="k-label">Category</label>
              <Dropdown
                options={categoryOptions}
                value={category}
                onChange={(v) => {
                  if (v === 'AUTHENTICATION' && authLocked) {
                    const need = tierFor('authTemplates');
                    openPlans({ tier: need, reason: `Authentication (one-time code) templates are included from the ${TIER_NAMES[need]} plan.` });
                    return;
                  }
                  setCategory(v);
                  // Utility templates can only be standard.
                  if (v !== 'MARKETING' && kind !== 'standard') setKind('standard');
                }}
              />
            </div>
            <div className="k-field">
              <label className="k-label">Language</label>
              <Dropdown options={languageOptions} value={language} onChange={setLanguage} />
            </div>
          </div>

          {isAuth ? (
            <AuthTemplateFields value={auth} onChange={setAuth} readOnly={readOnly} />
          ) : (
          <>
          <div className="k-field">
            <label className="k-label">Template type</label>
            <OptionRow
              label="Template type"
              options={KINDS}
              value={kind}
              onChange={chooseKind}
              disabled={(v) => (v === 'carousel' && carouselLocked
                ? `Carousel templates need the ${TIER_NAMES[tierFor('carousel')]} plan`
                : v !== 'standard' && category !== 'MARKETING' ? 'Marketing templates only' : false)}
            />
            {carouselLocked && (
              <p className="k-hint" data-testid="tc-carousel-locked">
                <span className="material-icons" style={{ fontSize: 14, verticalAlign: '-2px' }} aria-hidden="true">lock</span>{' '}
                Carousel templates are part of the {TIER_NAMES[tierFor('carousel')]} plan.{' '}
                <button
                  type="button"
                  className="k-link-btn"
                  onClick={() => openPlans({ tier: tierFor('carousel'), reason: `Carousel templates are included from the ${TIER_NAMES[tierFor('carousel')]} plan.` })}
                >
                  See plans
                </button>
              </p>
            )}
          </div>

          {kind === 'carousel' ? (
            <div className="k-field">
              <label className="k-label">Card media</label>
              <p className="k-hint">Every card shows one {cardFormat}. WhatsApp crops it to a wide frame.</p>
              <OptionRow
                label="Card media"
                options={[
                  { value: 'image', label: 'Image', icon: <HeaderImageSvg /> },
                  { value: 'video', label: 'Video', icon: <HeaderVideoSvg /> },
                ]}
                value={cardFormat}
                onChange={setCardFormatAndReset}
              />
            </div>
          ) : (
            <div className="k-field">
              <label className="k-label">
                Header <span className="k-label-soft">(optional)</span>
              </label>
              <p className="k-hint">
                {kind === 'lto'
                  ? 'An image or video above the offer makes it stand out.'
                  : 'Highlight your brand with a title, image, video or PDF.'}
              </p>
              <OptionRow label="Header" options={headerChoices} value={headerType} onChange={chooseHeader} />
              {headerType === 'text' && (
                <input
                  className="k-input tc-after-opts"
                  type="text"
                  value={headerText}
                  maxLength={60}
                  placeholder="Header text"
                  onChange={(e) => setHeaderText(e.target.value)}
                />
              )}
              {(headerType === 'image' || headerType === 'video' || headerType === 'document') && (
                <div className="uploader tc-after-opts">
                  <label className="k-btn ghost sm file-btn">
                    <UploadSvg />
                    <span>Choose {headerType}</span>
                    <input
                      type="file"
                      accept={headerType === 'image' ? 'image/jpeg,image/png' : headerType === 'video' ? 'video/mp4' : 'application/pdf'}
                      onChange={onMedia}
                      hidden
                    />
                  </label>
                  {mediaName && <span className="file-name">{mediaName}</span>}
                </div>
              )}
            </div>
          )}

          {kind === 'lto' && (
            <div className="k-field tc-section tc-lto-section">
              <label className="k-label">Offer</label>
              <div className="tc-lto-content">
                <div className="tc-lto-field">
                  <div className="tc-lto-field-head">
                    <label className="k-label tc-sub-label">Offer label</label>
                    <span className="tc-count">{ltoText.length}/16</span>
                  </div>
                  <input
                    className="k-input"
                    value={ltoText}
                    maxLength={16}
                    placeholder="Expiring offer!"
                    onChange={(e) => setLtoText(e.target.value)}
                    aria-label="Offer label"
                  />
                </div>

                <div className="two tc-lto-two">
                  <div className="tc-lto-col">
                    <label className="tc-check">
                      <input type="checkbox" checked={ltoHasExpiration} onChange={(e) => setLtoHasExpiration(e.target.checked)} />
                      <span>Show a countdown</span>
                    </label>
                    {ltoHasExpiration && (
                      <div className="tc-lto-dt-wrap">
                        <CustomDateTimePicker
                          value={ltoEndsAt || toLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())}
                          onChange={(val) => setLtoEndsAt(val)}
                          showTime={true}
                          hidePastDates={true}
                          disabled={readOnly}
                        />
                      </div>
                    )}
                  </div>
                  <div className="tc-lto-col">
                    <label className="tc-check">
                      <input type="checkbox" checked={ltoHasCode} onChange={(e) => setLtoHasCode(e.target.checked)} />
                      <span>Add a “Copy code” button</span>
                    </label>
                    {ltoHasCode && (
                      <input
                        className="k-input"
                        value={ltoCode}
                        maxLength={15}
                        placeholder="FESTIVE25"
                        onChange={(e) => setLtoCode(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                        aria-label="Offer code"
                      />
                    )}
                  </div>
                </div>

                <p className="k-hint">
                  The end time and code are the defaults. Campaigns can change both for each send.
                </p>
              </div>
            </div>
          )}

          <div className="k-field">
            <label className="k-label">
              {kind === 'carousel' ? 'Message (shown above the cards)' : 'Body'}
            </label>
            <TemplateBodyEditor
              value={bodyText}
              onChange={setBodyText}
              max={bodyMax}
              readOnly={readOnly}
              placeholder={kind === 'lto' ? 'Hi {{1}}, enjoy 25% off everything this weekend.' : 'Template Message...'}
              nextIndex={nextIndex}
              sources={!readOnly ? sources : undefined}
              onInsertVariable={(i) => {
                setVariable(i, {});
              }}
              onInsertSourceVariable={(i, sKey) => {
                setVariable(i, { source: sKey });
              }}
            />
          </div>

          {/* One row per placeholder actually present in the body, so the
              mapping can never drift from the text. */}
          {indexes.length > 0 && (
            <div className="k-field">
              <label className="k-label">What each value means</label>
              <div className="tv-map">
                {indexes.map((i) => {
                  const picked = varFor(i);
                  const isOther = picked?.source === 'other';
                  return (
                    <div className="tv-row-group" key={i}>
                      <div className="tv-row">
                        <span className="tv-row-key">{`{{${i}}}`}</span>
                        <select
                          className="k-input tv-row-src"
                          value={picked?.source || ''}
                          disabled={readOnly}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'other') {
                              setVariable(i, { source: 'other' });
                            } else {
                              setVariable(i, { source: val, name: undefined });
                            }
                          }}
                        >
                          <option value="">— choose a value —</option>
                          {sources.map((s) => (
                            <option value={s.key} key={s.key}>{s.label}</option>
                          ))}
                          <option value="other">Other (Custom value)</option>
                        </select>
                        <input
                          className="k-input tv-row-fb"
                          value={picked?.fallback || ''}
                          readOnly={readOnly}
                          onChange={(e) => setVariable(i, { fallback: e.target.value })}
                          placeholder="If blank, send…"
                        />
                      </div>
                      {isOther && (
                        <div className="tv-other-box">
                          <label className="tv-other-label">
                            <span className="material-icons">label</span>
                            Value name for {`{{${i}}}`} (used as Excel / CSV column name in campaigns):
                          </label>
                          <div className="tv-other-controls">
                            <input
                              type="text"
                              className="k-input tv-other-input"
                              value={otherDrafts[i] !== undefined ? otherDrafts[i] : (picked?.name || '')}
                              readOnly={readOnly}
                              onChange={(e) => {
                                const text = e.target.value;
                                setOtherDrafts((prev) => ({ ...prev, [i]: text }));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const text = (otherDrafts[i] !== undefined ? otherDrafts[i] : (picked?.name || '')).trim();
                                  if (text) {
                                    setVariable(i, { name: text });
                                  }
                                }
                              }}
                              placeholder="Enter value name (e.g. Coupon, City, Order Status)..."
                              autoFocus={!picked?.name}
                            />
                            {!readOnly && (
                              <button
                                type="button"
                                className="tv-other-add-btn"
                                onClick={() => {
                                  const text = (otherDrafts[i] !== undefined ? otherDrafts[i] : (picked?.name || '')).trim();
                                  if (text) {
                                    setVariable(i, { name: text });
                                  }
                                }}
                                disabled={!((otherDrafts[i] !== undefined ? otherDrafts[i] : (picked?.name || '')).trim())}
                                title="Add value name"
                              >
                                <span className="material-icons">add</span>
                                {picked?.name ? 'Update' : 'Add'}
                              </button>
                            )}
                          </div>
                          {picked?.name && (
                            <div className="tv-other-confirmed">
                              <span className="material-icons">check_circle</span>
                              <span>Added column name: <strong>{picked.name}</strong></span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {unmapped.length > 0 && (
                <p className="k-hint warn">
                  {unmapped.map((i) => `{{${i}}}`).join(', ')} {unmapped.length === 1 ? 'has' : 'have'} no
                  value chosen — {unmapped.length === 1 ? 'it' : 'they'} will send as a dash.
                </p>
              )}
            </div>
          )}

          {/* ---- Carousel cards ---- */}
          {kind === 'carousel' && (
            <div className="k-field tc-section">
              <label className="k-label">Cards ({cards.length}/{MAX_CARDS})</label>
              <p className="k-hint">
                WhatsApp needs every card to look the same, so the buttons are set once for all cards. Each card gets
                its own {cardFormat}, text and button values.
              </p>
              <div className="tc-card-shape">
                <label className="tc-check">
                  <input type="checkbox" checked={cardHasText} onChange={(e) => setCardHasText(e.target.checked)} />
                  Text on each card
                </label>
                {cardButtonTypes.map((t, j) => (
                  <span className="tc-shape-btn" key={j}>
                    Button {j + 1}:
                    <select
                      className="k-input"
                      value={t}
                      onChange={(e) => setCardButtonType(j, e.target.value as ButtonType)}
                      aria-label={`Card button ${j + 1} type`}
                    >
                      <option value="QUICK_REPLY">Reply</option>
                      <option value="URL">Link</option>
                      <option value="PHONE_NUMBER">Call</option>
                    </select>
                    {cardButtonTypes.length > 1 && (
                      <button type="button" className="ic-del" onClick={() => setCardButtonType(j, null)} aria-label={`Remove button ${j + 1}`}>
                        <span className="material-icons">close</span>
                      </button>
                    )}
                  </span>
                ))}
                {cardButtonTypes.length < 2 && (
                  <button type="button" className="k-btn ghost sm" onClick={() => setCardButtonType(cardButtonTypes.length, 'URL')}>
                    <span className="material-icons">add</span> Second button
                  </button>
                )}
              </div>

              <div className="tc-cards">
                {cards.map((c, i) => (
                  <div className="tc-card" key={i}>
                    <div className="tc-card-head">
                      <strong>Card {i + 1}</strong>
                      {cards.length > 2 && (
                        <button type="button" className="ic-del" onClick={() => removeCard(i)} aria-label={`Remove card ${i + 1}`}>
                          <span className="material-icons">delete</span>
                        </button>
                      )}
                    </div>
                    <label className="tc-card-media">
                      {c.previewUrl ? (
                        cardFormat === 'video' ? (
                          <video src={c.previewUrl} muted playsInline />
                        ) : (
                          <img src={c.previewUrl} alt="" />
                        )
                      ) : (
                        <span className="tc-card-media-ph">
                          <UploadSvg width={20} height={20} />
                          <span>Choose {cardFormat}</span>
                        </span>
                      )}
                      <input
                        type="file"
                        hidden
                        accept={cardFormat === 'video' ? 'video/mp4' : 'image/jpeg,image/png'}
                        onChange={(e) => onCardMedia(i, e)}
                      />
                    </label>
                    {cardHasText && (
                      <>
                        <textarea
                          className="k-textarea"
                          rows={2}
                          maxLength={160}
                          value={c.body}
                          placeholder="Card text"
                          onChange={(e) => updateCard(i, { body: e.target.value })}
                          aria-label={`Card ${i + 1} text`}
                        />
                        <span className="k-hint">{c.body.length}/160</span>
                      </>
                    )}
                    {cardButtonTypes.map((t, j) => (
                      <div className="tc-card-btn" key={j}>
                        <input
                          className="k-input"
                          maxLength={25}
                          placeholder={`${kindLabel(t)} label`}
                          value={c.buttons[j]?.text || ''}
                          onChange={(e) => updateCardButton(i, j, { text: e.target.value })}
                          aria-label={`Card ${i + 1} button ${j + 1} label`}
                        />
                        {t === 'URL' && (
                          <input
                            className="k-input"
                            placeholder="https://example.com/item"
                            value={c.buttons[j]?.url || ''}
                            onChange={(e) => updateCardButton(i, j, { url: e.target.value })}
                            aria-label={`Card ${i + 1} button ${j + 1} link`}
                          />
                        )}
                        {t === 'PHONE_NUMBER' && (
                          <input
                            className="k-input"
                            placeholder="+91 98765 43210"
                            value={c.buttons[j]?.phone || ''}
                            onChange={(e) => updateCardButton(i, j, { phone: e.target.value })}
                            aria-label={`Card ${i + 1} button ${j + 1} phone`}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {cards.length < MAX_CARDS && (
                  <button type="button" className="tc-card tc-card-add" onClick={addCard}>
                    <span className="material-icons">add</span>
                    Add card
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ---- Offer link ---- */}
          {kind === 'lto' && (
            <div className="k-field">
              <label className="k-label">Link button</label>
              <div className="btn-row">
                <span className="btn-kind">URL</span>
                <input
                  className="k-input"
                  placeholder="Shop now"
                  maxLength={25}
                  value={ltoLinkText}
                  onChange={(e) => setLtoLinkText(e.target.value)}
                  aria-label="Link button label"
                />
                <input
                  className="k-input"
                  placeholder="https://example.com/offer"
                  value={ltoLinkUrl}
                  onChange={(e) => setLtoLinkUrl(e.target.value)}
                  aria-label="Link button URL"
                />
              </div>
            </div>
          )}

          {/* ---- Standard footer + buttons ---- */}
          {kind === 'standard' && (
            <>
              <div className="k-field">
                <label className="k-label">Footer (optional)</label>
                <input
                  className="k-input"
                  type="text"
                  value={footerText}
                  maxLength={60}
                  onChange={(e) => setFooterText(e.target.value)}
                />
              </div>

              <div className="k-field">
                <label className="k-label">Buttons (optional)</label>
                <div className="btn-adds">
                  <button type="button" className="k-btn ghost sm" onClick={() => addButton('QUICK_REPLY')}>
                    <span className="material-icons">reply</span> Reply
                  </button>
                  <button type="button" className="k-btn ghost sm" onClick={() => addButton('URL')}>
                    <span className="material-icons">open_in_new</span> URL
                  </button>
                  <button type="button" className="k-btn ghost sm" onClick={() => addButton('PHONE_NUMBER')}>
                    <span className="material-icons">call</span> Call
                  </button>
                </div>
                {buttons.map((b, i) => (
                  <div className="btn-row" key={i}>
                    <span className="btn-kind">{kindLabel(b.type)}</span>
                    <input
                      className="k-input"
                      placeholder="Button text"
                      value={b.text}
                      maxLength={25}
                      onChange={(e) => updateButton(i, { text: e.target.value })}
                    />
                    {b.type === 'URL' && (
                      <input
                        className="k-input"
                        placeholder="https://example.com"
                        value={b.url}
                        onChange={(e) => updateButton(i, { url: e.target.value })}
                      />
                    )}
                    {b.type === 'PHONE_NUMBER' && (
                      <input
                        className="k-input"
                        placeholder="+91 98765 43210"
                        value={b.phone}
                        onChange={(e) => updateButton(i, { phone: e.target.value })}
                      />
                    )}
                    <button type="button" className="ic-del" onClick={() => removeButton(i)}>
                      <span className="material-icons">close</span>
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          </>
          )}
          </fieldset>

          {/* ---- Auto-send (ours, not Meta's — editable in every mode) ---- */}
          <section className={`k-field tc-section tc-autosend${trigger.enabled ? ' on' : ''}`} aria-labelledby="tc-as-title">
            <div className="tc-as-head">
              <span className="material-icons">bolt</span>
              <div className="tc-as-titles">
                <h3 id="tc-as-title">Auto-send</h3>
                <p className="k-hint">
                  Send this template automatically on a keyword, an order update or an event.
                  {isAuth && ' Every automatic send gets its own new 6-digit code, shown in the chat.'}
                  {status !== 'APPROVED' && ' It only starts sending once WhatsApp approves the template.'}
                </p>
              </div>
              {!readOnly && (
                <label className="tc-switch">
                  <input
                    type="checkbox"
                    checked={trigger.enabled}
                    onChange={(e) => setTrigger((t) => ({ ...t, enabled: e.target.checked }))}
                  />
                  <span className="tc-switch-track" aria-hidden="true" />
                  <span className="sr-only">Turn on auto-send</span>
                </label>
              )}
              {readOnly && (
                <span className={`k-chip sm ${savedTrigger.enabled ? 'green' : ''}`}>
                  {savedTrigger.enabled ? 'On' : 'Off'}
                </span>
              )}
            </div>

            {(readOnly || trigger.enabled) && (
              <AutoSendFields
                value={trigger}
                onChange={setTrigger}
                statuses={orderStatuses}
                events={triggerEvents}
              />
            )}
            {!readOnly && trigger.enabled && !triggerHasRules(trigger) && (
              <p className="k-hint warn">Add a keyword, an order status or an event, otherwise nothing will trigger it.</p>
            )}

            {readOnly && (
              <div className="tpl-auto-foot">
                {savedTrigger.enabled && (
                  <button type="button" className="k-btn ghost sm" onClick={() => saveTrigger(false)} disabled={savingTrigger}>
                    Turn off
                  </button>
                )}
                <button
                  type="button"
                  className="k-btn sm"
                  onClick={() => saveTrigger(true)}
                  disabled={savingTrigger || !triggerHasRules(trigger) || (!triggerDirty && savedTrigger.enabled)}
                >
                  {savingTrigger ? 'Saving…' : savedTrigger.enabled ? 'Save changes' : 'Save & turn on'}
                </button>
              </div>
            )}
          </section>
        </div>

        {/* Right: live preview */}
        <div className="composer-preview">
          {isAuth ? (
            <>
              <TemplatePhonePreview
                kind="standard"
                header={{ type: 'none' }}
                body={authBodyText(auth)}
                footer={authFooterText(auth)}
                buttons={authPreviewButtons(auth)}
                highlightVars
              />
              <p className="k-hint at-preview-hint">
                WhatsApp writes this text and translates it to the template language. {'{{1}}'} becomes the code
                you send.
              </p>
            </>
          ) : (
          <TemplatePhonePreview
            kind={kind}
            header={previewHeader}
            body={bodyText}
            footer={kind === 'standard' ? footerText : ''}
            buttons={
              kind === 'lto'
                ? [{ type: 'URL', text: ltoLinkText || 'Link button' }]
                : kind === 'standard'
                  ? buttons
                  : []
            }
            cards={cards.map((c) => ({
              mediaUrl: c.previewUrl,
              mediaFormat: cardFormat,
              body: cardHasText ? c.body || 'Card text' : '',
              buttons: cardButtonTypes.map((t, j) => ({ type: t, text: c.buttons[j]?.text || kindLabel(t) })),
            }))}
            offer={
              kind === 'lto'
                ? {
                    text: ltoText,
                    hasExpiration: ltoHasExpiration,
                    endsAt: ltoEndsAt ? new Date(ltoEndsAt).toISOString() : null,
                    hasCopyCode: ltoHasCode,
                    code: ltoCode,
                  }
                : null
            }
            highlightVars
          />
          )}
        </div>
      </div>
    </div>
  );
}
