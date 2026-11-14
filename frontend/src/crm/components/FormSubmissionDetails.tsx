// Full-page view of one form submission ("Pre-arrival check-in" from Perivi),
// opened from a row on a form page or on Orders → Form submissions. The
// form's own questions come first, in the order the form asks them, each
// answer drawn in a structured field tile (or an attachment card for photos
// and documents); anything else the customer answered on the way sits under
// "Other answers".
import { useMemo, useState } from 'react';
import type { FormRow, Registration, RegistrationStatus } from '../types';
import type { FormPreset } from '../flowForms';
import type { VerticalConfig } from '../verticals';
import { REG_STATUS, groupedAnswers, isContactPhone } from '../formSubmission';
import { DownloadIcon, WhatsAppIcon } from './AppIcons';
import { Dropdown } from './Dropdown';
import { FormAnswer } from './FormAnswer';
import { Lightbox, type ViewMedia } from './Lightbox';
import { safeUrl } from '../safeUrl';
import { useBackHandler } from '../useBackHandler';

interface Props {
  registration: Registration;
  /** The ready-made form it came from (none for a form built by hand). */
  preset: FormPreset | null;
  vertical?: VerticalConfig;
  onBack: () => void;
  onStatusChange: (r: Registration, status: RegistrationStatus) => void;
  /** Ask, delete, and go back to the list. */
  onDelete: (r: Registration) => void;
  onOpenChat?: (phone: string) => void;
}

const fmtWhen = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

const STATUS_LABEL: Record<string, string> = Object.fromEntries(REG_STATUS.map((s) => [s.value, s.label]));

const isPdf = (f: { name: string; mime: string }) => f.mime === 'application/pdf' || /\.pdf$/i.test(f.name);

/** Icon for a field tile based on its answer type or label. */
function fieldIcon(row: FormRow): string {
  switch (row.type) {
    case 'date': return 'event';
    case 'daterange': return 'date_range';
    case 'phone': return 'call';
    case 'email': return 'mail';
    case 'rating': return 'star';
    case 'multi': return 'checklist';
    case 'consent': return 'verified';
    case 'longtext': return 'notes';
    case 'photo': return 'photo_camera';
    case 'document': return 'description';
    default: {
      const k = `${row.key} ${row.label}`.toLowerCase();
      if (/time|slot|arrival|hour/.test(k)) return 'schedule';
      if (/date|day|check/.test(k)) return 'event';
      if (/guest|passenger|people|pax|adult|child/.test(k)) return 'group';
      if (/vehicle|car|cab|flight|train|pickup|drop|transfer/.test(k)) return 'directions_car';
      if (/id|passport|aadhaar|pan|licence|license/.test(k)) return 'badge';
      if (/room|stay|suite|property/.test(k)) return 'hotel';
      if (/amount|budget|price|cost|salary|fee/.test(k)) return 'payments';
      if (/address|city|location|pin|area/.test(k)) return 'location_on';
      return 'short_text';
    }
  }
}

const isAttachment = (row: FormRow) => row.type === 'photo' || row.type === 'document';
const isWideField = (row: FormRow) =>
  row.type === 'longtext' || row.type === 'multi' || (row.value && row.value.length > 48);

export function FormSubmissionDetails({
  registration: r,
  preset,
  vertical,
  onBack,
  onStatusChange,
  onDelete,
  onOpenChat,
}: Props) {
  useBackHandler(true, onBack);
  const [viewing, setViewing] = useState<ViewMedia | null>(null);

  const { fields, attachments, other } = useMemo(() => {
    const g = groupedAnswers(r, preset);
    const keep = (rows: FormRow[]) => rows.filter((row) => !isContactPhone(row, r));
    const mainClean = keep(g.main);
    const otherClean = keep(g.other);
    return {
      fields: mainClean.filter((row) => !isAttachment(row)),
      attachments: [...mainClean, ...otherClean].filter(isAttachment),
      other: otherClean.filter((row) => !isAttachment(row)),
    };
  }, [r, preset]);

  const title = preset?.title || r.flowName || 'Form submission';
  const who = r.name || (r.phone ? `+${r.phone}` : 'Unknown');
  const shortRef = r._id ? `#${String(r._id).slice(-6).toUpperCase()}` : '';
  const extras: { label: string; value: string; icon: string }[] = [];
  if (r.category) extras.push({ label: vertical?.categoryLabel || 'Category', value: r.category, icon: 'category' });
  if (r.memberName) extras.push({ label: vertical?.memberSingular || 'Member', value: r.memberName, icon: 'person' });
  const hasOther = other.length > 0 || extras.length > 0;
  const totalAnswered = fields.length + attachments.length + other.length + extras.length;

  return (
    <div className="page od-page fsd-page" data-testid="form-submission-details">
      <header className="page-head od-head fsd-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back to the list" data-testid="fsd-back">
          <span className="material-icons">arrow_back</span>
        </button>
        <div className="fsd-head-icon" aria-hidden="true">
          <span className="material-icons">{preset?.icon || 'assignment'}</span>
        </div>
        <div className="od-head-ttl fsd-head-ttl">
          <div className="fsd-head-title-row">
            <h2>{title}</h2>
            {shortRef && <span className="od-kind">{shortRef}</span>}
          </div>
          <span className="fsd-head-sub">
            From <strong>{who}</strong>
            {r.createdAt && <> · {fmtWhen(r.createdAt)}</>}
          </span>
        </div>
        <div className="od-head-status fsd-head-actions">
          {onOpenChat && r.phone && (
            <button
              type="button"
              className="fsd-wa-btn"
              onClick={() => onOpenChat(r.phone || '')}
              data-testid="fsd-open-chat"
              title="Open WhatsApp chat"
            >
              <WhatsAppIcon size={16} />
              <span>WhatsApp chat</span>
            </button>
          )}
          <span className="od-head-status-lbl">Status</span>
          <div className="ord-status-sel">
            <Dropdown
              options={REG_STATUS}
              value={r.status}
              onChange={(v) => onStatusChange(r, v as RegistrationStatus)}
            />
          </div>
          <button
            className="prod-act danger fsd-delete"
            onClick={() => onDelete(r)}
            title="Delete submission"
            aria-label="Delete submission"
            data-testid="fsd-delete"
          >
            <span className="material-icons">delete_outline</span>
          </button>
        </div>
      </header>

      <div className="page-body od-body">
        {/* Top summary strip — matches OrderDetailsPage so key facts read at a glance. */}
        <div className="od-strip fsd-strip">
          <div className="od-stat">
            <span className="od-stat-lbl">{vertical?.customerLabel || 'Customer'}</span>
            <span className="od-stat-val sm">
              {r.name || `+${r.phone}` || 'Unknown'}
              {r.name && r.phone && <span className="od-stat-sub">+{r.phone}</span>}
            </span>
          </div>
          <div className="od-stat">
            <span className="od-stat-lbl">Status</span>
            <span className={`fsd-status reg-${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
          </div>
          <div className="od-stat">
            <span className="od-stat-lbl">Form &amp; Flow</span>
            <span className="od-stat-val sm">
              {preset?.title || 'Custom form'}
              {r.flowName && <span className="od-stat-sub">via {r.flowName}</span>}
            </span>
          </div>
          <div className="od-stat">
            <span className="od-stat-lbl">Submitted</span>
            <span className="od-stat-val sm">
              {fmtWhen(r.createdAt) || '—'}
              <span className="od-stat-sub">
                {totalAnswered} {totalAnswered === 1 ? 'response' : 'responses'}
              </span>
            </span>
          </div>
        </div>

        <div className="od-cols">
          {/* ---------- left: structured form responses + attachments ---------- */}
          <div className="od-main">
            <section className="od-card" data-testid="fsd-answers">
              <div className="od-card-head">
                <span className="material-icons">{preset?.icon || 'assignment'}</span>
                <span>{preset ? `${preset.title} details` : 'Submitted answers'}</span>
                {fields.length > 0 && <span className="fsd-card-count">{fields.length}</span>}
              </div>
              {fields.length === 0 && attachments.length === 0 ? (
                <div className="od-empty">No answers recorded for this submission.</div>
              ) : fields.length === 0 ? (
                <div className="od-empty">See the attached files below.</div>
              ) : (
                <div className="fsd-grid">
                  {fields.map((row) => (
                    <div
                      className={`fsd-tile${isWideField(row) ? ' wide' : ''}${row.type ? ` t-${row.type}` : ''}`}
                      key={row.key}
                    >
                      <div className="fsd-tile-lbl">
                        <span className="material-icons" aria-hidden="true">{fieldIcon(row)}</span>
                        <span>{row.label}</span>
                      </div>
                      <div className="fsd-tile-val">
                        <FormAnswer row={row} onView={setViewing} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {attachments.length > 0 && (
              <section className="od-card" data-testid="fsd-attachments">
                <div className="od-card-head">
                  <span className="material-icons">attach_file</span>
                  <span>Uploaded documents &amp; photos</span>
                  <span className="fsd-card-count">
                    {attachments.reduce((n, a) => n + (a.files?.length || 1), 0)}
                  </span>
                </div>
                <div className="fsd-att-list">
                  {attachments.map((row) => {
                    const files = row.files || [];
                    return (
                      <div className="fsd-att-group" key={row.key}>
                        <div className="fsd-att-label">{row.label}</div>
                        <div className="fsd-att-cards">
                          {files.map((f, i) => {
                            const pdf = isPdf(f);
                            const img = !pdf && (row.type === 'photo' || /^image\//i.test(f.mime));
                            const ext = pdf ? 'PDF' : (f.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase();
                            return (
                              <div className="fsd-att-card" key={`${f.url || f.name}-${i}`}>
                                <div
                                  className={`fsd-att-preview${img ? ' is-img' : ''}`}
                                  onClick={() => {
                                    if (!f.url) return;
                                    if (img || pdf) setViewing({ url: f.url, pdf, name: f.name });
                                    else window.open(safeUrl(f.url), '_blank', 'noopener');
                                  }}
                                >
                                  {img && f.url ? (
                                    <img src={f.url} alt={f.name} loading="lazy" />
                                  ) : (
                                    <div className="fsd-att-doc-badge">
                                      <span className="material-icons">{pdf ? 'picture_as_pdf' : 'description'}</span>
                                      <span>{ext}</span>
                                    </div>
                                  )}
                                </div>
                                <div className="fsd-att-meta">
                                  <div className="fsd-att-name" title={f.name}>{f.name || 'Attachment'}</div>
                                  <div className="fsd-att-actions">
                                    {f.url ? (
                                      <>
                                        <button
                                          type="button"
                                          className="k-btn ghost sm"
                                          onClick={() => {
                                            if (img || pdf) setViewing({ url: f.url, pdf, name: f.name });
                                            else window.open(safeUrl(f.url), '_blank', 'noopener');
                                          }}
                                        >
                                          <span className="material-icons">visibility</span>
                                          Preview
                                        </button>
                                        <a
                                          className="k-btn ghost sm"
                                          href={safeUrl(f.url)}
                                          download={f.name || true}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          <DownloadIcon size={15} />
                                          Download
                                        </a>
                                      </>
                                    ) : (
                                      <span className="od-muted">File unavailable</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {hasOther && (
              <section className="od-card" data-testid="fsd-other">
                <div className="od-card-head">
                  <span className="material-icons">tune</span>
                  <span>Flow selections &amp; other answers</span>
                </div>
                <div className="fsd-grid">
                  {extras.map((x) => (
                    <div className="fsd-tile" key={`x-${x.label}`}>
                      <div className="fsd-tile-lbl">
                        <span className="material-icons" aria-hidden="true">{x.icon}</span>
                        <span>{x.label}</span>
                      </div>
                      <div className="fsd-tile-val">{x.value}</div>
                    </div>
                  ))}
                  {other.map((row) => (
                    <div
                      className={`fsd-tile${isWideField(row) ? ' wide' : ''}${row.type ? ` t-${row.type}` : ''}`}
                      key={row.key}
                    >
                      <div className="fsd-tile-lbl">
                        <span className="material-icons" aria-hidden="true">{fieldIcon(row)}</span>
                        <span>{row.label}</span>
                      </div>
                      <div className="fsd-tile-val">
                        <FormAnswer row={row} onView={setViewing} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* ---------- right: customer profile & submission metadata ---------- */}
          <div className="od-side">
            <section className="od-card">
              <div className="od-card-head">
                <span className="material-icons">person</span>
                <span>{vertical?.customerLabel || 'Customer'}</span>
              </div>
              <div className="od-cust fsd-cust">
                <div className="od-avatar fsd-avatar" aria-hidden="true">
                  {(r.name || r.phone || '?').slice(0, 2).toUpperCase()}
                </div>
                <div className="od-cust-id">
                  <div className="od-cust-name">
                    {r.name || <span className="od-muted">Name not captured</span>}
                  </div>
                  {r.phone && <div className="od-cust-phone">+{r.phone}</div>}
                  {r.email && (
                    <a className="od-cust-phone fsd-email" href={`mailto:${r.email}`}>{r.email}</a>
                  )}
                </div>
              </div>
              {onOpenChat && r.phone && (
                <button
                  type="button"
                  className="fsd-wa-full-btn"
                  onClick={() => onOpenChat(r.phone || '')}
                >
                  <WhatsAppIcon size={18} />
                  <span>Reply on WhatsApp</span>
                </button>
              )}
              <dl className="od-facts fsd-facts">
                <dt>Form</dt>
                <dd>{preset?.title || 'Custom form'}</dd>
                {!!r.flowName && (
                  <>
                    <dt>WhatsApp flow</dt>
                    <dd>{r.flowName}</dd>
                  </>
                )}
                {!!r.phone && (
                  <>
                    <dt>WhatsApp</dt>
                    <dd>+{r.phone}</dd>
                  </>
                )}
                <dt>Received</dt>
                <dd>{fmtWhen(r.createdAt) || '—'}</dd>
                <dt>Status</dt>
                <dd>
                  <span className={`fsd-status reg-${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
                </dd>
              </dl>
            </section>
          </div>
        </div>
      </div>
      {viewing && <Lightbox media={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
