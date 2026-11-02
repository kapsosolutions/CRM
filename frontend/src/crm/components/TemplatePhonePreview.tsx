// WhatsApp phone mock showing one template message. Shared by the template
// composer (live while typing) and Campaigns (the template being sent).
// Renders all three kinds: standard, media-card carousel and limited-time offer.
import { Fragment, useMemo } from 'react';
import type { TemplateItem } from '../types';
import { CatalogActionSvg } from './MessageItem';
import { PhoneStatusBar } from './PhoneStatusBar';
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

// The phone's status bar, shared by every phone mock (PhoneStatusBar.tsx).
export { PhoneStatusBar };

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
                    <span className="material-icons">content_copy</span>
                    <span>Copy offer code</span>
                  </div>
                )}
                {buttons.map((b, i) => (
                  <div className="pv-act-btn" key={i}>
                    {String(b.type).toUpperCase() === 'CATALOG' || String(b.type).toUpperCase() === 'MPM' || /catalog|items?/i.test(b.text || '') ? (
                      <CatalogActionSvg />
                    ) : (
                      <span className="material-icons">{btnIcon(b.type)}</span>
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
                            <span className="material-icons">{btnIcon(b.type)}</span>
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
