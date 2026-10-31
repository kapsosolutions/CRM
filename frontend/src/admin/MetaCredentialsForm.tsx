// The Meta WhatsApp credential fields, shared by "Add business" and "Free tier".
// Both flows collect the same details and run the same Graph verification, so
// the inputs and the verified-details panel live here rather than being copied.
import { VERTICAL_OPTIONS, verticalConfig } from '../crm/verticals';
import type { VerifyResult, BusinessLabels } from './platformApi';

export interface MetaCreds {
  name: string;
  category: string;
  phoneNumberId: string;
  wabaId: string;
  appId: string;
  appSecret: string;
  accessToken: string;
  catalogId: string;
  graphVersion: string;
}

export const BLANK_CREDS: MetaCreds = {
  name: '',
  category: 'other',
  phoneNumberId: '',
  wabaId: '',
  appId: '',
  appSecret: '',
  accessToken: '',
  catalogId: '',
  graphVersion: 'v22.0',
};

/** The minimum needed before "Check credentials" can run (mirrors the server). */
export const canCheckCreds = (f: Pick<MetaCreds, 'name' | 'phoneNumberId' | 'accessToken'>) =>
  !!(f.name && f.phoneNumberId && f.accessToken);

export function MetaCredentialFields({
  form,
  onChange,
}: {
  form: MetaCreds;
  onChange: (patch: Partial<MetaCreds>) => void;
}) {
  const chosen = verticalConfig(form.category);
  return (
    <div className="pa-form-grid">
      <label className="pa-field">
        <span>Business name</span>
        <input value={form.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Acme Foods" />
      </label>
      <label className="pa-field">
        <span>Business category</span>
        <select value={form.category} onChange={(e) => onChange({ category: e.target.value })}>
          {VERTICAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <small className="pa-hint">{chosen.archetypeLabel} · pages: {chosen.pages.join(', ')}</small>
      </label>
      <label className="pa-field">
        <span>Phone number ID</span>
        <input value={form.phoneNumberId} onChange={(e) => onChange({ phoneNumberId: e.target.value })} />
      </label>
      <label className="pa-field">
        <span>WABA ID</span>
        <input value={form.wabaId} onChange={(e) => onChange({ wabaId: e.target.value })} />
      </label>
      <label className="pa-field">
        <span>App ID</span>
        <input value={form.appId} onChange={(e) => onChange({ appId: e.target.value })} />
      </label>
      <label className="pa-field">
        <span>App secret (optional)</span>
        <input value={form.appSecret} onChange={(e) => onChange({ appSecret: e.target.value })} />
      </label>
      <label className="pa-field">
        <span>Catalog ID (optional)</span>
        <input value={form.catalogId} onChange={(e) => onChange({ catalogId: e.target.value })} />
      </label>
      <label className="pa-field wide">
        <span>Access token</span>
        <input value={form.accessToken} onChange={(e) => onChange({ accessToken: e.target.value })} placeholder="EAAG…" />
      </label>
    </div>
  );
}

// Plain-English labels, in the order they should read. Meta's own field names
// are jargon ("codeVerificationStatus") and invited the reading that something
// had expired on the account, so nothing raw is shown any more.
const DETAIL_LABELS: Array<[string, string]> = [
  ['verifiedName', 'Display name'],
  ['displayPhoneNumber', 'Phone number'],
  ['connectionStatus', 'Number status'],
  ['qualityRating', 'Quality rating'],
  ['nameStatus', 'Display name review'],
  ['messagingLimit', 'Messaging limit'],
  ['platformType', 'Hosted on'],
  ['codeVerificationStatus', 'Ownership code'],
  ['wabaName', 'WhatsApp account'],
  ['timezone', 'Timezone'],
  ['currency', 'Currency'],
  ['catalogName', 'Catalog'],
  ['productCount', 'Products'],
];

/** What Meta told us about the number / WABA / catalog after a successful check. */
export function VerifyPanel({ verify }: { verify: VerifyResult | null }) {
  if (!verify?.ok) return null;
  const details = verify.details || {};
  const has = (v: unknown) => v !== '' && v !== null && v !== undefined;

  // Labelled fields first, then anything the server adds later that isn't mapped
  // yet, so a new detail still shows up instead of silently disappearing.
  const known = DETAIL_LABELS.filter(([k]) => has(details[k]));
  const extra = Object.keys(details)
    .filter((k) => has(details[k]) && !DETAIL_LABELS.some(([lk]) => lk === k))
    .map((k) => [k, k] as [string, string]);

  const connected = String(details.connectionStatus || '').toUpperCase();
  const codeStatus = String(details.codeVerificationStatus || '').toUpperCase();
  // Only meaningful while the number isn't live yet: once it's CONNECTED the
  // ownership code has already done its job and a lapsed one changes nothing.
  const codeNote = codeStatus && codeStatus !== 'VERIFIED' && connected !== 'CONNECTED';

  return (
    <div className="pa-verify-ok">
      <div className="pa-verify-title">✓ Verified with Meta</div>
      <div className="pa-verify-grid">
        {[...known, ...extra].map(([k, label]) => (
          <div key={k} className="pa-verify-row">
            <span>{label}</span>
            <strong>{String(details[k] ?? '')}</strong>
          </div>
        ))}
      </div>
      {codeNote ? (
        <div className="pa-verify-warn">
          Ownership code is {codeStatus} and this number isn’t connected to Cloud API yet. Re-run
          number verification in Meta Business Manager, then check again. Credentials themselves are
          fine — this doesn’t block saving the business.
        </div>
      ) : null}
      {verify.errors?.length ? <div className="pa-verify-warn">{verify.errors.join('; ')}</div> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Native payment settings, shared by "Add business" and the business detail
// page so the two can't drift apart.
// -----------------------------------------------------------------------------

export interface PaymentForm {
  enabled: boolean;
  configName: string;
  gatewayType: 'razorpay' | 'payu' | 'upi_vpa';
  merchantName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  zoneCode: string;
  postalCode: string;
  countryCode: string;
  countryOfOrigin: string;
}

export const BLANK_PAYMENT: PaymentForm = {
  enabled: false,
  configName: '',
  gatewayType: 'razorpay',
  merchantName: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  zoneCode: '',
  postalCode: '',
  countryCode: 'IN',
  countryOfOrigin: 'India',
};

/**
 * Can this tenant's payment settings actually produce a payable order?
 *
 * Only the configuration name is genuinely required — it's what the
 * order_details message has to quote. The seller address is a customs
 * disclosure for physical goods sold without a catalog; a service fee (a
 * consultation, a booking) never carries one.
 */
export function paymentReady(p: PaymentForm): string[] {
  if (!p.enabled) return [];
  return p.configName.trim() ? [] : ['payment configuration name'];
}

export function PaymentFields({
  form,
  onChange,
  hasCatalog,
  businessName = '',
}: {
  form: PaymentForm;
  onChange: (patch: Partial<PaymentForm>) => void;
  hasCatalog: boolean;
  businessName?: string;
}) {
  const missing = paymentReady(form);
  return (
    <div className="pa-pay">
      <label className="pa-check">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        Enable Meta native payment (WhatsApp Pay)
      </label>

      {form.enabled && (
        <>
          <div className="pa-form-grid">
            <label className="pa-field">
              <span>Payment configuration name</span>
              <input
                value={form.configName}
                onChange={(e) => onChange({ configName: e.target.value })}
                placeholder="from WhatsApp Manager"
              />
              <small className="pa-hint">
                Must match WhatsApp Manager → Payments exactly. The bank account behind it lives
                there, not here.
              </small>
            </label>
            <label className="pa-field">
              <span>Gateway</span>
              <select
                value={form.gatewayType}
                onChange={(e) => onChange({ gatewayType: e.target.value as PaymentForm['gatewayType'] })}
              >
                <option value="razorpay">Razorpay</option>
                <option value="payu">PayU</option>
                <option value="upi_vpa">UPI VPA</option>
              </select>
            </label>
          </div>

          {hasCatalog ? (
            <p className="pa-hint">
              This business has a Meta catalog, so each order line points at a catalog item.
            </p>
          ) : (
            <>
              <p className="pa-panel-note">
                <strong>Optional.</strong> These are a customs disclosure Meta asks for on{' '}
                <em>physical</em> goods sold without a catalog. A service fee — a consultation, a
                class, a booking — doesn’t need them, so leave them blank unless you ship products
                without a Meta catalog.
              </p>
              <div className="pa-form-grid">
                <label className="pa-field">
                  <span>Merchant name</span>
                  <input
                    value={form.merchantName}
                    onChange={(e) => onChange({ merchantName: e.target.value })}
                    placeholder={businessName || 'Registered business name'}
                  />
                  <small className="pa-hint">
                    {businessName ? `Defaults to “${businessName}”.` : 'The registered business name.'}
                  </small>
                </label>
                <label className="pa-field">
                  <span>Address line 1</span>
                  <input
                    value={form.addressLine1}
                    onChange={(e) => onChange({ addressLine1: e.target.value })}
                    placeholder="Door / street"
                  />
                </label>
                <label className="pa-field">
                  <span>Address line 2 (optional)</span>
                  <input
                    value={form.addressLine2}
                    onChange={(e) => onChange({ addressLine2: e.target.value })}
                    placeholder="Area / landmark"
                  />
                </label>
                <label className="pa-field">
                  <span>City</span>
                  <input value={form.city} onChange={(e) => onChange({ city: e.target.value })} />
                </label>
                <label className="pa-field">
                  <span>State code</span>
                  <input
                    value={form.zoneCode}
                    onChange={(e) => onChange({ zoneCode: e.target.value.toUpperCase() })}
                    placeholder="TG"
                    maxLength={3}
                  />
                  <small className="pa-hint">Two-letter state code, e.g. TG, KA, MH, DL.</small>
                </label>
                <label className="pa-field">
                  <span>Postal code</span>
                  <input
                    value={form.postalCode}
                    onChange={(e) => onChange({ postalCode: e.target.value })}
                    placeholder="500001"
                  />
                </label>
                <label className="pa-field">
                  <span>Country code</span>
                  <input
                    value={form.countryCode}
                    onChange={(e) => onChange({ countryCode: e.target.value.toUpperCase() })}
                    maxLength={2}
                  />
                </label>
                <label className="pa-field">
                  <span>Country of origin</span>
                  <input
                    value={form.countryOfOrigin}
                    onChange={(e) => onChange({ countryOfOrigin: e.target.value })}
                  />
                </label>
              </div>
            </>
          )}

          {missing.length > 0 && (
            <div className="pa-verify-warn">Still needed for payments to work: {missing.join(', ')}.</div>
          )}
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Wording overrides, shared by "Add business" and the business detail page.
//
// The category already supplies sensible defaults — a clinic's members are
// "Doctors" and its customer a "Patient". These fields let the admin override
// any of them for one business; left blank, the category default is used (and
// shown as the placeholder).
// -----------------------------------------------------------------------------
export function LabelOverridesFields({
  category,
  value,
  onChange,
}: {
  category: string;
  value: BusinessLabels;
  onChange: (patch: BusinessLabels) => void;
}) {
  const d = verticalConfig(category); // defaults for this category, as placeholders
  const field = (
    key: keyof BusinessLabels,
    label: string,
    placeholder: string,
  ) => (
    <label className="pa-field">
      <span>{label}</span>
      <input
        value={value[key] || ''}
        onChange={(e) => onChange({ [key]: e.target.value })}
        placeholder={placeholder}
      />
    </label>
  );
  return (
    <div className="pa-labels">
      <p className="pa-hint">
        Optional. Leave blank to use the <strong>{d.label}</strong> defaults shown. The customer
        term appears in templates, the {d.ordersLabel} page and chat.
      </p>
      <div className="pa-form-grid">
        {field('customerLabel', 'Customer called (one)', d.customerLabel)}
        {field('customerPlural', 'Customers called (many)', d.customerPlural)}
        {field('memberSingular', `${d.memberLabel} — one`, d.memberSingular)}
        {field('memberLabel', `${d.memberLabel} — many`, d.memberLabel)}
        {field('categoryLabel', 'Category called (one)', d.categoryLabel)}
        {field('categoryPlural', 'Categories called (many)', d.categoryPlural)}
      </div>
    </div>
  );
}
