// Ads Manager S5: the Sales goal's pixel + conversion picker (used by the
// "Create campaign" wizard's Goal step) and the pixel helpers the Automation
// tab shares. It imports no other Ads component, so the wizard can use it
// without an import cycle.
//
// The pixel list comes with the wizard's options; custom conversions and each
// pixel's state come from GET /meta/automation/pixels. The server checks the
// pixel, the event and the custom conversion again when the campaign is made.
import { useEffect, useState, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type { AdsCampaignSpec, AdsCustomConversion, AdsPixel } from '../types';

type SetSpec = (fn: (s: AdsCampaignSpec) => AdsCampaignSpec) => void;

/** The wizard's field markup (same classes as its Field). */
function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="ads-wz-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** "2 hours ago", "3 days ago", or a date. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(String(iso).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} days ago`;
  return new Date(t).toLocaleDateString();
}

export const PIXEL_STATE: Record<AdsPixel['state'], { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'green' },
  recent: { label: 'Fired this week', tone: 'amber' },
  inactive: { label: 'No recent events', tone: 'amber' },
  never: { label: 'Never fired', tone: 'red' },
  unavailable: { label: 'Unavailable', tone: 'red' },
};

/** The Goal step's Sales fields: pixel, then a standard event or one of its custom conversions. */
export function SalesConversion({ api, spec, setSpec, pixels, events }: {
  api: CrmApi;
  spec: AdsCampaignSpec;
  setSpec: SetSpec;
  pixels: { id: string; name: string; lastFiredTime: string | null; unavailable: boolean }[];
  events: [string, string][];
}) {
  const [conversions, setConversions] = useState<AdsCustomConversion[] | null>(null);
  const [states, setStates] = useState<Record<string, AdsPixel>>({});
  useEffect(() => {
    if (!pixels.length) return undefined;
    let live = true;
    api
      .getAdsPixels()
      .then((r) => {
        if (!live) return;
        setConversions(r.customConversions.filter((c) => !c.archived && !c.unavailable));
        setStates(Object.fromEntries(r.pixels.map((p) => [p.id, p])));
      })
      .catch(() => live && setConversions([]));
    return () => {
      live = false;
    };
  }, [api, pixels.length]);
  const pixel = pixels.find((p) => p.id === spec.pixelId);
  const st = pixel ? states[pixel.id] : undefined;
  const mine = (conversions || []).filter((c) => !c.pixelId || c.pixelId === spec.pixelId);
  const ccId = spec.customConversionId || '';
  return (
    <>
      <div className="ads-wz-row">
        <Field label="Pixel" hint={pixels.length ? 'The Meta pixel on your website that reports purchases.' : undefined}>
          <select
            value={spec.pixelId}
            onChange={(e) => {
              const id = e.target.value;
              setSpec((s) => {
                const keep = (conversions || []).some((c) => c.id === s.customConversionId && (!c.pixelId || c.pixelId === id));
                return { ...s, pixelId: id, customConversionId: keep ? s.customConversionId : '' };
              });
            }}
            data-testid="ads-wz-pixel"
          >
            <option value="">Choose a pixel…</option>
            {pixels.map((p) => (
              <option key={p.id} value={p.id} disabled={p.unavailable}>
                {p.name}
                {p.unavailable ? ' (unavailable)' : p.lastFiredTime ? '' : ' (no events yet)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Conversion" hint={ccId ? 'Meta optimises for this custom conversion of the pixel.' : 'The standard event your website sends.'}>
          <select
            value={ccId ? `cc:${ccId}` : spec.conversionEvent}
            onChange={(e) => {
              const v = e.target.value;
              setSpec((s) => (v.startsWith('cc:') ? { ...s, customConversionId: v.slice(3) } : { ...s, conversionEvent: v, customConversionId: '' }));
            }}
            data-testid="ads-wz-event"
          >
            <optgroup label="Standard events">
              {events.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </optgroup>
            {mine.length > 0 && (
              <optgroup label="Custom conversions" data-testid="ads-wz-conversions">
                {mine.map((c) => (
                  <option key={c.id} value={`cc:${c.id}`}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
      </div>
      {pixel && (
        <p className="ads-wz-hint" data-testid="ads-wz-pixel-status">
          {st ? <span className={`ads-pill ${PIXEL_STATE[st.state].tone}`}>{PIXEL_STATE[st.state].label}</span> : null}{' '}
          {pixel.lastFiredTime
            ? `Last event ${ago(pixel.lastFiredTime)}.`
            : 'This pixel hasn’t sent any events yet. Install its base code on your website (Ads → Automation → Pixels) before the campaign starts.'}
          {st && (st.state === 'inactive' || st.state === 'recent') ? ' Check that the pixel is still on your website: Meta needs recent events to optimise.' : ''}
        </p>
      )}
    </>
  );
}
