// Business settings shared by the admin panel and the business's own Settings
// page: the native-payment block (WhatsApp Pay) and its validation.

/**
 * Normalise the native-payment block.
 *
 * The seller address is only used when the tenant has no Meta catalog, but
 * it's stored unconditionally so switching a catalog off later doesn't
 * silently break payments.
 */
export const pickPayment = (p = {}) => {
  const s = (v, d = '') => String(v ?? d).trim();
  return {
    enabled: !!p.enabled,
    configName: s(p.configName),
    gatewayType: ['razorpay', 'payu', 'upi_vpa'].includes(p.gatewayType) ? p.gatewayType : 'razorpay',
    merchantName: s(p.merchantName),
    addressLine1: s(p.addressLine1),
    addressLine2: s(p.addressLine2),
    city: s(p.city),
    zoneCode: s(p.zoneCode).toUpperCase(),
    postalCode: s(p.postalCode),
    countryCode: s(p.countryCode, 'IN').toUpperCase() || 'IN',
    countryOfOrigin: s(p.countryOfOrigin, 'India') || 'India',
  };
};

/** Why a payment block can't be saved, or '' when it can. */
export function paymentProblem(payment) {
  // A gateway with no configuration name can't be used: order_details has to
  // quote it. Saying so here beats a payment card that never arrives.
  if (payment.enabled && !payment.configName) {
    return 'A payment configuration name is required to enable payments. Copy it from WhatsApp Manager → Payments.';
  }
  return '';
}

export default { pickPayment, paymentProblem };
