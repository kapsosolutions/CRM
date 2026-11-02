import { useMemo } from 'react';
import { PhoneStatusBar } from './PhoneStatusBar';
import './BusinessProfilePhonePreview.css';

export interface BusinessProfilePhonePreviewProps {
  businessName?: string;
  phone?: string;
  avatarUrl?: string;
  about?: string;
  description?: string;
  address?: string;
  email?: string;
  categoryLabel?: string;
  websites?: string[];
  products?: { name: string; imageUrl?: string; price?: number }[];
  hasCatalog?: boolean;
}

function WaCatalogIcon() {
  return (
    <svg className="tc-wa-act-icon tc-wa-catalog-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="14" viewBox="0 0 16 14" fill="none" aria-label="Catalog">
      <path fillRule="evenodd" clipRule="evenodd" d="M15.2823 5.28027V5.57615C15.2823 6.2422 14.6043 7.15761 13.7679 7.15761C12.9844 7.15761 12.3477 6.30672 12.2695 5.69965C12.1905 6.30672 11.5539 7.15761 10.7707 7.15761C9.98669 7.15761 9.35041 6.30672 9.27184 5.69965C9.19328 6.30672 8.55659 7.15761 7.773 7.15761C6.98901 7.15761 6.35273 6.30672 6.27417 5.69965C6.19601 6.30672 5.55891 7.15761 4.77533 7.15761C3.99174 7.15761 3.35546 6.30672 3.2769 5.69965C3.19833 6.30672 2.56124 7.15761 1.77806 7.15761C0.941689 7.15761 0.263672 6.2422 0.263672 5.57615V5.28027H15.2823Z" fill="currentColor" />
      <path d="M0.616211 8.09643V11.8511C0.616211 12.6935 1.29913 13.3764 2.14154 13.3764H9.65088C10.4933 13.3764 11.1762 12.6935 11.1762 11.8511V8.09643C11.1762 7.77243 10.9136 7.50977 10.5895 7.50977C10.2655 7.50977 10.0029 7.77243 10.0029 8.09643V11.8511C10.0029 12.0455 9.84528 12.2031 9.65088 12.2031H2.14154C1.94714 12.2031 1.78954 12.0455 1.78954 11.8511V8.09643C1.78954 7.77243 1.52688 7.50977 1.20288 7.50977C0.878871 7.50977 0.616211 7.77243 0.616211 8.09643Z" fill="currentColor" />
      <path d="M0.908737 1.08736L0.0646314 3.90336C-0.177253 4.71031 0.280819 5.56055 1.08776 5.80244C1.22985 5.84503 1.3774 5.86667 1.52573 5.86667H14.0218C14.8642 5.86667 15.5471 5.18375 15.5471 4.34133C15.5471 4.193 15.5255 4.04545 15.4829 3.90336L14.6388 1.08736C14.4454 0.442005 13.8514 0 13.1777 0H2.36984C1.74103 0 1.18173 0.385035 0.952672 0.961073L0.908737 1.08736ZM2.03266 1.42426C2.0773 1.27533 2.21437 1.17333 2.36984 1.17333H13.1777C13.3332 1.17333 13.4702 1.27533 13.5149 1.42426L14.359 4.24026C14.3688 4.27305 14.3738 4.3071 14.3738 4.34133C14.3738 4.53574 14.2162 4.69333 14.0218 4.69333H1.52573C1.4915 4.69333 1.45745 4.68834 1.42466 4.67851C1.23845 4.62269 1.13274 4.42648 1.18856 4.24026L2.03266 1.42426Z" fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d="M13.8777 7.53516C14.1887 7.53516 14.4409 7.78731 14.4409 8.09836V12.7917C14.4409 13.1027 14.1887 13.3549 13.8777 13.3549C13.5666 13.3549 13.3145 13.1027 13.3145 12.7917V8.09836C13.3145 7.78731 13.5666 7.53516 13.8777 7.53516Z" fill="currentColor" />
    </svg>
  );
}

function ShareArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function LocationPinIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function InfoCircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export function BusinessProfilePhonePreview({
  businessName = 'P Venkataramanan',
  phone = '+1 (555) 407-1944',
  avatarUrl,
  about,
  description = 'it is description',
  address,
  email,
  categoryLabel = 'Other',
  websites = [],
  products = [],
  hasCatalog = true,
}: BusinessProfilePhonePreviewProps) {
  const displayProducts = useMemo(() => {
    if (products && products.length > 0) return products.slice(0, 3);
    return [];
  }, [products]);

  const cleanWebsites = websites.filter(Boolean);
  const bizInitial = (businessName.trim()[0] || 'B').toUpperCase();

  return (
    <div className="bpp-phone-container">
      <div className="bpp-phone-label">
        <span>Customer view on WhatsApp</span>
      </div>

      <div className="bpp-phone-frame">
        <PhoneStatusBar />

        {/* Top Navigation Bar */}
        <div className="bpp-nav-bar">
          <button type="button" className="bpp-back-btn" title="Back" aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="bpp-nav-title">Business info</span>
          <div className="bpp-nav-spacer" />
        </div>

        {/* Scrollable Mobile Body */}
        <div className="bpp-scroll-body">
          {/* Hero Profile Block */}
          <div className="bpp-hero-block">
            <div className="bpp-avatar-wrap">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={businessName}
                  className="bpp-avatar-img"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <div className="bpp-avatar-initial">{bizInitial}</div>
              )}
            </div>

            <div className="bpp-hero-name-row">
              <h4 className="bpp-hero-name">{businessName}</h4>
              <span title="Verified Business" className="bpp-verified-badge-wrap">
                <svg className="bpp-verified-badge" width="15" height="15" viewBox="-1 -1 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M51.6083 27.0003L53.2669 21.8803C54.5069 18.0483 52.7816 13.8803 49.1949 12.0483L44.4029 9.60028L41.9549 4.80828C40.1229 1.22161 35.9549 -0.506392 32.1229 0.736275L27.0003 2.39228L21.8803 0.733609C18.0483 -0.506391 13.8803 1.21894 12.0483 4.80561L9.59761 9.59761L4.80561 12.0483C1.21894 13.8803 -0.506391 18.0483 0.733609 21.8803L2.39228 27.0003L0.733609 32.1203C-0.506391 35.9523 1.21894 40.1203 4.80561 41.9523L9.59761 44.4003L12.0456 49.1923C13.8776 52.7789 18.0456 54.5069 21.8776 53.2643L27.0003 51.6083L32.1203 53.2669C35.9523 54.5069 40.1203 52.7816 41.9523 49.1949L44.4003 44.4029L49.1923 41.9549C52.7789 40.1229 54.5069 35.9549 53.2643 32.1229L51.6083 27.0003ZM22.4483 36.8856L16.3336 30.7709C15.2936 29.7309 15.2936 28.0403 16.3336 27.0003C17.3736 25.9603 19.0643 25.9603 20.1043 27.0003L24.3336 31.2296L36.5629 19.0003C37.6029 17.9603 39.2936 17.9603 40.3336 19.0003C41.3736 20.0403 41.3736 21.7309 40.3336 22.7709L26.2189 36.8856C25.1789 37.9256 23.4883 37.9256 22.4483 36.8856Z"
                    fill="#007aff"
                  />
                </svg>
              </span>
            </div>

            <p className="bpp-hero-phone">{phone}</p>
            {about && <p className="bpp-hero-about">"{about}"</p>}
          </div>

          {/* Action Pills Row */}
          <div className="bpp-action-pills">
            {hasCatalog && (
              <div className="bpp-action-pill">
                <span className="bpp-action-icon">
                  <WaCatalogIcon />
                </span>
                <span className="bpp-action-text">Catalog</span>
              </div>
            )}
            <div className="bpp-action-pill">
              <span className="bpp-action-icon">
                <ShareArrowIcon />
              </span>
              <span className="bpp-action-text">Share</span>
            </div>
            <div className="bpp-action-pill">
              <span className="bpp-action-icon">
                <SearchIcon />
              </span>
              <span className="bpp-action-text">Search</span>
            </div>
          </div>

          {/* Catalog Section */}
          {hasCatalog && displayProducts.length > 0 && (
            <div className="bpp-card bpp-catalog-card">
              <div className="bpp-card-header">
                <span className="bpp-card-title">Catalog</span>
                <span className="bpp-see-all">See all ›</span>
              </div>
              <div className="bpp-product-row">
                {displayProducts.map((p, idx) => (
                  <div className="bpp-product-item" key={idx}>
                    <div className="bpp-product-thumb">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt={p.name} />
                      ) : (
                        <div className="bpp-product-fallback">
                          <WaCatalogIcon />
                        </div>
                      )}
                    </div>
                    <span className="bpp-product-name">{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Category & Description Card */}
          <div className="bpp-card">
            <div className="bpp-info-row">
              <span className="bpp-row-icon">
                <BriefcaseIcon />
              </span>
              <div className="bpp-row-content">
                <span className="bpp-row-title">{categoryLabel || 'Other'}</span>
              </div>
            </div>

            {description && (
              <div className="bpp-desc-text">
                {description}
              </div>
            )}
          </div>

          {/* Contact Details Card (Address, Email, Websites) */}
          {(address || email || cleanWebsites.length > 0) && (
            <div className="bpp-card">
              {address && (
                <div className="bpp-info-row">
                  <span className="bpp-row-icon">
                    <LocationPinIcon />
                  </span>
                  <div className="bpp-row-content">
                    <span className="bpp-row-text">{address}</span>
                  </div>
                </div>
              )}

              {email && (
                <div className="bpp-info-row">
                  <span className="bpp-row-icon">
                    <MailIcon />
                  </span>
                  <div className="bpp-row-content">
                    <span className="bpp-row-text">{email}</span>
                  </div>
                </div>
              )}

              {cleanWebsites.map((web, idx) => (
                <div className="bpp-info-row" key={idx}>
                  <span className="bpp-row-icon">
                    <GlobeIcon />
                  </span>
                  <div className="bpp-row-content">
                    <span className="bpp-row-text bpp-link">{web.replace(/^https?:\/\//i, '')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Business Account Security Notice */}
          <div className="bpp-card bpp-meta-card">
            <span className="bpp-meta-icon">
              <InfoCircleIcon />
            </span>
            <div className="bpp-meta-content">
              <span className="bpp-meta-title">Business account</span>
              <span className="bpp-meta-sub">This account uses WhatsApp Business to connect with customers.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BusinessProfilePhonePreview;
