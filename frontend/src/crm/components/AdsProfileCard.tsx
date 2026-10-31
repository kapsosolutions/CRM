// The Ads overview's profile header, like Meta Business Suite: the Facebook
// Page's picture (Facebook badge) and its Instagram account's picture
// (Instagram badge, greyed when none is linked), the Page name, and links to
// edit the Page, connect / open Instagram and get a verified badge.
// Read-only: everything comes from the ads connection (/meta/create/options and
// /meta/create/pages/:id, cached by the server). Shows nothing if Meta can't say.
import { useEffect, useState } from 'react';
import type { CrmApi } from '../api';
import type { AdsCreatePage, AdsPageDetails } from '../types';

type Ig = AdsPageDetails['instagram'][number];

export function AdsProfileCard({ api, pageId = '', refreshNonce = 0 }: { api: CrmApi; pageId?: string; refreshNonce?: number }) {
  const [state, setState] = useState<{ page: AdsCreatePage; ig: Ig | null } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // The Page the ad account promotes: the lead-forms Page, else its first Page.
        const opts = await api.getAdsCreateOptions();
        const id = pageId || opts.leadFormsPage?.id || opts.pages[0]?.id || '';
        if (!id) return;
        const d = await api.getAdsPageDetails(id);
        // The account linked to the Page first, then one the ad account or business owns.
        const ig = d.instagram.find((a) => a.source === 'page') || d.instagram[0] || null;
        if (live) setState({ page: d.page, ig });
      } catch {
        if (live) setState(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [api, pageId, refreshNonce]);

  if (!state) return null;
  const { page, ig } = state;
  const initial = (page.name || 'P').slice(0, 1).toUpperCase();
  return (
    <section className="ads-profile" data-testid="ads-profile">
      <div className="ads-profile-avatars">
        <span className="ads-profile-av fb" title={`${page.name} (Facebook Page)`}>
          {page.picture ? <img src={page.picture} alt="" referrerPolicy="no-referrer" /> : <i>{initial}</i>}
          <img className="ads-profile-badge" src="/channel-facebook.svg" alt="Facebook" />
        </span>
        <span className={`ads-profile-av ig${ig ? '' : ' off'}`} title={ig ? `@${ig.username} (Instagram)` : 'No Instagram account linked'} data-testid="ads-profile-ig">
          {ig?.picture ? <img src={ig.picture} alt="" referrerPolicy="no-referrer" /> : page.picture ? <img src={page.picture} alt="" referrerPolicy="no-referrer" /> : <i>{initial}</i>}
          <img className="ads-profile-badge" src="/channel-instagram.svg" alt="Instagram" />
        </span>
      </div>
      <div className="ads-profile-text">
        <h3 data-testid="ads-profile-name">{page.name}</h3>
        <div className="ads-profile-links">
          <a href={`https://www.facebook.com/${encodeURIComponent(page.id)}`} target="_blank" rel="noopener noreferrer" data-testid="ads-profile-edit-page">
            Edit Facebook Page
          </a>
          <span aria-hidden="true">|</span>
          {ig ? (
            <a href={`https://www.instagram.com/${encodeURIComponent(ig.username)}/`} target="_blank" rel="noopener noreferrer" data-testid="ads-profile-ig-link">
              @{ig.username}
            </a>
          ) : (
            <a href="https://www.facebook.com/settings/?tab=linked_instagram" target="_blank" rel="noopener noreferrer" data-testid="ads-profile-connect-ig">
              Connect Instagram
            </a>
          )}
        </div>
        <a className="ads-profile-verified" href="https://www.facebook.com/business/tools/meta-verified" target="_blank" rel="noopener noreferrer">
          <span className="material-icons" aria-hidden="true">verified</span> Get a verified badge
        </a>
      </div>
    </section>
  );
}
