// WhatsApp phone mock showing one template message. Shared by the template
// composer (live while typing) and Campaigns (the template being sent).
// Renders all three kinds: standard, media-card carousel and limited-time offer.
import { AppIcon, CopyIcon } from './AppIcons';
import { Fragment, useMemo } from 'react';
import type { TemplateItem } from '../types';
import { CatalogActionSvg } from './MessageItem';
import { authBodyText, authFooterText, authFromTemplate, authPreviewButtons, isAuthTemplate } from '../authTemplate';

export type PreviewHeader =
  | { type: 'none' }
  | { type: 'text'; text: string }
  | { type: 'image' | 'video' | 'document'; url?: string; fileName?: string };

export interface PreviewButton {
  type: string; // QUICK_REPLY | URL | PHONE_NUMBER | COPY_CODE
  text: string;
}

export interface PreviewCard {
  mediaUrl?: string;
  mediaFormat: 'image' | 'video';
  body?: string;
  buttons: PreviewButton[];
}

export interface PreviewOffer {
  text: string;
  hasExpiration: boolean;
  endsAt?: string | null;
  hasCopyCode: boolean;
  code?: string;
}

export interface TemplatePhonePreviewProps {
  kind?: 'standard' | 'carousel' | 'lto';
  header: PreviewHeader;
  body: string;
  footer?: string;
  buttons?: PreviewButton[];
  cards?: PreviewCard[];
  offer?: PreviewOffer | null;
  /** Shown when there's nothing to preview yet. */
  placeholder?: string;
  /** Show {{1}}-style placeholders as highlighted chips. */
  highlightVars?: boolean;
  businessName?: string;
  businessAvatar?: string;
  showTitle?: boolean;
}

function btnIcon(t: string): string {
  const k = String(t).toUpperCase();
  if (k === 'URL') return 'open_in_new';
  if (k === 'PHONE_NUMBER') return 'call';
  if (k === 'COPY_CODE') return 'content_copy';
  if (k === 'CATALOG' || k === 'MPM') return 'storefront';
  if (k === 'FLOW' || k === 'LIST') return 'list';
  return 'reply';
}

/** Body text with {{n}} placeholders wrapped and WhatsApp markdown (*bold*, _italic_, ~strike~) rendered */
function renderFormattedBody(text: string, highlightVars: boolean) {
  // A bold placeholder (*{{1}}*, as in Meta's authentication text) is split out whole.
  const varParts = text.split(/(\*\{\{\s*[\w\d]+\s*\}\}\*|\{\{\s*[\w\d]+\s*\}\})/g);
  return varParts.map((part, idx) => {
    if (/^\*\{\{\s*[\w\d]+\s*\}\}\*$/.test(part)) {
      const v = part.slice(1, -1).replace(/\s+/g, '');
      return <strong key={idx}>{highlightVars ? <span className="pv-var">{v}</span> : v}</strong>;
    }
    if (/^\{\{\s*[\w\d]+\s*\}\}$/.test(part)) {
      return highlightVars ? (
        <span className="pv-var" key={idx}>
          {part.replace(/\s+/g, '')}
        </span>
      ) : (
        part
      );
    }
    const formatRegex = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
    const subParts = part.split(formatRegex);
    return (
      <Fragment key={idx}>
        {subParts.map((sub, sIdx) => {
          if (sub.startsWith('*') && sub.endsWith('*') && sub.length > 2) {
            return <strong key={sIdx}>{sub.slice(1, -1)}</strong>;
          }
          if (sub.startsWith('_') && sub.endsWith('_') && sub.length > 2) {
            return <em key={sIdx}>{sub.slice(1, -1)}</em>;
          }
          if (sub.startsWith('~') && sub.endsWith('~') && sub.length > 2) {
            return <del key={sIdx}>{sub.slice(1, -1)}</del>;
          }
          return sub;
        })}
      </Fragment>
    );
  });
}

/** "Ends in 3 days" — the wording WhatsApp shows under an offer. */
function endsLabel(endsAt?: string | null): string {
  if (!endsAt) return 'Ends in …';
  const ms = new Date(endsAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return 'Ends in …';
  if (ms <= 0) return 'Offer ended';
  const h = Math.floor(ms / 3600000);
  if (h >= 48) return `Ends in ${Math.floor(h / 24)} days`;
  if (h >= 1) return `Ends in ${h} hour${h === 1 ? '' : 's'}`;
  return `Ends in ${Math.max(1, Math.floor(ms / 60000))} min`;
}

/** Map a saved template (Meta components + our stored copies) to preview props. */
export function previewPropsFromTemplate(t: TemplateItem): Omit<TemplatePhonePreviewProps, 'placeholder'> {
  const c = t.components || [];
  // Authentication: Meta's own wording (on Meta's copy), else what Meta will write.
  if (isAuthTemplate(t)) {
    const a = authFromTemplate(t);
    return {
      kind: 'standard',
      header: { type: 'none' },
      body: c.find((x) => x.type === 'BODY')?.text || authBodyText(a),
      footer: c.find((x) => x.type === 'FOOTER')?.text || authFooterText(a),
      buttons: authPreviewButtons(a),
      highlightVars: true,
    };
  }
  const h = c.find((x) => x.type === 'HEADER');
  const fmt = (h?.format || '').toUpperCase();
  let header: PreviewHeader = { type: 'none' };
  if (fmt === 'TEXT' && h?.text) header = { type: 'text', text: h.text };
  else if (fmt === 'IMAGE') header = { type: 'image', url: t.headerMediaUrl };
  else if (fmt === 'VIDEO') header = { type: 'video', url: t.headerMediaUrl };
  else if (fmt === 'DOCUMENT') header = { type: 'document', url: t.headerMediaUrl, fileName: t.headerFileName };
  const kind = t.kind || 'standard';
  const allButtons = (c.find((x) => x.type === 'BUTTONS')?.buttons || []).map((b) => ({ type: b.type, text: b.text }));
  return {
    kind,
    header,
    body: c.find((x) => x.type === 'BODY')?.text || t.bodyText || '',
    footer: c.find((x) => x.type === 'FOOTER')?.text || '',
    buttons: kind === 'lto' ? allButtons.filter((b) => String(b.type).toUpperCase() !== 'COPY_CODE') : allButtons,
    cards: (t.cards || []).map((card) => ({
      mediaUrl: card.mediaUrl,
      mediaFormat: card.mediaFormat,
      body: card.body,
      buttons: card.buttons.map((b) => ({ type: b.type, text: b.text })),
    })),
    offer: kind === 'lto' && t.lto ? { ...t.lto } : null,
    highlightVars: true,
  };
}

function MediaBox({ format, url, className }: { format: 'image' | 'video'; url?: string; className: string }) {
  if (url) {
    return format === 'video' ? (
      <video className={className} src={url} muted playsInline />
    ) : (
      <img className={className} src={url} alt="" />
    );
  }
  return (
    <div className={`${className} pv-media-ph`}>
      <span className="material-icons">{format === 'video' ? 'videocam' : 'image'}</span>
    </div>
  );
}

/** The phone's status bar (signal, Wi-Fi, battery), shared by the phone mocks. */
export function PhoneStatusBar() {
  return (
    <div className="tc-phone-bar">
      <div className="tc-phone-bar-left" />
      <div className="tc-phone-bar-right">
        {/* Signal SVG */}
        <svg
          className="tc-status-signal"
          width="13"
          height="10.11111111111111"
          viewBox="0 0 11 7"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M9.40837 0.793945C9.13355 0.793945 8.91077 1.01673 8.91077 1.29154V6.43338C8.91077 6.70819 9.13355 6.93097 9.40837 6.93097H10.0718C10.3466 6.93097 10.5694 6.70819 10.5694 6.43338V1.29154C10.5694 1.01673 10.3466 0.793945 10.0718 0.793945H9.40837Z"
            fill="var(--wati-text-body, #1c1c1e)"
          />
          <path
            d="M6.25692 2.61847C6.25692 2.34365 6.4797 2.12087 6.75452 2.12087H7.41798C7.69279 2.12087 7.91557 2.34365 7.91557 2.61847V6.43338C7.91557 6.70819 7.69279 6.93097 7.41798 6.93097H6.75451C6.4797 6.93097 6.25692 6.70819 6.25692 6.43338V2.61847Z"
            fill="var(--wati-text-body, #1c1c1e)"
          />
          <path
            d="M4.10067 3.4478C3.82585 3.4478 3.60307 3.67058 3.60307 3.94539V6.43338C3.60307 6.70819 3.82585 6.93097 4.10066 6.93097H4.76413C5.03894 6.93097 5.26172 6.70819 5.26172 6.43338V3.94539C5.26172 3.67058 5.03894 3.4478 4.76413 3.4478H4.10067Z"
            fill="var(--wati-text-body, #1c1c1e)"
          />
          <path
            d="M1.44682 4.60885C1.172 4.60885 0.949219 4.83164 0.949219 5.10645V6.43338C0.949219 6.70819 1.172 6.93097 1.44682 6.93097H2.11028C2.38509 6.93097 2.60787 6.70819 2.60787 6.43338V5.10645C2.60787 4.83164 2.38509 4.60885 2.11028 4.60885H1.44682Z"
            fill="var(--wati-text-body, #1c1c1e)"
          />
        </svg>

        {/* WiFi SVG */}
        <svg
          className="tc-status-wifi"
          width="12"
          height="9.333333333333334"
          viewBox="0 0 9 7"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M4.45637 2.0685C5.68372 2.06855 6.86414 2.54508 7.75365 3.39958C7.82063 3.46555 7.92769 3.46472 7.99366 3.39771L8.63396 2.74476C8.66736 2.71078 8.68598 2.66475 8.68571 2.61685C8.68543 2.56895 8.66627 2.52314 8.63248 2.48956C6.2978 0.228742 2.61457 0.228742 0.279886 2.48956C0.246067 2.52312 0.226878 2.56891 0.226566 2.61681C0.226255 2.66471 0.244845 2.71076 0.278225 2.74476L0.918701 3.39771C0.984629 3.46482 1.09178 3.46565 1.15872 3.39958C2.04834 2.54502 3.2289 2.06849 4.45637 2.0685ZM4.45638 4.19278C5.13073 4.19274 5.78101 4.44601 6.28088 4.90337C6.34849 4.96828 6.45499 4.96688 6.5209 4.9002L7.16045 4.24725C7.19413 4.213 7.21282 4.16654 7.21233 4.11826C7.21185 4.06998 7.19223 4.02391 7.15786 3.99036C5.63568 2.55963 3.27838 2.55963 1.75619 3.99036C1.7218 4.02391 1.70219 4.07001 1.70174 4.1183C1.70128 4.1666 1.72004 4.21305 1.75379 4.24725L2.39316 4.9002C2.45906 4.96688 2.56556 4.96828 2.63317 4.90337C3.13271 4.44631 3.78248 4.19306 4.45638 4.19278ZM5.7375 5.62201C5.73848 5.67042 5.71964 5.7171 5.68544 5.75102L4.57915 6.87913C4.54672 6.91228 4.5025 6.93094 4.45637 6.93094C4.41023 6.93094 4.36602 6.91228 4.33359 6.87913L3.22711 5.75102C3.19293 5.71708 3.17413 5.67038 3.17514 5.62197C3.17615 5.57355 3.19689 5.52771 3.23247 5.49525C3.93899 4.89143 4.97375 4.89143 5.68027 5.49525C5.71582 5.52773 5.73652 5.57359 5.7375 5.62201Z"
            fill="var(--wati-text-body, #1c1c1e)"
          />
        </svg>

        {/* Battery Charging SVG with 100 inside */}
        <svg
          className="tc-status-battery-svg"
          width="17"
          height="9.714285714285714"
          viewBox="0 0 14 8"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M0.545395 1.46718C0.344727 1.86101 0.344727 2.37657 0.344727 3.40768V4.31829C0.344727 5.34941 0.344727 5.86496 0.545395 6.2588C0.721909 6.60523 1.00356 6.88688 1.34999 7.06339C1.74382 7.26406 2.25938 7.26406 3.2905 7.26406H9.83887C10.87 7.26406 11.3856 7.26406 11.7794 7.06339C12.1258 6.88688 12.4075 6.60523 12.584 6.2588C12.7846 5.86496 12.7846 5.34941 12.7846 4.31829V3.40769C12.7846 2.37657 12.7846 1.86101 12.584 1.46718C12.4075 1.12075 12.1258 0.839096 11.7794 0.662583C11.3856 0.461914 10.87 0.461914 9.83887 0.461914H3.2905C2.25938 0.461914 1.74382 0.461914 1.34999 0.662583C1.00356 0.839096 0.721909 1.12075 0.545395 1.46718ZM13.9475 3.86291C13.9475 4.36841 13.6816 4.81181 13.2821 5.06089V2.66493C13.6816 2.91402 13.9475 3.35741 13.9475 3.86291Z"
            fill="var(--wati-text-body, #1c1c1e)"
          />
          <path
            d="M3.78984 1.82523V5.52637H3.11937V2.47763H3.09768L2.23204 3.03063V2.41619L3.1519 1.82523H3.78984ZM6.09762 5.59685C5.80004 5.59685 5.54462 5.52155 5.33137 5.37095C5.11933 5.21914 4.95608 5.00047 4.84162 4.71494C4.72837 4.4282 4.67175 4.08302 4.67175 3.67941C4.67295 3.27581 4.73018 2.93244 4.84343 2.64931C4.95789 2.36498 5.12114 2.14812 5.33318 1.99872C5.54643 1.84933 5.80124 1.77463 6.09762 1.77463C6.394 1.77463 6.64882 1.84933 6.86207 1.99872C7.07532 2.14812 7.23857 2.36498 7.35182 2.64931C7.46627 2.93365 7.5235 3.27701 7.5235 3.67941C7.5235 4.08423 7.46627 4.43 7.35182 4.71674C7.23857 5.00228 7.07532 5.22035 6.86207 5.37095C6.65002 5.52155 6.39521 5.59685 6.09762 5.59685ZM6.09762 5.0312C6.32894 5.0312 6.51147 4.91734 6.6452 4.68964C6.78014 4.46073 6.84761 4.12398 6.84761 3.67941C6.84761 3.38544 6.81689 3.13846 6.75544 2.93847C6.694 2.73847 6.60725 2.58787 6.49521 2.48667C6.38316 2.38426 6.25063 2.33306 6.09762 2.33306C5.86751 2.33306 5.68558 2.44751 5.55185 2.67642C5.41812 2.90413 5.35065 3.23846 5.34945 3.67941C5.34824 3.97459 5.37776 4.22278 5.438 4.42398C5.49944 4.62518 5.58619 4.77698 5.69823 4.87939C5.81028 4.98059 5.94341 5.0312 6.09762 5.0312ZM9.49199 5.59685C9.1944 5.59685 8.93898 5.52155 8.72574 5.37095C8.51369 5.21914 8.35044 5.00047 8.23599 4.71494C8.12274 4.4282 8.06611 4.08302 8.06611 3.67941C8.06731 3.27581 8.12454 2.93244 8.23779 2.64931C8.35225 2.36498 8.5155 2.14812 8.72754 1.99872C8.94079 1.84933 9.19561 1.77463 9.49199 1.77463C9.78837 1.77463 10.0432 1.84933 10.2564 1.99872C10.4697 2.14812 10.6329 2.36498 10.7462 2.64931C10.8606 2.93365 10.9179 3.27701 10.9179 3.67941C10.9179 4.08423 10.8606 4.43 10.7462 4.71674C10.6329 5.00228 10.4697 5.22035 10.2564 5.37095C10.0444 5.52155 9.78957 5.59685 9.49199 5.59685ZM9.49199 5.0312C9.72331 5.0312 9.90583 4.91734 10.0396 4.68964C10.1745 4.46073 10.242 4.12398 10.242 3.67941C10.242 3.38544 10.2112 3.13846 10.1498 2.93847C10.0884 2.73847 10.0016 2.58787 9.88957 2.48667C9.77752 2.38426 9.64499 2.33306 9.49199 2.33306C9.26187 2.33306 9.07995 2.44751 8.94621 2.67642C8.81248 2.90413 8.74501 3.23846 8.74381 3.67941C8.7426 3.97459 8.77212 4.22278 8.83236 4.42398C8.8938 4.62518 8.98055 4.77698 9.0926 4.87939C9.20464 4.98059 9.33777 5.0312 9.49199 5.0312Z"
            fill="white"
          />
        </svg>
      </div>
    </div>
  );
}

export function TemplatePhonePreview({
  kind = 'standard',
  header,
  body,
  footer,
  buttons = [],
  cards = [],
  offer = null,
  placeholder = 'Your message body will appear here…',
  highlightVars = false,
  businessName = 'Kapso Solutions',
  businessAvatar = '/image.png',
  showTitle = true,
}: TemplatePhonePreviewProps) {
  const isCarousel = kind === 'carousel';
  const isOffer = kind === 'lto';
  const bodyNode = body ? renderFormattedBody(body, highlightVars) : placeholder;

  const currentTime = useMemo(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }, []);

  return (
    <div className="tc-phone-container">
      {showTitle && <div className="tc-preview-title">Preview</div>}

      <div className="tc-phone">
        <PhoneStatusBar />

        {/* WhatsApp White Header */}
        <div className="tc-wa-head">
          <button type="button" className="tc-wa-back" aria-label="Back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <div className="tc-wa-av">
            <img
              src={businessAvatar || '/image.png'}
              alt={businessName}
              className="tc-wa-av-img"
              onError={(e) => {
                (e.currentTarget as HTMLElement).style.display = 'none';
              }}
            />
          </div>

          <div className="tc-wa-id">
            <div className="tc-wa-name-row">
              <span className="tc-wa-name">{businessName}</span>
              {/* WhatsApp Verified Blue Tick */}
              <svg className="tc-wa-verified" width="15" height="15" viewBox="-1 -1 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M51.6083 27.0003L53.2669 21.8803C54.5069 18.0483 52.7816 13.8803 49.1949 12.0483L44.4029 9.60028L41.9549 4.80828C40.1229 1.22161 35.9549 -0.506392 32.1229 0.736275L27.0003 2.39228L21.8803 0.733609C18.0483 -0.506391 13.8803 1.21894 12.0483 4.80561L9.59761 9.59761L4.80561 12.0483C1.21894 13.8803 -0.506391 18.0483 0.733609 21.8803L2.39228 27.0003L0.733609 32.1203C-0.506391 35.9523 1.21894 40.1203 4.80561 41.9523L9.59761 44.4003L12.0456 49.1923C13.8776 52.7789 18.0456 54.5069 21.8776 53.2643L27.0003 51.6083L32.1203 53.2669C35.9523 54.5069 40.1203 52.7816 41.9523 49.1949L44.4003 44.4029L49.1923 41.9549C52.7789 40.1229 54.5069 35.9549 53.2643 32.1229L51.6083 27.0003ZM22.4483 36.8856L16.3336 30.7709C15.2936 29.7309 15.2936 28.0403 16.3336 27.0003C17.3736 25.9603 19.0643 25.9603 20.1043 27.0003L24.3336 31.2296L36.5629 19.0003C37.6029 17.9603 39.2936 17.9603 40.3336 19.0003C41.3736 20.0403 41.3736 21.7309 40.3336 22.7709L26.2189 36.8856C25.1789 37.9256 23.4883 37.9256 22.4483 36.8856Z"
                  fill="#007aff"
                />
              </svg>
            </div>
          </div>

          <div className="tc-wa-actions">
            {/* Catalog icon SVG */}
            <svg
              className="tc-wa-act-icon tc-wa-catalog-icon"
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="14"
              viewBox="0 0 16 14"
              fill="none"
              aria-label="Catalog"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M15.2823 5.28027V5.57615C15.2823 6.2422 14.6043 7.15761 13.7679 7.15761C12.9844 7.15761 12.3477 6.30672 12.2695 5.69965C12.1905 6.30672 11.5539 7.15761 10.7707 7.15761C9.98669 7.15761 9.35041 6.30672 9.27184 5.69965C9.19328 6.30672 8.55659 7.15761 7.773 7.15761C6.98901 7.15761 6.35273 6.30672 6.27417 5.69965C6.19601 6.30672 5.55891 7.15761 4.77533 7.15761C3.99174 7.15761 3.35546 6.30672 3.2769 5.69965C3.19833 6.30672 2.56124 7.15761 1.77806 7.15761C0.941689 7.15761 0.263672 6.2422 0.263672 5.57615V5.28027H15.2823Z"
                fill="#353735"
              />
              <path
                d="M0.616211 8.09643V11.8511C0.616211 12.6935 1.29913 13.3764 2.14154 13.3764H9.65088C10.4933 13.3764 11.1762 12.6935 11.1762 11.8511V8.09643C11.1762 7.77243 10.9136 7.50977 10.5895 7.50977C10.2655 7.50977 10.0029 7.77243 10.0029 8.09643V11.8511C10.0029 12.0455 9.84528 12.2031 9.65088 12.2031H2.14154C1.94714 12.2031 1.78954 12.0455 1.78954 11.8511V8.09643C1.78954 7.77243 1.52688 7.50977 1.20288 7.50977C0.878871 7.50977 0.616211 7.77243 0.616211 8.09643Z"
                fill="#353735"
              />
              <path
                d="M0.908737 1.08736L0.0646314 3.90336C-0.177253 4.71031 0.280819 5.56055 1.08776 5.80244C1.22985 5.84503 1.3774 5.86667 1.52573 5.86667H14.0218C14.8642 5.86667 15.5471 5.18375 15.5471 4.34133C15.5471 4.193 15.5255 4.04545 15.4829 3.90336L14.6388 1.08736C14.4454 0.442005 13.8514 0 13.1777 0H2.36984C1.74103 0 1.18173 0.385035 0.952672 0.961073L0.908737 1.08736ZM2.03266 1.42426C2.0773 1.27533 2.21437 1.17333 2.36984 1.17333H13.1777C13.3332 1.17333 13.4702 1.27533 13.5149 1.42426L14.359 4.24026C14.3688 4.27305 14.3738 4.3071 14.3738 4.34133C14.3738 4.53574 14.2162 4.69333 14.0218 4.69333H1.52573C1.4915 4.69333 1.45745 4.68834 1.42466 4.67851C1.23845 4.62269 1.13274 4.42648 1.18856 4.24026L2.03266 1.42426Z"
                fill="#353735"
              />
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M13.8777 7.53516C14.1887 7.53516 14.4409 7.78731 14.4409 8.09836V12.7917C14.4409 13.1027 14.1887 13.3549 13.8777 13.3549C13.5666 13.3549 13.3145 13.1027 13.3145 12.7917V8.09836C13.3145 7.78731 13.5666 7.53516 13.8777 7.53516Z"
                fill="#353735"
              />
            </svg>
            <span className="material-icons tc-wa-act-icon">more_vert</span>
          </div>
        </div>

        {/* Chat Body */}
        <div className="pv-chat">
          {/* Meta Security Service Banner */}
          <div className="pv-meta-notice">
            <span className="material-icons pv-notice-ic">info</span>
            <span>This business uses a secure service from Meta to manage this chat. Tap to learn more</span>
          </div>

          <div className="pv-bubble">
            {/* Carousels have no header: the media lives on the cards. */}
            {!isCarousel && header.type === 'image' && (
              <MediaBox format="image" url={header.url} className="pv-media-img" />
            )}
            {!isCarousel && header.type === 'video' && (
              <MediaBox format="video" url={header.url} className="pv-media-img" />
            )}
            {!isCarousel && header.type === 'document' && (
              <div className="pv-doc">
                <span className="pv-doc-ic">PDF</span>
                <span className="pv-doc-name">{header.fileName || 'Document'}</span>
              </div>
            )}
            {!isCarousel && header.type === 'text' && header.text && <div className="pv-header">{header.text}</div>}

            {isOffer && (
              <div className="pv-offer">
                <span className="pv-offer-ic material-icons">redeem</span>
                <div className="pv-offer-main">
                  <div className="pv-offer-title">{offer?.text || 'Offer label'}</div>
                  {offer?.hasExpiration && <div className="pv-offer-ends">{endsLabel(offer.endsAt)}</div>}
                  {offer?.hasCopyCode && <div className="pv-offer-code">{offer.code || 'CODE'}</div>}
                </div>
              </div>
            )}

            <div className="pv-body">{bodyNode}</div>
            {!isCarousel && !isOffer && footer && <div className="pv-footer">{footer}</div>}
            <div className="pv-time">{currentTime}</div>

            {/* In Image 1, Action buttons are clean stacked list items attached under the bubble */}
            {!isCarousel && (buttons.length > 0 || (isOffer && offer?.hasCopyCode)) && (
              <div className="pv-actions-list">
                {isOffer && offer?.hasCopyCode && (
                  <div className="pv-act-btn">
                    <CopyIcon />
                    <span>Copy offer code</span>
                  </div>
                )}
                {buttons.map((b, i) => (
                  <div className="pv-act-btn" key={i}>
                    {String(b.type).toUpperCase() === 'CATALOG' || String(b.type).toUpperCase() === 'MPM' || /catalog|items?/i.test(b.text || '') ? (
                      <CatalogActionSvg />
                    ) : (
                      <AppIcon name={btnIcon(b.type)} />
                    )}
                    <span>{b.text || 'Button'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Carousel cards */}
          {isCarousel && (
            <div className="pv-cards" aria-label="Carousel cards">
              {(cards.length ? cards : [{ mediaFormat: 'image', buttons: [] } as PreviewCard]).map((card, i) => (
                <div className="pv-card" key={i}>
                  <MediaBox format={card.mediaFormat} url={card.mediaUrl} className="pv-card-media" />
                  {card.body && <div className="pv-card-body">{card.body}</div>}
                  {card.buttons.length > 0 && (
                    <div className="pv-card-btns">
                      {card.buttons.map((b, j) => (
                        <div className="pv-card-btn" key={j}>
                          {String(b.type).toUpperCase() === 'CATALOG' || String(b.type).toUpperCase() === 'MPM' || /catalog|items?/i.test(b.text || '') ? (
                            <CatalogActionSvg />
                          ) : (
                            <AppIcon name={btnIcon(b.type)} />
                          )}
                          <span>{b.text || 'Button'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* WhatsApp Mobile Bottom Bar */}
        <div className="tc-wa-foot">
          <button type="button" className="tc-foot-btn" aria-label="Add attachment">
            <span className="material-icons">add</span>
          </button>
          <div className="tc-wa-foot-pill">
            <span className="tc-foot-placeholder"></span>
            <span className="material-icons tc-foot-sticker">filter_none</span>
          </div>
          <button type="button" className="tc-foot-btn" aria-label="Camera">
            <span className="material-icons">photo_camera</span>
          </button>
          <button type="button" className="tc-foot-btn" aria-label="Voice">
            <span className="material-icons">mic</span>
          </button>
        </div>
      </div>
    </div>
  );
}
