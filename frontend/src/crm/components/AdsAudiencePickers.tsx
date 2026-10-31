// Ads Manager S4: the custom-audience pickers used by the S1 wizard's audience
// step (and so the S2 ad set editor, which reuses it): include / exclude
// custom and lookalike audiences, and "start from a saved audience". Kept
// apart from AdsAudiences.tsx so the wizard doesn't import the Audiences tab
// (which itself reuses the wizard's StepAudience).
import { useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type { AdsAudienceItem, AdsAudienceRef, AdsAudienceSpec, AdsCampaignSpec, AdsSavedAudience, AdsSavedAudiences } from '../types';
import { useConfirm } from './Dialogs';
import { BladeSpinner } from './BladeSpinner';
import { errText } from './MetaAdsDashboard';

type SetSpec = (fn: (s: AdsCampaignSpec) => AdsCampaignSpec) => void;

export const TYPE_LABEL: Record<string, string> = {
  customer_list: 'Customer list', custom: 'Custom audience', lookalike: 'Lookalike', website: 'Website', engagement: 'Engagement', app: 'App activity',
  offline: 'Offline activity', other: 'Other',
};
export const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export function sizeText(a: AdsAudienceItem): string {
  if (!a.size) return a.type === 'lookalike' ? 'Shown once it runs' : 'Not reported yet';
  if (a.size.upper && a.size.upper !== a.size.lower) return `${compact(a.size.lower)} – ${compact(a.size.upper)}`;
  return a.size.lower ? compact(a.size.lower) : 'Matching…';
}

export function savedSummary(a: AdsAudienceSpec): string {
  const parts: string[] = [];
  if (a.locations?.length) parts.push(a.locations.map((l) => l.name).slice(0, 3).join(', ') + (a.locations.length > 3 ? ` +${a.locations.length - 3}` : ''));
  parts.push(`${a.ageMin}–${a.ageMax === 65 ? '65+' : a.ageMax}`);
  if (a.genders !== 'all') parts.push(a.genders === 'male' ? 'men' : 'women');
  if (a.detailed?.length) parts.push(`${a.detailed.length} interest${a.detailed.length === 1 ? '' : 's'}`);
  if (a.customAudiences?.length) parts.push(`${a.customAudiences.length} custom audience${a.customAudiences.length === 1 ? '' : 's'}`);
  if (a.excludedCustomAudiences?.length) parts.push(`${a.excludedCustomAudiences.length} excluded`);
  return parts.join(' · ');
}

// ------------------------------------------- pickers for the audience step --

/** Lazily loads the ad account's custom audiences (for the pickers). */
function useAudienceList(api: CrmApi) {
  const [list, setList] = useState<AdsAudienceItem[] | null>(null);
  const [error, setError] = useState('');
  const [want, setWant] = useState(false);
  useEffect(() => {
    if (!want || list) return undefined;
    let live = true;
    api
      .getAdsAudiences()
      .then((r) => live && setList(r.audiences))
      .catch((e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [api, want, list]);
  return { list, error, load: () => setWant(true) };
}

/**
 * Include / exclude custom and lookalike audiences (S1 wizard audience step,
 * S2 ad set editor). The server checks every id against the ad account.
 */
export function CustomAudiencePicker({ api, spec, setSpec }: { api: CrmApi; spec: AdsCampaignSpec; setSpec: SetSpec }) {
  const a = spec.audience;
  const inc = a.customAudiences || [];
  const exc = a.excludedCustomAudiences || [];
  const restricted = spec.specialAdCategories.some((c) => ['CREDIT', 'FINANCIAL_PRODUCTS_SERVICES', 'EMPLOYMENT', 'HOUSING'].includes(c));
  const [mode, setMode] = useState<'' | 'include' | 'exclude'>('');
  const { list, error, load } = useAudienceList(api);
  const setLists = (patch: { customAudiences?: AdsAudienceRef[]; excludedCustomAudiences?: AdsAudienceRef[] }) =>
    setSpec((s) => ({ ...s, audience: { ...s.audience, customAudiences: s.audience.customAudiences || [], excludedCustomAudiences: s.audience.excludedCustomAudiences || [], ...patch } }));
  const byId = useMemo(() => new Map((list || []).map((x) => [x.id, x])), [list]);
  const lookalikeChosen = [...inc, ...exc].filter((x) => byId.get(x.id)?.type === 'lookalike');
  function pick(x: AdsAudienceItem) {
    const ref = { id: x.id, name: x.name };
    if (mode === 'include') setLists({ customAudiences: [...inc.filter((y) => y.id !== x.id), ref], excludedCustomAudiences: exc.filter((y) => y.id !== x.id) });
    else setLists({ excludedCustomAudiences: [...exc.filter((y) => y.id !== x.id), ref], customAudiences: inc.filter((y) => y.id !== x.id) });
    setMode('');
  }
  const open = (m: 'include' | 'exclude') => {
    load();
    setMode(mode === m ? '' : m);
  };
  return (
    <section className="ads-wz-section" data-testid="ads-wz-custom-audiences">
      <h4>Custom audiences</h4>
      <p className="hint">
        Show the ad to people from your CRM contacts or a lookalike of them, or leave them out (for example, existing customers).
        {a.advantageAudience ? ' With Advantage+ audience on, Meta treats included audiences as a suggestion; exclusions always apply.' : ''}
      </p>
      <div className="ads-wz-choice">
        <button type="button" className={`ads-btn sm${mode === 'include' ? ' primary' : ''}`} onClick={() => open('include')} data-testid="ads-wz-ca-add">
          <span className="material-icons" aria-hidden="true">add</span> Include audience
        </button>
        <button type="button" className={`ads-btn sm${mode === 'exclude' ? ' primary' : ''}`} onClick={() => open('exclude')} data-testid="ads-wz-ca-exclude">
          <span className="material-icons" aria-hidden="true">remove</span> Exclude audience
        </button>
      </div>
      {mode && (
        <div className="ads-wz-ca-list" data-testid="ads-wz-ca-list">
          {error && <p className="ads-wz-hint" role="alert">{error}</p>}
          {!list && !error && <BladeSpinner center={true} containerHeight={50} />}
          {list && !list.length && <p className="ads-wz-hint" data-testid="ads-wz-ca-none">No custom audiences yet. Create one on the Ads page’s Audiences tab.</p>}
          {list && list.length > 0 && (
            <ul className="ads-wz-results" style={{ position: 'static', marginTop: 6 }}>
              {list.map((x) => {
                const chosen = (mode === 'include' ? inc : exc).some((y) => y.id === x.id);
                const blocked = x.flagged ? 'Meta flagged it' : restricted && x.type === 'lookalike' ? 'Not allowed for housing, employment or financial ads' : x.ready === false ? 'Not ready at Meta yet' : '';
                return (
                  <li key={x.id}>
                    <button type="button" disabled={chosen || (!!blocked && blocked !== 'Not ready at Meta yet')} onClick={() => pick(x)} data-testid={`ads-wz-ca-option-${x.id}`} title={blocked || undefined}>
                      <span>{x.name}</span>
                      <small>{TYPE_LABEL[x.type] || x.type} · {sizeText(x)}{blocked ? ` · ${blocked}` : ''}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <div className="ads-wz-chips" data-testid="ads-wz-ca-included">
        {inc.map((x) => (
          <span key={x.id} className="ads-wz-chip">
            {x.name || x.id}
            <button type="button" aria-label={`Remove ${x.name}`} onClick={() => setLists({ customAudiences: inc.filter((y) => y.id !== x.id) })}>×</button>
          </span>
        ))}
      </div>
      <div className="ads-wz-chips" data-testid="ads-wz-ca-excluded">
        {exc.map((x) => (
          <span key={x.id} className="ads-wz-chip ex">
            Excluded: {x.name || x.id}
            <button type="button" aria-label={`Remove ${x.name}`} onClick={() => setLists({ excludedCustomAudiences: exc.filter((y) => y.id !== x.id) })}>×</button>
          </span>
        ))}
      </div>
      {!inc.length && !exc.length && <small className="ads-wz-hint">No custom audiences: the ad can reach anyone matching the settings above.</small>}
      {restricted && lookalikeChosen.length > 0 && (
        <small className="ads-mg-err" role="alert" data-testid="ads-wz-ca-restricted">Lookalike audiences aren’t allowed for housing, employment or financial products ads. Remove them.</small>
      )}
    </section>
  );
}

/** "Start from a saved audience": copies a saved audience into the editor. */
export function SavedAudienceStart({ api, spec, setSpec }: { api: CrmApi; spec: AdsCampaignSpec; setSpec: SetSpec }) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AdsSavedAudiences | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || data) return undefined;
    let live = true;
    api
      .getAdsSavedAudiences()
      .then((r) => live && setData(r))
      .catch((e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [api, open, data]);
  async function use(s: AdsSavedAudience) {
    const cur = spec.audience;
    const hasSome = cur.locations.length || cur.detailed.length || (cur.customAudiences || []).length;
    if (hasSome) {
      const ok = await confirm({ title: `Use “${s.name}”?`, message: 'It replaces the audience settings on this step. You can still change them afterwards.', confirmLabel: 'Use it', tone: 'primary' });
      if (!ok) return;
    }
    setSpec((sp) => ({
      ...sp,
      audience: {
        ...sp.audience,
        ...s.audience,
        locations: s.audience.locations || [],
        excludedLocations: s.audience.excludedLocations || [],
        detailed: s.audience.detailed || [],
        locales: s.audience.locales || [],
        customAudiences: s.audience.customAudiences || [],
        excludedCustomAudiences: s.audience.excludedCustomAudiences || [],
      },
    }));
    setOpen(false);
  }
  const all = data ? [...data.crm, ...data.meta] : [];
  return (
    <div className="ads-wz-saved-start">
      <button type="button" className="ads-btn sm" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="ads-wz-saved-start">
        <span className="material-icons" aria-hidden="true">bookmarks</span> Start from a saved audience
      </button>
      {open && (
        <div className="ads-wz-ca-list" data-testid="ads-wz-saved-list">
          {error && <p className="ads-wz-hint" role="alert">{error}</p>}
          {!data && !error && <BladeSpinner center={true} containerHeight={50} />}
          {data && !all.length && <p className="ads-wz-hint">No saved audiences yet. Save one on the Ads page’s Audiences tab.</p>}
          {all.length > 0 && (
            <ul className="ads-wz-results" style={{ position: 'static', marginTop: 6 }}>
              {all.map((s) => (
                <li key={`${s.source}:${s.id}`}>
                  <button type="button" onClick={() => void use(s)} data-testid={`ads-wz-saved-option-${s.id}`}>
                    <span>{s.name}</span>
                    <small>{s.source === 'meta' ? 'From Meta' : 'In the CRM'} · {savedSummary(s.audience)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
