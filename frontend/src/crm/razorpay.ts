// Razorpay Checkout for buying a plan.
//
//   1. the server creates the order (POST /api/billing/checkout) — the amount
//      comes from the server, never from the browser;
//   2. Razorpay's own window takes the payment;
//   3. its signed result goes back to the server (POST /api/billing/confirm),
//      which checks it with Razorpay and only then activates the plan.
// If the tab closes after paying, Razorpay's webhook activates it instead.
import type { CrmApi } from './api';
import type { PlanState } from './types';

const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
  on(event: string, cb: (r: { error?: { description?: string } }) => void): void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

let loading: Promise<RazorpayCtor> | null = null;

/** Loads Razorpay's checkout script once. */
export function loadRazorpay(): Promise<RazorpayCtor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loading) return loading;
  loading = new Promise<RazorpayCtor>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay didn’t load.')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Couldn’t open the payment window. Check your connection (or ad blocker) and try again.'));
    };
    document.body.appendChild(s);
  });
  return loading;
}

export type PayResult = { status: 'paid'; plan: PlanState } | { status: 'dismissed' };

/** Opens Razorpay Checkout for a plan. Resolves once paid and activated, or dismissed. */
export async function payForPlan(api: CrmApi, tier: string, cycle: string): Promise<PayResult> {
  const { data: co } = await api.startPlanCheckout({ tier, cycle });
  const Razorpay = await loadRazorpay();
  return new Promise<PayResult>((resolve, reject) => {
    let settled = false;
    const rz = new Razorpay({
      key: co.keyId,
      order_id: co.orderId,
      amount: co.amount,
      currency: co.currency,
      name: 'Kapso Solutions',
      description: co.description,
      image: `${window.location.origin}/logo.png`,
      prefill: co.prefill,
      notes: { tier, cycle },
      theme: { color: '#16a34a' },
      modal: {
        confirm_close: true,
        ondismiss: () => {
          if (!settled) resolve({ status: 'dismissed' });
        },
      },
      handler: (resp: RazorpayResponse) => {
        settled = true;
        api
          .confirmPlanPayment({
            orderId: resp.razorpay_order_id,
            paymentId: resp.razorpay_payment_id,
            signature: resp.razorpay_signature,
          })
          .then((r) => resolve({ status: 'paid', plan: r.plan }))
          .catch(reject);
      },
    });
    // A failed attempt: Razorpay's window shows it and lets the customer retry.
    rz.on('payment.failed', () => {});
    rz.open();
  });
}
