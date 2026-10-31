// A WhatsApp number's Cloud API status as Meta reports it (CONNECTED,
// PENDING, FLAGGED, RESTRICTED, DISCONNECTED, …), for the status badges on
// Channel Status, the top-bar widget and the admin Businesses list.

export type StatusTone = 'green' | 'amber' | 'red' | 'grey';

/** Colour of a phone number `status`. */
export function numberStatusTone(s?: string | null): StatusTone {
  const v = String(s || '').toUpperCase();
  if (!v) return 'grey';
  if (v === 'CONNECTED') return 'green';
  if (['RESTRICTED', 'BANNED', 'BLOCKED', 'DISCONNECTED', 'DELETED'].includes(v)) return 'red';
  return 'amber';
}

/** "RATE_LIMITED" → "Rate limited"; '' → ''. */
export function numberStatusLabel(s?: string | null): string {
  const v = String(s || '').toUpperCase();
  if (!v) return '';
  const w = v.toLowerCase().replace(/_/g, ' ');
  return w[0].toUpperCase() + w.slice(1);
}

/** Fired on `window` whenever a page has read the live status, so the top bar follows. */
export const CHANNEL_STATUS_EVENT = 'crm_channel_status';
/** Fired after Embedded Signup leaves the number Pending (detail: SignupActivation). */
export const NUMBER_ACTIVATION_EVENT = 'crm_number_activation';
/** sessionStorage key holding Embedded Signup's register failure until Channel Status shows it. */
export const SIGNUP_ACTIVATION_KEY = 'crm_signup_activation';
