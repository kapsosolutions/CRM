// Slide-in template drawer: list approved/pending templates with a view action
// opening full WhatsApp phone preview + send action, or navigate to full template page.
import { useState } from 'react';
import { useBackHandler } from '../useBackHandler';
import type { CrmApi } from '../api';
import type { TemplateItem } from '../types';
import { TemplateCreate } from './TemplateCreate';
import { TemplatePhonePreview, previewPropsFromTemplate } from './TemplatePhonePreview';
import { Dropdown } from './Dropdown';
import { OTP_MAX_LENGTH, authBodyWithCode, generateOtp, isAuthTemplate, otpProblem } from '../authTemplate';
import './AuthTemplate.css';

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;
const bodyComp = (t: TemplateItem) => (t.components || []).find((c) => String(c.type).toUpperCase() === 'BODY');
/** The body text with its {{n}} placeholders (Meta's copy, else ours). */
export function templateBodyText(t: TemplateItem): string {
  return bodyComp(t)?.text || t.bodyText || '';
}
/** How many {{n}} values the body takes (the highest n). */
export function templateVarCount(t: TemplateItem): number {
  let n = 0;
  for (const m of templateBodyText(t).matchAll(VAR_RE)) n = Math.max(n, Number(m[1]));
  return n;
}
/** {{n}} replaced by the typed value; a blank value keeps the placeholder. */
export function fillVars(text: string, values: string[]): string {
  return text.replace(VAR_RE, (m, n) => values[Number(n) - 1]?.trim() || m);
}
/** Meta's sample values for the body, one per {{n}}. */
function varExamples(t: TemplateItem): string[] {
  const ex = bodyComp(t)?.example?.body_text?.[0] || [];
  return Array.from({ length: templateVarCount(t) }, (_, i) => String(ex[i] ?? ''));
}
/** A greeting placeholder ("Hi {{1}}", "Hello {{1}}", "Dear {{1}}"): that one is the customer's name. */
const GREETING_VAR = /\b(hi|hello|hey|dear|namaste)\s*,?\s*\{\{\s*1\s*\}\}/i;
/**
 * The values a one-tap send uses for a sample template: the customer's name
 * for a greeting's {{1}} ("there" when the chat has no name), Meta's sample
 * values for the rest (an order number, a date…).
 */
function quickValues(t: TemplateItem, contactName: string): string[] {
  const values = varExamples(t);
  if (values.length && GREETING_VAR.test(templateBodyText(t))) values[0] = contactName.trim() || 'there';
  return values;
}

interface Props {
  api: CrmApi;
  templates: TemplateItem[];
  tSending: boolean;
  onClose: () => void;
  /**
   * `otpCode` is set for authentication templates: the code to send.
   * `bodyParams`: the {{n}} values typed for a shared sample template.
   */
  onSend: (t: TemplateItem, otpCode?: string, bodyParams?: string[]) => void;
  onCreated: () => void;
  onOpenTemplatesPage?: () => void;
  onOpenTemplateCreate?: () => void;
  /** Open straight on "Send OTP" with this authentication template chosen (Retry). */
  initialOtpTemplate?: string;
  /** The open chat's customer name, for a sample template's "Hi {{1}}". */
  contactName?: string;
}

function ViewIconSvg({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2 10C3.8 6.5 6.5 4.5 10 4.5C13.5 4.5 16.2 6.5 18 10C16.2 13.5 13.5 15.5 10 15.5C6.5 15.5 3.8 13.5 2 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function SendIconSvg({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M17.6469 7.54313L4.8136 1.12646C4.30714 0.874384 3.73525 0.784643 3.17592 0.869473C2.61658 0.954302 2.09702 1.20957 1.68807 1.60048C1.27912 1.99139 1.00068 2.49891 0.890721 3.05385C0.780757 3.60879 0.84462 4.18414 1.0736 4.70146L3.2736 9.62396C3.32352 9.74297 3.34923 9.87074 3.34923 9.99979C3.34923 10.1288 3.32352 10.2566 3.2736 10.3756L1.0736 15.2981C0.887244 15.7168 0.808462 16.1754 0.844415 16.6322C0.880368 17.0891 1.02992 17.5297 1.27947 17.914C1.52902 18.2984 1.87067 18.6143 2.27336 18.833C2.67605 19.0517 3.12701 19.1663 3.58527 19.1665C4.01448 19.1622 4.4373 19.062 4.82277 18.8731L17.6561 12.4565C18.1113 12.2275 18.494 11.8765 18.7613 11.4427C19.0287 11.0089 19.1703 10.5094 19.1703 9.99979C19.1703 9.49022 19.0287 8.99068 18.7613 8.55689C18.494 8.1231 18.1113 7.77212 17.6561 7.54313H17.6469ZM16.8311 10.8156L3.99777 17.2323C3.82925 17.3132 3.64002 17.3407 3.45546 17.311C3.27089 17.2813 3.09981 17.1959 2.96516 17.0662C2.8305 16.9366 2.73871 16.7688 2.70209 16.5855C2.66547 16.4022 2.68577 16.2121 2.76027 16.0406L4.9511 11.1181C4.97946 11.0524 5.00395 10.9851 5.02444 10.9165H11.3403C11.5834 10.9165 11.8165 10.8199 11.9884 10.648C12.1604 10.4761 12.2569 10.2429 12.2569 9.99979C12.2569 9.75668 12.1604 9.52352 11.9884 9.35161C11.8165 9.1797 11.5834 9.08313 11.3403 9.08313H5.02444C5.00395 9.01453 4.97946 8.94719 4.9511 8.88146L2.76027 3.95896C2.68577 3.78751 2.66547 3.59738 2.70209 3.41406C2.73871 3.23075 2.8305 3.06301 2.96516 2.93334C3.09981 2.80368 3.27089 2.71828 3.45546 2.6886C3.64002 2.65892 3.82925 2.68638 3.99777 2.76729L16.8311 9.18396C16.9813 9.26088 17.1073 9.37776 17.1953 9.5217C17.2832 9.66565 17.3298 9.83108 17.3298 9.99979C17.3298 10.1685 17.2832 10.3339 17.1953 10.4779C17.1073 10.6218 16.9813 10.7387 16.8311 10.8156Z" fill="#23A455" />
    </svg>
  );
}

export function TemplateDrawer({
  api,
  templates,
  tSending,
  onClose,
  onSend,
  onCreated,
  onOpenTemplatesPage,
  onOpenTemplateCreate,
  initialOtpTemplate,
  contactName = '',
}: Props) {
  const [mode, setMode] = useState<'list' | 'create' | 'otp'>(initialOtpTemplate ? 'otp' : 'list');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null);

  // ---- Send OTP: an approved authentication template + the code ----
  const otpTemplates = templates.filter((t) => isAuthTemplate(t) && t.status === 'APPROVED');
  const [otpName, setOtpName] = useState(initialOtpTemplate || '');
  const [otpCode, setOtpCode] = useState('');
  const [otpTouched, setOtpTouched] = useState(false);
  const otpTemplate = otpTemplates.find((t) => t.name === otpName) || otpTemplates[0] || null;
  const codeProblem = otpProblem(otpCode);

  function openOtp(t?: TemplateItem) {
    setSelectedTemplate(null);
    if (t) setOtpName(t.name);
    setOtpCode('');
    setOtpTouched(false);
    setMode('otp');
  }
  // ---- Shared sample templates: the {{n}} values, prefilled with Meta's samples ----
  const [varValues, setVarValues] = useState<string[]>([]);
  function openPreview(t: TemplateItem) {
    setSelectedTemplate(t);
    setVarValues(t.shared ? quickValues(t, contactName) : []);
  }
  const sharedVars = !!selectedTemplate?.shared && templateVarCount(selectedTemplate) > 0;

  /**
   * The send icon sends straight away. An authentication template still needs
   * its code first. A sample template with {{n}} goes out with the customer's
   * name and Meta's sample values; from the preview (the eye), with the values
   * typed there.
   */
  function sendOrAskCode(t: TemplateItem) {
    if (isAuthTemplate(t)) openOtp(t);
    else if (t.shared && templateVarCount(t) > 0) {
      const values = selectedTemplate?.name === t.name ? varValues : quickValues(t, contactName);
      onSend(t, undefined, values.map((v) => v.trim()));
    } else onSend(t);
  }
  function sendOtp() {
    setOtpTouched(true);
    if (!otpTemplate || codeProblem) return;
    onSend(otpTemplate, otpCode.trim());
  }

  // Back: leaves preview first, then "create" / "Send OTP", then closes drawer.
  useBackHandler(true, () => {
    if (selectedTemplate) {
      setSelectedTemplate(null);
    } else if (mode !== 'list') {
      setMode('list');
    } else {
      onClose();
    }
  });

  function handleCreateClick() {
    if (onOpenTemplateCreate) {
      onClose();
      onOpenTemplateCreate();
    } else if (onOpenTemplatesPage) {
      onClose();
      onOpenTemplatesPage();
    } else {
      setMode('create');
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="tmpl-drawer">
        <header className="drawer-head">
          {selectedTemplate ? (
            <>
              <button
                className="icon-btn"
                onClick={() => setSelectedTemplate(null)}
                aria-label="Back to templates"
                title="Back to templates"
              >
                <span className="material-icons">arrow_back</span>
              </button>
              <div className="drawer-head-preview-title">
                <h3 title={selectedTemplate.name}>{selectedTemplate.name}</h3>
                <span
                  className={`k-chip sm ${selectedTemplate.status === 'APPROVED' ? 'green' : 'amber'}`}
                >
                  {selectedTemplate.status || 'PENDING'}
                </span>
              </div>
              <button
                className="ic-send"
                disabled={selectedTemplate.status !== 'APPROVED' || tSending}
                title="Send template"
                onClick={() => sendOrAskCode(selectedTemplate)}
                aria-label="Send template"
              >
                <SendIconSvg size={20} />
              </button>
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <span className="material-icons">close</span>
              </button>
            </>
          ) : mode === 'otp' ? (
            <>
              <button className="icon-btn" onClick={() => setMode('list')} aria-label="Back to templates">
                <span className="material-icons">arrow_back</span>
              </button>
              <h3>Send OTP</h3>
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <span className="material-icons">close</span>
              </button>
            </>
          ) : mode === 'create' ? (
            <>
              <button className="icon-btn" onClick={() => setMode('list')} aria-label="Back">
                <span className="material-icons">arrow_back</span>
              </button>
              <h3>New template</h3>
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <span className="material-icons">close</span>
              </button>
            </>
          ) : (
            <>
              <h3>Templates</h3>
              <button
                className="tmpl-drawer-create-btn"
                onClick={handleCreateClick}
                title="Create template"
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M4 2.5H11L15 6.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M11 2.5V6.5H15" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M4 2.5C3.17157 2.5 2.5 3.17157 2.5 4V16C2.5 16.8284 3.17157 17.5 4 17.5H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M11.5 15.5L15.8 11.2C16.1866 10.8134 16.8134 10.8134 17.2 11.2C17.5866 11.5866 17.5866 12.2134 17.2 12.6L12.9 16.9L10.5 17.5L11.5 15.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Create</span>
              </button>
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <span className="material-icons">close</span>
              </button>
            </>
          )}
        </header>

        <div className="drawer-body">
          {selectedTemplate ? (
            <>
              {sharedVars && (
                <section className="drawer-sec tmpl-shared-vars" data-testid="tmpl-shared-vars">
                  <p className="k-hint">Fill in the values for this message. Meta’s sample values are filled in to start with.</p>
                  {varValues.map((v, i) => (
                    <div className="k-field" key={i}>
                      <label className="k-label" htmlFor={`tmpl-var-${i}`}>{`{{${i + 1}}}`}</label>
                      <input
                        id={`tmpl-var-${i}`}
                        className="k-input"
                        value={v}
                        maxLength={200}
                        onChange={(e) => setVarValues((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                    </div>
                  ))}
                </section>
              )}
              <div className="tmpl-preview-wrap full-preview">
                <TemplatePhonePreview
                  {...previewPropsFromTemplate(selectedTemplate)}
                  {...(sharedVars ? { body: fillVars(templateBodyText(selectedTemplate), varValues) } : {})}
                  showTitle={false}
                />
              </div>
              {sharedVars && (
                <button
                  type="button"
                  className="k-btn at-otp-send"
                  disabled={selectedTemplate.status !== 'APPROVED' || tSending}
                  title={selectedTemplate.status !== 'APPROVED' ? 'It can be sent once WhatsApp approves it' : undefined}
                  onClick={() => sendOrAskCode(selectedTemplate)}
                  data-testid="tmpl-shared-send"
                >
                  <SendIconSvg size={18} /> Send template
                </button>
              )}
            </>
          ) : mode === 'otp' ? (
            <section className="drawer-sec at-otp-pane">
              {otpTemplates.length === 0 ? (
                <p className="muted-note">
                  No approved authentication template yet. Create one in Templates with the category{' '}
                  <strong>Authentication (one-time code)</strong>; it can be sent once WhatsApp approves it.{' '}
                  <button
                    type="button"
                    className="k-btn ghost sm"
                    onClick={handleCreateClick}
                    style={{ marginTop: 10 }}
                  >
                    Create template
                  </button>
                </p>
              ) : (
                <>
                  <div className="k-field">
                    <label className="k-label">Authentication template</label>
                    <Dropdown
                      options={otpTemplates.map((t) => ({ value: t.name, label: t.name }))}
                      value={otpTemplate?.name || ''}
                      onChange={setOtpName}
                    />
                  </div>
                  <div className="k-field">
                    <label className="k-label" htmlFor="at-otp-code">Code</label>
                    <div className="at-otp-code-row">
                      <input
                        id="at-otp-code"
                        className="k-input"
                        value={otpCode}
                        maxLength={OTP_MAX_LENGTH}
                        placeholder="Type the code"
                        autoComplete="off"
                        onChange={(e) => setOtpCode(e.target.value.replace(/\s+/g, ''))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            sendOtp();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="k-btn ghost sm"
                        onClick={() => {
                          setOtpCode(generateOtp());
                          setOtpTouched(false);
                        }}
                      >
                        <span className="material-icons">casino</span> Generate
                      </button>
                    </div>
                    {otpTouched && codeProblem ? (
                      <p className="err">{codeProblem}</p>
                    ) : (
                      <p className="k-hint">Up to {OTP_MAX_LENGTH} characters. The customer can copy it with one tap.</p>
                    )}
                  </div>
                  {otpTemplate && (
                    <div className="tmpl-preview-wrap full-preview">
                      <TemplatePhonePreview
                        {...previewPropsFromTemplate(otpTemplate)}
                        body={authBodyWithCode(otpTemplate, otpCode.trim() || '{{1}}')}
                        showTitle={false}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    className="k-btn at-otp-send"
                    disabled={tSending || !otpTemplate}
                    onClick={sendOtp}
                  >
                    <SendIconSvg size={18} /> Send code
                  </button>
                </>
              )}
            </section>
          ) : mode === 'create' ? (
            <TemplateCreate
              api={api}
              onCreated={() => {
                onCreated();
                setMode('list');
              }}
            />
          ) : (
            <section className="drawer-sec">
              {/* No separate "Send OTP" entry: an authentication template's send
                  icon below still asks for the code first (openOtp). */}
              <div className="sec-title">Send a template</div>
              {templates.length === 0 && (
                <p className="muted-note">
                  No templates yet. Tap{' '}
                  <button
                    type="button"
                    onClick={handleCreateClick}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--wa-teal, #24d06e)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0,
                      font: 'inherit',
                      textDecoration: 'underline',
                    }}
                  >
                    Create
                  </button>{' '}
                  to create one.
                </p>
              )}
              {templates.map((t) => (
                <div key={t.name} className="tmpl-item" data-testid="tmpl-item" data-name={t.name} data-shared={t.shared ? '1' : undefined}>
                  <div
                    className="tmpl-info"
                    onClick={() => openPreview(t)}
                    title="View preview"
                  >
                    <span className="tmpl-name">{t.name}</span>
                    {t.shared && <span className="k-chip sm" title="A sample template of the shared test number">Sample</span>}
                    <span
                      className={`k-chip sm ${t.status === 'APPROVED' ? 'green' : 'amber'}`}
                    >
                      {t.status || 'PENDING'}
                    </span>
                  </div>

                  <div className="tmpl-actions">
                    <button
                      className="ic-view"
                      title="Preview template"
                      onClick={() => openPreview(t)}
                      aria-label="Preview template"
                    >
                      <ViewIconSvg size={18} />
                    </button>
                    <button
                      className="ic-send"
                      disabled={t.status !== 'APPROVED' || tSending}
                      title={isAuthTemplate(t) ? 'Send a code with this template' : 'Send template'}
                      onClick={() => sendOrAskCode(t)}
                      aria-label="Send template"
                    >
                      <SendIconSvg size={20} />
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
