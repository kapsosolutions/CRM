import { SiteLink, SitePage } from '../SiteChrome';
import { SITE_NAME } from '../siteMeta';

const META = { path: '/404', title: `Page not found | ${SITE_NAME}`, description: 'This page doesn’t exist.' };

/** An unknown website path. Not indexed. */
export function NotFoundPage() {
  return (
    <SitePage meta={META} noindex>
      {() => (
        <section className="sx-hero center">
          <div className="sx-wrap">
            <div className="sx-eyebrow">404</div>
            <h1 className="sx-h1">This page doesn’t exist</h1>
            <p className="sx-lead">The link may be old or mistyped. These might help:</p>
            <div className="sx-chip-row center">
              <SiteLink className="sx-chip" href="/">Home</SiteLink>
              <SiteLink className="sx-chip" href="/product">Product</SiteLink>
              <SiteLink className="sx-chip" href="/pricing">Pricing</SiteLink>
              <SiteLink className="sx-chip" href="/docs">API documentation</SiteLink>
              <SiteLink className="sx-chip" href="/contact">Contact</SiteLink>
            </div>
          </div>
        </section>
      )}
    </SitePage>
  );
}
