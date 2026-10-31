import { phoneToIso } from '../countryFlag';
import { FlagSvg } from '../../site/PhoneField';

interface CountryFlagProps {
  phone?: string;
  iso?: string;
  size?: number;
  className?: string;
  title?: string;
}

const SUPPORTED_SVGS = new Set([
  'IN', 'US', 'GB', 'AE', 'AU', 'CA', 'SG', 'SA', 'BD', 'LK',
  'MY', 'ID', 'KW', 'NP', 'QA', 'OM', 'DE', 'FR'
]);

/**
 * Circular country flag icon matching Image 2 & the registration page SVG flags.
 * Falls back to flagcdn.com for unlisted ISO codes.
 */
export function CountryFlag({
  phone,
  iso: explicitIso,
  size = 18,
  className = '',
  title,
}: CountryFlagProps) {
  const rawIso = explicitIso || (phone ? phoneToIso(phone) : '');
  const iso = (rawIso || '').toUpperCase();
  if (!iso) return null;

  const hasSvg = SUPPORTED_SVGS.has(iso);

  return (
    <span
      className={`crm-round-flag ${className}`.trim()}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
      }}
      title={title || iso}
      aria-label={`Flag of ${iso}`}
    >
      {hasSvg ? (
        <FlagSvg iso={iso} preserveAspectRatio="xMidYMid slice" />
      ) : (
        <img
          src={`https://flagcdn.com/w80/${iso.toLowerCase()}.png`}
          alt={iso}
          className="crm-round-flag-img"
          onError={(e) => {
            (e.currentTarget as HTMLElement).style.display = 'none';
          }}
        />
      )}
    </span>
  );
}
