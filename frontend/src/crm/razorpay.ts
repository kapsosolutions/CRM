// Buying a plan with Razorpay: a Payment Link.
//
//   1. the server creates the link (POST /api/billing/link): the amount comes
//      from the server, never from the browser;
//   2. the browser goes to Razorpay's own page (rzp.io) and the business pays
//      there (UPI, cards, net banking, wallets). Razorpay's hosted page needs
//      no website registered with Razorpay;
//   3. Razorpay sends the browser back to the server (/api/razorpay/return,
//      signed), which asks Razorpay that the link is paid, activates the
//      plan, and opens Settings → Billing with ?payment=paid|pending|failed
//      (CrmShell shows the result).
// A tab closed after paying: the server checks the link with Razorpay when
// Billing is opened and every few minutes, so no webhook is needed.
import type { CrmApi } from './api';

export type PayResult = { status: 'redirect'; url: string };

/** Starts paying for a plan: the browser leaves for Razorpay's page. */
export async function payForPlan(api: CrmApi, tier: string, cycle: string): Promise<PayResult> {
  const { data } = await api.startPlanPaymentLink({ tier, cycle });
  if (!/^https:\/\//.test(String(data?.url || ''))) throw new Error('Couldn’t open the payment page. Please try again.');
  window.location.assign(data.url);
  return { status: 'redirect', url: data.url };
}

/** What Razorpay's return (?payment=…) means, for the toast. */
export function paymentReturnMessage(result: string, reason = ''): { kind: 'success' | 'error'; title: string; text: string } | null {
  if (result === 'paid') return { kind: 'success', title: 'Payment received', text: 'Your plan is active. Thank you!' };
  if (result === 'pending') {
    return { kind: 'success', title: 'Payment is being confirmed', text: 'Razorpay is confirming it. Your plan changes here in a minute or two.' };
  }
  if (result === 'failed') {
    return {
      kind: 'error',
      title: 'Payment not completed',
      text: reason === 'BAD_SIGNATURE' || reason === 'NOT_FOUND'
        ? 'We couldn’t verify that payment. If money was taken, contact support with your Razorpay payment ID.'
        : 'Your plan didn’t change. If money was taken, contact support with your Razorpay payment ID; otherwise please try again.',
    };
  }
  return null;
}
