// One answer from a submitted WhatsApp Flow form, drawn for what it is: stars
// for a rating, chips for ticked options, thumbnails for photos, file chips for
// documents. Used by the chat's form bubble and the Form submissions list.
// Rows saved before answers had types show as plain text, as before.
import { safeUrl } from '../safeUrl';
import type { FormRow } from '../types';
import './FormAnswer.css';

interface Props {
  row: FormRow;
  /** Open a photo / PDF in the CRM's viewer (otherwise it opens in a new tab). */
  onView?: (media: { url: string; pdf: boolean; name?: string }) => void;
  /** Smaller thumbnails and chips, for the submissions table. */
  compact?: boolean;
}

const isPdf = (f: { name: string; mime: string }) => f.mime === 'application/pdf' || /\.pdf$/i.test(f.name);

export function FormAnswer({ row, onView, compact = false }: Props) {
  const files = row.files || [];
  switch (row.type) {
    case 'rating': {
      const n = Math.max(0, Math.min(5, row.rating || 0));
      return (
        <span className="fa-rating" title={row.value} aria-label={`${n} out of 5`} data-testid="fa-rating">
          <span className="fa-stars">
            {'★'.repeat(n)}
            <span className="fa-stars-off">{'★'.repeat(5 - n)}</span>
          </span>
          <span className="fa-rating-n">{n}/5</span>
        </span>
      );
    }
    case 'multi':
      return (
        <span className="fa-chips" data-testid="fa-multi">
          {(row.items?.length ? row.items : row.value.split(', ')).map((it) => (
            <span className="fa-chip" key={it}>{it}</span>
          ))}
        </span>
      );
    case 'consent':
      return (
        <span className={`fa-consent${row.agreed ? ' yes' : ' no'}`} data-testid="fa-consent">
          <span className="material-icons" aria-hidden="true">{row.agreed ? 'check_circle' : 'cancel'}</span>
          {row.value}
        </span>
      );
    case 'date':
    case 'daterange':
      return (
        <span className="fa-date" data-testid={`fa-${row.type}`}>
          <span className="material-icons" aria-hidden="true">{row.type === 'daterange' ? 'date_range' : 'event'}</span>
          {row.value}
        </span>
      );
    case 'phone':
      return <a className="fa-link" href={`tel:${row.value.replace(/[^\d+]/g, '')}`}>{row.value}</a>;
    case 'email':
      return <a className="fa-link" href={`mailto:${row.value}`}>{row.value}</a>;
    case 'photo':
      return (
        <span className={`fa-photos${compact ? ' compact' : ''}`} data-testid="fa-photos">
          {files.map((f, i) =>
            f.url ? (
              <button
                type="button"
                className="fa-thumb"
                key={`${f.url}-${i}`}
                onClick={() => (onView ? onView({ url: f.url, pdf: false }) : window.open(f.url, '_blank', 'noopener'))}
                title={f.name}
                aria-label={`Open photo ${f.name}`}
              >
                <img src={f.url} alt="" loading="lazy" />
              </button>
            ) : (
              <span className="fa-thumb missing" key={`${f.name}-${i}`} title={`${f.name} (couldn’t be saved)`}>
                <span className="material-icons">broken_image</span>
              </span>
            ),
          )}
        </span>
      );
    case 'document':
      return (
        <span className="fa-docs" data-testid="fa-docs">
          {files.map((f, i) =>
            f.url ? (
              <a
                className="fa-doc"
                key={`${f.url}-${i}`}
                href={safeUrl(f.url)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (onView && isPdf(f)) {
                    e.preventDefault();
                    onView({ url: f.url, pdf: true, name: f.name });
                  }
                }}
                title={f.name}
              >
                <span className="fa-doc-ic">{isPdf(f) ? 'PDF' : (f.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()}</span>
                <span className="fa-doc-name">{f.name}</span>
              </a>
            ) : (
              <span className="fa-doc missing" key={`${f.name}-${i}`} title="This file couldn’t be saved">
                <span className="fa-doc-ic">?</span>
                <span className="fa-doc-name">{f.name}</span>
              </span>
            ),
          )}
        </span>
      );
    case 'longtext':
      return <span className="fa-long">{row.value}</span>;
    default:
      return <>{row.value}</>;
  }
}
