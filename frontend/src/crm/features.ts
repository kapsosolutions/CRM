// Features waiting for Meta's Advanced Access (App Review). While a feature is
// listed as `true` here, every place in the CRM shows it locked with a "Soon"
// badge instead of letting a business connect or use it. When Meta approves
// a feature, set it to `false` and redeploy the frontend: everything for it
// (pages, tabs, connect buttons) comes back as it was.
//
//   ads        Ads page (Meta ad account, Click-to-WhatsApp ads, lead forms)
//   instagram  Instagram DMs, its Automation bot, connecting it on Channel Status
//   messenger  Facebook Page messages, its Automation bot, connecting the Page
//   create     Create page (posts, reels, stories, Comment auto-DM)
//
// Early access: a business the server marks `earlyAccess` (EARLY_ACCESS_USERNAMES,
// e.g. Kapso's own account, whose Meta app roles already allow these) gets them
// all open. CrmShell calls setEarlyAccess() from /api/auth/me before it renders
// the pages, so every check below reads the switched values.
const WAITING = {
  ads: true,
  instagram: true,
  messenger: true,
  create: true,
};

export type SoonFeature = keyof typeof WAITING;

export const COMING_SOON: Record<SoonFeature, boolean> = { ...WAITING };

export const isSoon = (f: SoonFeature): boolean => COMING_SOON[f];

/** Opens every waiting feature for this session (or puts them back). */
export function setEarlyAccess(on: boolean) {
  for (const k of Object.keys(WAITING) as SoonFeature[]) COMING_SOON[k] = on ? false : WAITING[k];
}
