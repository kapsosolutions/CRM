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
export const COMING_SOON = {
  ads: true,
  instagram: true,
  messenger: true,
  create: true,
} as const;

export type SoonFeature = keyof typeof COMING_SOON;

export const isSoon = (f: SoonFeature): boolean => COMING_SOON[f];
