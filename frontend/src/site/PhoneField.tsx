import { useEffect, useId, useRef, useState } from 'react';

export function FlagSvg({
  iso,
  preserveAspectRatio = 'xMidYMid slice',
}: {
  iso: string;
  preserveAspectRatio?: string;
}) {
  switch ((iso || '').toUpperCase()) {
    case 'IN':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#FF9933" d="M0 0h640v160H0z" />
          <path fill="#FFFFFF" d="M0 160h640v160H0z" />
          <path fill="#128807" d="M0 320h640v160H0z" />
          <circle cx="320" cy="240" r="45" fill="none" stroke="#000088" strokeWidth="6" />
          <circle cx="320" cy="240" r="10" fill="#000088" />
          <g stroke="#000088" strokeWidth="2.5">
            <line x1="320" y1="195" x2="320" y2="285" />
            <line x1="275" y1="240" x2="365" y2="240" />
            <line x1="288" y1="208" x2="352" y2="272" />
            <line x1="288" y1="272" x2="352" y2="208" />
          </g>
        </svg>
      );
    case 'US':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#B22234" d="M0 0h640v480H0z" />
          <path stroke="#FFFFFF" strokeWidth="37" d="M0 55h640M0 129h640M0 203h640M0 277h640M0 351h640M0 425h640" />
          <path fill="#3C3B6E" d="M0 0h260v260H0z" />
          <circle cx="130" cy="130" r="45" fill="#FFFFFF" opacity="0.9" />
        </svg>
      );
    case 'GB':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#012169" d="M0 0h640v480H0z" />
          <path fill="#FFFFFF" d="m75 0 245 180L565 0h75v60L435 240l205 180v60h-75L320 300 75 480H0v-60l205-180L0 60V0h75z" />
          <path fill="#C8102E" d="m420 280 220 160v40h-40L380 320h40zm-200-80L0 40V0h40l220 160h-40zm-180 280 200-145v45L60 480H40zm560-480L420 145v-45L580 0h20z" />
          <path fill="#FFFFFF" d="M260 0h120v480H260zM0 180h640v120H0z" />
          <path fill="#C8102E" d="M280 0h80v480H280zM0 200h640v80H0z" />
        </svg>
      );
    case 'AE':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#00732F" d="M0 0h640v160H0z" />
          <path fill="#FFFFFF" d="M0 160h640v160H0z" />
          <path fill="#000000" d="M0 320h640v160H0z" />
          <path fill="#FF0000" d="M0 0h160v480H0z" />
        </svg>
      );
    case 'AU':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#00008B" d="M0 0h640v480H0z" />
          <path fill="#FFFFFF" d="M0 0h320v240H0z" />
          <path fill="#C8102E" d="M130 0h60v240h-60zM0 90h320v60H0z" />
          <circle cx="480" cy="240" r="30" fill="#FFFFFF" />
          <circle cx="160" cy="360" r="40" fill="#FFFFFF" />
        </svg>
      );
    case 'CA':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#FF0000" d="M0 0h160v480H0zm480 0h160v480H480z" />
          <path fill="#FFFFFF" d="M160 0h320v480H160z" />
          <circle cx="320" cy="240" r="45" fill="#FF0000" />
        </svg>
      );
    case 'SG':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#ED2939" d="M0 0h640v240H0z" />
          <path fill="#FFFFFF" d="M0 240h640v240H0z" />
          <circle cx="150" cy="120" r="70" fill="#FFFFFF" />
          <circle cx="175" cy="120" r="65" fill="#ED2939" />
        </svg>
      );
    case 'SA':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#006C35" d="M0 0h640v480H0z" />
          <path fill="#FFFFFF" d="M180 290h280v15H180zM210 200h220v35H210z" />
        </svg>
      );
    case 'BD':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#006A4E" d="M0 0h640v480H0z" />
          <circle cx="280" cy="240" r="140" fill="#F42A41" />
        </svg>
      );
    case 'LK':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#FFBE29" d="M0 0h640v480H0z" />
          <path fill="#00534E" d="M30 30h90v420H30z" />
          <path fill="#EB7400" d="M120 30h90v420h-90z" />
          <path fill="#8D153A" d="M230 30h380v420H230z" />
          <circle cx="420" cy="240" r="60" fill="#FFBE29" />
        </svg>
      );
    case 'MY':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#CC0001" d="M0 0h640v480H0z" />
          <path stroke="#FFFFFF" strokeWidth="34" d="M0 50h640M0 118h640M0 186h640M0 254h640M0 322h640M0 390h640" />
          <path fill="#010066" d="M0 0h320v240H0z" />
          <circle cx="160" cy="120" r="60" fill="#FFCC00" />
          <circle cx="180" cy="120" r="50" fill="#010066" />
        </svg>
      );
    case 'ID':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#E70011" d="M0 0h640v240H0z" />
          <path fill="#FFFFFF" d="M0 240h640v240H0z" />
        </svg>
      );
    case 'KW':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#007A3D" d="M0 0h640v160H0z" />
          <path fill="#FFFFFF" d="M0 160h640v160H0z" />
          <path fill="#CE1126" d="M0 320h640v160H0z" />
          <path fill="#000000" d="M0 0l160 160v160L0 480z" />
        </svg>
      );
    case 'NP':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#DC143C" d="M120 40L360 220H200L440 440H120z" />
          <circle cx="200" cy="140" r="25" fill="#FFFFFF" />
          <circle cx="200" cy="340" r="35" fill="#FFFFFF" />
        </svg>
      );
    case 'QA':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#FFFFFF" d="M0 0h200v480H0z" />
          <path fill="#8A1538" d="M200 0h440v480H200z" />
        </svg>
      );
    case 'OM':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#FFFFFF" d="M0 0h640v160H0z" />
          <path fill="#DB161B" d="M0 160h640v160H0z" />
          <path fill="#008000" d="M0 320h640v160H0z" />
          <path fill="#DB161B" d="M0 0h160v480H0z" />
        </svg>
      );
    case 'DE':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#000000" d="M0 0h640v160H0z" />
          <path fill="#DD0000" d="M0 160h640v160H0z" />
          <path fill="#FFCE00" d="M0 320h640v160H0z" />
        </svg>
      );
    case 'FR':
      return (
        <svg viewBox="0 0 640 480" preserveAspectRatio={preserveAspectRatio} className="lp-flag-svg" aria-hidden="true">
          <path fill="#002395" d="M0 0h213v480H0z" />
          <path fill="#FFFFFF" d="M213 0h214v480H213z" />
          <path fill="#ED2939" d="M427 0h213v480H427z" />
        </svg>
      );
    default: {
      const code = (iso || '').toLowerCase();
      if (!code) return null;
      return (
        <img
          src={`https://flagcdn.com/w80/${code}.png`}
          alt={iso}
          className="lp-flag-svg"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={(e) => {
            (e.currentTarget as HTMLElement).style.display = 'none';
          }}
        />
      );
    }
  }
}

/** Dialling codes offered in the phone field. India first; all world countries A–Z. */
export const COUNTRIES: { iso: string; dial: string; name: string; len?: number }[] = [
  { iso: 'IN', dial: '91', name: 'India', len: 10 },
  { iso: 'AF', dial: '93', name: 'Afghanistan', len: 9 },
  { iso: 'AL', dial: '355', name: 'Albania', len: 9 },
  { iso: 'DZ', dial: '213', name: 'Algeria', len: 9 },
  { iso: 'AS', dial: '1', name: 'American Samoa', len: 10 },
  { iso: 'AD', dial: '376', name: 'Andorra', len: 6 },
  { iso: 'AO', dial: '244', name: 'Angola', len: 9 },
  { iso: 'AI', dial: '1', name: 'Anguilla', len: 10 },
  { iso: 'AG', dial: '1', name: 'Antigua and Barbuda', len: 10 },
  { iso: 'AR', dial: '54', name: 'Argentina', len: 10 },
  { iso: 'AM', dial: '374', name: 'Armenia', len: 8 },
  { iso: 'AW', dial: '297', name: 'Aruba', len: 7 },
  { iso: 'AU', dial: '61', name: 'Australia', len: 9 },
  { iso: 'AT', dial: '43', name: 'Austria', len: 10 },
  { iso: 'AZ', dial: '994', name: 'Azerbaijan', len: 9 },
  { iso: 'BS', dial: '1', name: 'Bahamas', len: 10 },
  { iso: 'BH', dial: '973', name: 'Bahrain', len: 8 },
  { iso: 'BD', dial: '880', name: 'Bangladesh', len: 10 },
  { iso: 'BB', dial: '1', name: 'Barbados', len: 10 },
  { iso: 'BY', dial: '375', name: 'Belarus', len: 9 },
  { iso: 'BE', dial: '32', name: 'Belgium', len: 9 },
  { iso: 'BZ', dial: '501', name: 'Belize', len: 7 },
  { iso: 'BJ', dial: '229', name: 'Benin', len: 8 },
  { iso: 'BM', dial: '1', name: 'Bermuda', len: 10 },
  { iso: 'BT', dial: '975', name: 'Bhutan', len: 8 },
  { iso: 'BO', dial: '591', name: 'Bolivia', len: 8 },
  { iso: 'BA', dial: '387', name: 'Bosnia and Herzegovina', len: 8 },
  { iso: 'BW', dial: '267', name: 'Botswana', len: 8 },
  { iso: 'BR', dial: '55', name: 'Brazil', len: 11 },
  { iso: 'IO', dial: '246', name: 'British Indian Ocean Territory', len: 7 },
  { iso: 'VG', dial: '1', name: 'British Virgin Islands', len: 10 },
  { iso: 'BN', dial: '673', name: 'Brunei', len: 7 },
  { iso: 'BG', dial: '359', name: 'Bulgaria', len: 9 },
  { iso: 'BF', dial: '226', name: 'Burkina Faso', len: 8 },
  { iso: 'BI', dial: '257', name: 'Burundi', len: 8 },
  { iso: 'KH', dial: '855', name: 'Cambodia', len: 9 },
  { iso: 'CM', dial: '237', name: 'Cameroon', len: 9 },
  { iso: 'CA', dial: '1', name: 'Canada', len: 10 },
  { iso: 'CV', dial: '238', name: 'Cape Verde', len: 7 },
  { iso: 'BQ', dial: '599', name: 'Caribbean Netherlands', len: 7 },
  { iso: 'KY', dial: '1', name: 'Cayman Islands', len: 10 },
  { iso: 'CF', dial: '236', name: 'Central African Republic', len: 8 },
  { iso: 'TD', dial: '235', name: 'Chad', len: 8 },
  { iso: 'CL', dial: '56', name: 'Chile', len: 9 },
  { iso: 'CN', dial: '86', name: 'China', len: 11 },
  { iso: 'CO', dial: '57', name: 'Colombia', len: 10 },
  { iso: 'KM', dial: '269', name: 'Comoros', len: 7 },
  { iso: 'CG', dial: '242', name: 'Congo', len: 9 },
  { iso: 'CD', dial: '243', name: 'Congo (DRC)', len: 9 },
  { iso: 'CK', dial: '682', name: 'Cook Islands', len: 5 },
  { iso: 'CR', dial: '506', name: 'Costa Rica', len: 8 },
  { iso: 'CI', dial: '225', name: "Cote d'Ivoire", len: 10 },
  { iso: 'HR', dial: '385', name: 'Croatia', len: 9 },
  { iso: 'CU', dial: '53', name: 'Cuba', len: 8 },
  { iso: 'CW', dial: '599', name: 'Curacao', len: 7 },
  { iso: 'CY', dial: '357', name: 'Cyprus', len: 8 },
  { iso: 'CZ', dial: '420', name: 'Czech Republic', len: 9 },
  { iso: 'DK', dial: '45', name: 'Denmark', len: 8 },
  { iso: 'DJ', dial: '253', name: 'Djibouti', len: 8 },
  { iso: 'DM', dial: '1', name: 'Dominica', len: 10 },
  { iso: 'DO', dial: '1', name: 'Dominican Republic', len: 10 },
  { iso: 'EC', dial: '593', name: 'Ecuador', len: 9 },
  { iso: 'EG', dial: '20', name: 'Egypt', len: 10 },
  { iso: 'SV', dial: '503', name: 'El Salvador', len: 8 },
  { iso: 'GQ', dial: '240', name: 'Equatorial Guinea', len: 9 },
  { iso: 'ER', dial: '291', name: 'Eritrea', len: 7 },
  { iso: 'EE', dial: '372', name: 'Estonia', len: 8 },
  { iso: 'SZ', dial: '268', name: 'Eswatini', len: 8 },
  { iso: 'ET', dial: '251', name: 'Ethiopia', len: 9 },
  { iso: 'FK', dial: '500', name: 'Falkland Islands', len: 5 },
  { iso: 'FO', dial: '298', name: 'Faroe Islands', len: 6 },
  { iso: 'FJ', dial: '679', name: 'Fiji', len: 7 },
  { iso: 'FI', dial: '358', name: 'Finland', len: 9 },
  { iso: 'FR', dial: '33', name: 'France', len: 9 },
  { iso: 'GF', dial: '594', name: 'French Guiana', len: 9 },
  { iso: 'PF', dial: '689', name: 'French Polynesia', len: 8 },
  { iso: 'GA', dial: '241', name: 'Gabon', len: 8 },
  { iso: 'GM', dial: '220', name: 'Gambia', len: 7 },
  { iso: 'GE', dial: '995', name: 'Georgia', len: 9 },
  { iso: 'DE', dial: '49', name: 'Germany' },
  { iso: 'GH', dial: '233', name: 'Ghana', len: 9 },
  { iso: 'GI', dial: '350', name: 'Gibraltar', len: 8 },
  { iso: 'GR', dial: '30', name: 'Greece', len: 10 },
  { iso: 'GL', dial: '299', name: 'Greenland', len: 6 },
  { iso: 'GD', dial: '1', name: 'Grenada', len: 10 },
  { iso: 'GP', dial: '590', name: 'Guadeloupe', len: 9 },
  { iso: 'GU', dial: '1', name: 'Guam', len: 10 },
  { iso: 'GT', dial: '502', name: 'Guatemala', len: 8 },
  { iso: 'GG', dial: '44', name: 'Guernsey', len: 10 },
  { iso: 'GN', dial: '224', name: 'Guinea', len: 9 },
  { iso: 'GW', dial: '245', name: 'Guinea-Bissau', len: 7 },
  { iso: 'GY', dial: '592', name: 'Guyana', len: 7 },
  { iso: 'HT', dial: '509', name: 'Haiti', len: 8 },
  { iso: 'HN', dial: '504', name: 'Honduras', len: 8 },
  { iso: 'HK', dial: '852', name: 'Hong Kong', len: 8 },
  { iso: 'HU', dial: '36', name: 'Hungary', len: 9 },
  { iso: 'IS', dial: '354', name: 'Iceland', len: 7 },
  { iso: 'ID', dial: '62', name: 'Indonesia' },
  { iso: 'IR', dial: '98', name: 'Iran', len: 10 },
  { iso: 'IQ', dial: '964', name: 'Iraq', len: 10 },
  { iso: 'IE', dial: '353', name: 'Ireland', len: 9 },
  { iso: 'IM', dial: '44', name: 'Isle of Man', len: 10 },
  { iso: 'IL', dial: '972', name: 'Israel', len: 9 },
  { iso: 'IT', dial: '39', name: 'Italy', len: 10 },
  { iso: 'CI', dial: '225', name: 'Ivory Coast', len: 10 },
  { iso: 'JM', dial: '1', name: 'Jamaica', len: 10 },
  { iso: 'JP', dial: '81', name: 'Japan', len: 10 },
  { iso: 'JE', dial: '44', name: 'Jersey', len: 10 },
  { iso: 'JO', dial: '962', name: 'Jordan', len: 9 },
  { iso: 'KZ', dial: '7', name: 'Kazakhstan', len: 10 },
  { iso: 'KE', dial: '254', name: 'Kenya', len: 9 },
  { iso: 'KI', dial: '686', name: 'Kiribati', len: 8 },
  { iso: 'XK', dial: '383', name: 'Kosovo', len: 8 },
  { iso: 'KW', dial: '965', name: 'Kuwait', len: 8 },
  { iso: 'KG', dial: '996', name: 'Kyrgyzstan', len: 9 },
  { iso: 'LA', dial: '856', name: 'Laos', len: 9 },
  { iso: 'LV', dial: '371', name: 'Latvia', len: 8 },
  { iso: 'LB', dial: '961', name: 'Lebanon', len: 8 },
  { iso: 'LS', dial: '266', name: 'Lesotho', len: 8 },
  { iso: 'LR', dial: '231', name: 'Liberia', len: 8 },
  { iso: 'LY', dial: '218', name: 'Libya', len: 9 },
  { iso: 'LI', dial: '423', name: 'Liechtenstein', len: 7 },
  { iso: 'LT', dial: '370', name: 'Lithuania', len: 8 },
  { iso: 'LU', dial: '352', name: 'Luxembourg', len: 9 },
  { iso: 'MO', dial: '853', name: 'Macau', len: 8 },
  { iso: 'MG', dial: '261', name: 'Madagascar', len: 9 },
  { iso: 'MW', dial: '265', name: 'Malawi', len: 9 },
  { iso: 'MY', dial: '60', name: 'Malaysia' },
  { iso: 'MV', dial: '960', name: 'Maldives', len: 7 },
  { iso: 'ML', dial: '223', name: 'Mali', len: 8 },
  { iso: 'MT', dial: '356', name: 'Malta', len: 8 },
  { iso: 'MH', dial: '692', name: 'Marshall Islands', len: 7 },
  { iso: 'MQ', dial: '596', name: 'Martinique', len: 9 },
  { iso: 'MR', dial: '222', name: 'Mauritania', len: 8 },
  { iso: 'MU', dial: '230', name: 'Mauritius', len: 8 },
  { iso: 'YT', dial: '262', name: 'Mayotte', len: 9 },
  { iso: 'MX', dial: '52', name: 'Mexico', len: 10 },
  { iso: 'FM', dial: '691', name: 'Micronesia', len: 7 },
  { iso: 'MD', dial: '373', name: 'Moldova', len: 8 },
  { iso: 'MC', dial: '377', name: 'Monaco', len: 8 },
  { iso: 'MN', dial: '976', name: 'Mongolia', len: 8 },
  { iso: 'ME', dial: '382', name: 'Montenegro', len: 8 },
  { iso: 'MS', dial: '1', name: 'Montserrat', len: 10 },
  { iso: 'MA', dial: '212', name: 'Morocco', len: 9 },
  { iso: 'MZ', dial: '258', name: 'Mozambique', len: 9 },
  { iso: 'MM', dial: '95', name: 'Myanmar', len: 9 },
  { iso: 'NA', dial: '264', name: 'Namibia', len: 9 },
  { iso: 'NR', dial: '674', name: 'Nauru', len: 7 },
  { iso: 'NP', dial: '977', name: 'Nepal', len: 10 },
  { iso: 'NL', dial: '31', name: 'Netherlands', len: 9 },
  { iso: 'NC', dial: '687', name: 'New Caledonia', len: 6 },
  { iso: 'NZ', dial: '64', name: 'New Zealand', len: 9 },
  { iso: 'NI', dial: '505', name: 'Nicaragua', len: 8 },
  { iso: 'NE', dial: '227', name: 'Niger', len: 8 },
  { iso: 'NG', dial: '234', name: 'Nigeria', len: 10 },
  { iso: 'NU', dial: '683', name: 'Niue', len: 4 },
  { iso: 'NF', dial: '672', name: 'Norfolk Island', len: 6 },
  { iso: 'KP', dial: '850', name: 'North Korea', len: 10 },
  { iso: 'MK', dial: '389', name: 'North Macedonia', len: 8 },
  { iso: 'MP', dial: '1', name: 'Northern Mariana Islands', len: 10 },
  { iso: 'NO', dial: '47', name: 'Norway', len: 8 },
  { iso: 'OM', dial: '968', name: 'Oman', len: 8 },
  { iso: 'PK', dial: '92', name: 'Pakistan', len: 10 },
  { iso: 'PW', dial: '680', name: 'Palau', len: 7 },
  { iso: 'PS', dial: '970', name: 'Palestine', len: 9 },
  { iso: 'PA', dial: '507', name: 'Panama', len: 8 },
  { iso: 'PG', dial: '675', name: 'Papua New Guinea', len: 8 },
  { iso: 'PY', dial: '595', name: 'Paraguay', len: 9 },
  { iso: 'PE', dial: '51', name: 'Peru', len: 9 },
  { iso: 'PH', dial: '63', name: 'Philippines', len: 10 },
  { iso: 'PL', dial: '48', name: 'Poland', len: 9 },
  { iso: 'PT', dial: '351', name: 'Portugal', len: 9 },
  { iso: 'PR', dial: '1', name: 'Puerto Rico', len: 10 },
  { iso: 'QA', dial: '974', name: 'Qatar', len: 8 },
  { iso: 'RE', dial: '262', name: 'Reunion', len: 9 },
  { iso: 'RO', dial: '40', name: 'Romania', len: 10 },
  { iso: 'RU', dial: '7', name: 'Russia', len: 10 },
  { iso: 'RW', dial: '250', name: 'Rwanda', len: 9 },
  { iso: 'BL', dial: '590', name: 'Saint Barthelemy', len: 9 },
  { iso: 'SH', dial: '290', name: 'Saint Helena', len: 4 },
  { iso: 'KN', dial: '1', name: 'Saint Kitts and Nevis', len: 10 },
  { iso: 'LC', dial: '1', name: 'Saint Lucia', len: 10 },
  { iso: 'MF', dial: '590', name: 'Saint Martin', len: 9 },
  { iso: 'PM', dial: '508', name: 'Saint Pierre and Miquelon', len: 6 },
  { iso: 'VC', dial: '1', name: 'Saint Vincent and the Grenadines', len: 10 },
  { iso: 'WS', dial: '685', name: 'Samoa', len: 7 },
  { iso: 'SM', dial: '378', name: 'San Marino', len: 10 },
  { iso: 'ST', dial: '239', name: 'Sao Tome and Principe', len: 7 },
  { iso: 'SA', dial: '966', name: 'Saudi Arabia', len: 9 },
  { iso: 'SN', dial: '221', name: 'Senegal', len: 9 },
  { iso: 'RS', dial: '381', name: 'Serbia', len: 9 },
  { iso: 'SC', dial: '248', name: 'Seychelles', len: 7 },
  { iso: 'SL', dial: '232', name: 'Sierra Leone', len: 8 },
  { iso: 'SG', dial: '65', name: 'Singapore', len: 8 },
  { iso: 'SX', dial: '1', name: 'Sint Maarten', len: 10 },
  { iso: 'SK', dial: '421', name: 'Slovakia', len: 9 },
  { iso: 'SI', dial: '386', name: 'Slovenia', len: 8 },
  { iso: 'SB', dial: '677', name: 'Solomon Islands', len: 7 },
  { iso: 'SO', dial: '252', name: 'Somalia', len: 8 },
  { iso: 'ZA', dial: '27', name: 'South Africa', len: 9 },
  { iso: 'KR', dial: '82', name: 'South Korea', len: 10 },
  { iso: 'SS', dial: '211', name: 'South Sudan', len: 9 },
  { iso: 'ES', dial: '34', name: 'Spain', len: 9 },
  { iso: 'LK', dial: '94', name: 'Sri Lanka', len: 9 },
  { iso: 'SD', dial: '249', name: 'Sudan', len: 9 },
  { iso: 'SR', dial: '597', name: 'Suriname', len: 7 },
  { iso: 'SE', dial: '46', name: 'Sweden', len: 9 },
  { iso: 'CH', dial: '41', name: 'Switzerland', len: 9 },
  { iso: 'SY', dial: '963', name: 'Syria', len: 9 },
  { iso: 'TW', dial: '886', name: 'Taiwan', len: 9 },
  { iso: 'TJ', dial: '992', name: 'Tajikistan', len: 9 },
  { iso: 'TZ', dial: '255', name: 'Tanzania', len: 9 },
  { iso: 'TH', dial: '66', name: 'Thailand', len: 9 },
  { iso: 'TL', dial: '670', name: 'Timor-Leste', len: 7 },
  { iso: 'TG', dial: '228', name: 'Togo', len: 8 },
  { iso: 'TK', dial: '690', name: 'Tokelau', len: 4 },
  { iso: 'TO', dial: '676', name: 'Tonga', len: 5 },
  { iso: 'TT', dial: '1', name: 'Trinidad and Tobago', len: 10 },
  { iso: 'TN', dial: '216', name: 'Tunisia', len: 8 },
  { iso: 'TR', dial: '90', name: 'Turkey', len: 10 },
  { iso: 'TM', dial: '993', name: 'Turkmenistan', len: 8 },
  { iso: 'TC', dial: '1', name: 'Turks and Caicos Islands', len: 10 },
  { iso: 'TV', dial: '688', name: 'Tuvalu', len: 5 },
  { iso: 'UG', dial: '256', name: 'Uganda', len: 9 },
  { iso: 'UA', dial: '380', name: 'Ukraine', len: 9 },
  { iso: 'AE', dial: '971', name: 'United Arab Emirates', len: 9 },
  { iso: 'GB', dial: '44', name: 'United Kingdom', len: 10 },
  { iso: 'US', dial: '1', name: 'United States', len: 10 },
  { iso: 'UY', dial: '598', name: 'Uruguay', len: 8 },
  { iso: 'UZ', dial: '998', name: 'Uzbekistan', len: 9 },
  { iso: 'VU', dial: '678', name: 'Vanuatu', len: 7 },
  { iso: 'VA', dial: '39', name: 'Vatican City', len: 10 },
  { iso: 'VE', dial: '58', name: 'Venezuela', len: 10 },
  { iso: 'VN', dial: '84', name: 'Vietnam', len: 9 },
  { iso: 'WF', dial: '681', name: 'Wallis and Futuna', len: 6 },
  { iso: 'YE', dial: '967', name: 'Yemen', len: 9 },
  { iso: 'ZM', dial: '260', name: 'Zambia', len: 9 },
  { iso: 'ZW', dial: '263', name: 'Zimbabwe', len: 9 },
];

export const countryOf = (iso: string) => COUNTRIES.find((x) => x.iso.toUpperCase() === (iso || '').toUpperCase()) || COUNTRIES[0];

/**
 * Countries whose own numbers can begin with 0, so a leading 0 is part of the
 * number, not the trunk prefix dialled inside the country (Italy's landlines,
 * Côte d'Ivoire's 10-digit numbers).
 */
const ZERO_IS_PART: ReadonlySet<string> = new Set(['IT', 'SM', 'VA', 'CI']);
const MAIN_FOR_DIAL: Record<string, string> = { 1: 'US', 7: 'RU', 44: 'GB', 61: 'AU', 47: 'NO', 599: 'CW', 590: 'GP', 262: 'RE', 212: 'MA', 39: 'IT' };

/**
 * The trunk prefix taken off: "09876543210" (India) → "9876543210",
 * "07911123456" (UK) → "7911123456". Numbers are written that way inside a
 * country, but WhatsApp needs them without it after the country code.
 */
export function dropTrunkZero(iso: string, digits: string): string {
  const d = digits.replace(/\D/g, '');
  const c = countryOf(iso);
  if (ZERO_IS_PART.has(c.iso.toUpperCase())) return d;
  return d.replace(/^0+/, '');
}

/**
 * The number within its country, from however it was written: "+91 98765
 * 43210", "0091 98765 43210", "919876543210", "09876543210" and "98765 43210"
 * are all "9876543210" for India.
 */
export function nationalNumber(iso: string, raw: string): string {
  const c = countryOf(iso);
  let d = String(raw || '').replace(/\D/g, '');
  // "00" is the international prefix: 0091… is +91….
  if (d.startsWith(`00${c.dial}`)) d = d.slice(2);
  // Written with the country code: take it off when what's left is a whole
  // national number (an Indian mobile can itself begin with 91).
  if (d.startsWith(c.dial)) {
    const rest = d.slice(c.dial.length);
    if (c.len ? rest.replace(/^0+/, '').length === c.len : rest.length >= 6) d = rest;
  }
  return dropTrunkZero(c.iso, d);
}

/**
 * A country from a spreadsheet's "country" cell: a dial code ("91", "+91"),
 * an ISO code ("IN") or a name ("India"). null when it isn't one.
 */
export function countryFromCell(cell: string): (typeof COUNTRIES)[number] | null {
  const v = String(cell || '').trim();
  if (!v) return null;
  const dial = v.replace(/\D/g, '');
  if (dial && /^[+\d\s()-]+$/.test(v)) {
    const code = dial.replace(/^00/, '');
    // A code shared by several countries reads as its main one (+1 → US, +44 → UK).
    const main = MAIN_FOR_DIAL[code];
    return (main && COUNTRIES.find((x) => x.iso === main)) || COUNTRIES.find((x) => x.dial === code) || null;
  }
  const low = v.toLowerCase();
  return COUNTRIES.find((x) => x.iso.toLowerCase() === low || x.name.toLowerCase() === low) || null;
}

/** "+<code> <digits>" for a picked country + typed number. */
export const fullPhone = (iso: string, number: string) => `+${countryOf(iso).dial} ${number.replace(/\D/g, '')}`;

/** Why a number isn't valid for its country, or ''. */
export function phoneProblem(iso: string, number: string): string {
  const c = countryOf(iso);
  const national = number.replace(/\D/g, '');
  if (!national) return 'Enter your phone number';
  if (c.len ? national.length !== c.len : national.length < 6 || national.length > 14) {
    return c.len ? `Enter a ${c.len}-digit ${c.name} number` : 'Enter a valid phone number';
  }
  return '';
}

/** Country picker + number with official flag icons and isolated scrolling. */
export function PhoneField({
  iso, number, onChange, error, label = 'Phone number',
}: {
  iso: string;
  number: string;
  onChange: (iso: string, number: string) => void;
  error?: string;
  label?: string;
}) {
  const id = useId();
  const c = countryOf(iso);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const pickerRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
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
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  // Prevent wheel events inside dropdown list from bubbling to window / Lenis
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      const { scrollTop, scrollHeight, clientHeight } = list;
      const isDown = e.deltaY > 0;
      const isUp = e.deltaY < 0;
      if (
        (isDown && scrollTop + clientHeight >= scrollHeight) ||
        (isUp && scrollTop <= 0)
      ) {
        e.preventDefault();
      }
    };
    list.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      list.removeEventListener('wheel', onWheel);
    };
  }, [open]);

  const filtered = COUNTRIES.filter(
    (x) =>
      x.name.toLowerCase().includes(search.toLowerCase()) ||
      x.dial.includes(search) ||
      x.iso.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={`au-field${error ? ' bad' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="au-phone">
        <span className="au-cc" ref={pickerRef}>
          <button
            type="button"
            className="au-cc-btn"
            onClick={() => setOpen((prev) => !prev)}
            aria-label={`Selected country ${c.name} (+${c.dial})`}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <span className="au-cc-face" aria-hidden="true">
              <span className="au-cc-flag"><FlagSvg iso={c.iso} /></span>
              {c.iso} <span>(+{c.dial})</span>
              <span className="material-icons">expand_more</span>
            </span>
          </button>

          {open && (
            <div
              className="au-cc-dropdown"
              role="listbox"
              data-lenis-prevent
              data-lenis-prevent-wheel
              data-lenis-prevent-touch
            >
              <div className="au-cc-search-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  className="au-cc-search-input"
                  placeholder="Search country..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>

              <div
                className="au-cc-options-list"
                ref={listRef}
                data-lenis-prevent
                data-lenis-prevent-wheel
                data-lenis-prevent-touch
              >
                {filtered.map((x) => (
                  <button
                    key={x.iso}
                    type="button"
                    className={`au-cc-option ${x.iso === c.iso ? 'selected' : ''}`}
                    onClick={() => {
                      onChange(x.iso, number);
                      setOpen(false);
                      setSearch('');
                    }}
                    role="option"
                    aria-selected={x.iso === c.iso}
                  >
                    <span className="au-cc-flag"><FlagSvg iso={x.iso} /></span>
                    <span className="au-cc-option-name">{x.name}</span>
                    <span className="au-cc-option-dial">+{x.dial}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </span>

        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="Phone number"
          value={number}
          onChange={(e) => onChange(c.iso, e.target.value.replace(/[^\d\s-]/g, ''))}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
        />
      </div>
      {error && <small id={`${id}-err`} className="au-err">{error}</small>}
    </div>
  );
}

