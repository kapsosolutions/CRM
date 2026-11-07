// The website's top menus (SiteChrome.tsx) and the footer columns. Every link
// is a real page (siteMeta.ts).
import type { IndustrySlug, ProductSlug, TeamSlug } from './siteMeta';

export interface MenuLink {
  href: string;
  label: string;
  desc?: string;
  /** Material icon name. */
  icon: string;
  badge?: string;
}
export interface MenuGroup {
  title: string;
  links: MenuLink[];
  /** Shown as a tinted panel (Free tools). */
  tinted?: boolean;
}
export interface Menu {
  key: string;
  label: string;
  groups: MenuGroup[];
  /** A link under the groups ("All industries →"). */
  more?: { href: string; label: string };
}

const product = (slug: ProductSlug, label: string, desc: string, icon: string, badge?: string): MenuLink => ({
  href: `/product/${slug}`, label, desc, icon, ...(badge ? { badge } : {}),
});
const team = (slug: TeamSlug, label: string, desc: string, icon: string): MenuLink => ({ href: `/solutions/${slug}`, label, desc, icon });
const industry = (slug: IndustrySlug, label: string, icon: string): MenuLink => ({ href: `/solutions/${slug}`, label, icon });

export const MENUS: Menu[] = [
  {
    key: 'solutions',
    label: 'Solutions',
    groups: [
      {
        title: 'By team',
        links: [
          team('marketing', 'Kapso for Marketing', 'Broadcasts, drips and offers that sell', 'campaign'),
          team('sales', 'Kapso for Sales', 'Capture, qualify and close leads on WhatsApp', 'trending_up'),
          team('support', 'Kapso for Support', 'Faster answers with a shared inbox and bots', 'support_agent'),
        ],
      },
      {
        title: 'By industry',
        links: [
          industry('ecommerce', 'E-commerce & Retail', 'shopping_bag'),
          industry('restaurants', 'Restaurants & Food', 'restaurant'),
          industry('healthcare', 'Hospitals & Clinics', 'local_hospital'),
          industry('salons-spas', 'Salons & Spas', 'content_cut'),
          industry('education', 'Education & Coaching', 'school'),
          industry('real-estate', 'Real Estate', 'apartment'),
          industry('hotels', 'Hotels & Resorts', 'hotel'),
          industry('gyms-fitness', 'Gyms & Fitness', 'fitness_center'),
        ],
      },
    ],
    more: { href: '/solutions', label: 'All solutions' },
  },
  {
    key: 'product',
    label: 'Product',
    groups: [
      {
        title: 'Capture leads',
        links: [
          product('click-to-whatsapp-ads', 'Click-to-WhatsApp ads', 'Ads that open a chat with you', 'ads_click', 'Soon'),
          product('instagram-messenger', 'Instagram & Messenger', 'DMs in the same inbox', 'forum', 'Soon'),
          { href: '/tools/whatsapp-chat-button', label: 'WhatsApp chat button', desc: 'A chat button for your website', icon: 'chat' },
          { href: '/tools/whatsapp-qr-code', label: 'WhatsApp QR code', desc: 'Scan to start a chat', icon: 'qr_code_2' },
        ],
      },
      {
        title: 'Convert & sell',
        links: [
          product('chatbot', 'No-code chatbot', 'Journeys that reply for you', 'account_tree'),
          product('whatsapp-flows', 'WhatsApp Flows', 'Forms inside the chat', 'dynamic_form'),
          product('broadcast', 'WhatsApp broadcast', 'Campaigns to your lists', 'campaign'),
          product('catalog', 'WhatsApp catalog', 'Products, carts and orders', 'storefront'),
          product('payments', 'Payments', 'Get paid in the chat', 'payments'),
        ],
      },
      {
        title: 'Serve & retain',
        links: [
          product('team-inbox', 'Team inbox', 'One inbox for the whole team', 'inbox'),
          product('appointments', 'Appointments', 'Bookings with live free slots', 'event_available'),
          product('notifications', 'Automatic notifications', 'Updates sent for you', 'notifications_active'),
          product('whatsapp-calling', 'WhatsApp calling', 'Voice calls from the CRM', 'call'),
        ],
      },
      {
        title: 'Scale',
        links: [
          product('whatsapp-business-api', 'WhatsApp Business API', 'Your number, official API', 'verified'),
          product('templates', 'Message templates', 'Approved messages, any format', 'description'),
          { href: '/developers', label: 'API for developers', desc: 'Your apps and website', icon: 'code' },
        ],
      },
    ],
    more: { href: '/product', label: 'Everything in Kapso' },
  },
  {
    key: 'resources',
    label: 'Resources',
    groups: [
      {
        title: 'Learn',
        links: [
          { href: '/help', label: 'Help center', desc: 'Answers to common questions', icon: 'help' },
          { href: '/resources/whatsapp-templates', label: 'WhatsApp templates', desc: 'Examples to start from', icon: 'library_books' },
          { href: '/resources/whatsapp-pricing', label: 'WhatsApp pricing explained', desc: 'How Meta charges messages', icon: 'request_quote' },
          { href: '/docs', label: 'API documentation', desc: 'Every endpoint, with examples', icon: 'menu_book' },
        ],
      },
      {
        title: 'Free tools',
        tinted: true,
        links: [
          { href: '/tools/whatsapp-link-generator', label: 'WhatsApp link generator', icon: 'link' },
          { href: '/tools/whatsapp-qr-code', label: 'WhatsApp QR code', icon: 'qr_code_2' },
          { href: '/tools/whatsapp-chat-button', label: 'WhatsApp chat button', icon: 'chat' },
          { href: '/tools/whatsapp-pricing-calculator', label: 'Message cost calculator', icon: 'calculate' },
        ],
      },
      {
        title: 'Company',
        links: [
          { href: '/about', label: 'About us', icon: 'info' },
          { href: '/contact', label: 'Contact', icon: 'mail' },
          { href: '/pricing', label: 'Pricing', icon: 'sell' },
        ],
      },
    ],
  },
  {
    key: 'api',
    label: 'API',
    groups: [
      {
        title: 'Build with Kapso',
        links: [
          { href: '/developers/messaging', label: 'WhatsApp Messaging API', desc: 'Send templates from your code', icon: 'send' },
          { href: '/developers/otp', label: 'WhatsApp OTP API', desc: 'One-time codes in two calls', icon: 'password' },
          { href: '/developers/catalog', label: 'Catalog API', desc: 'Products and offers on your site', icon: 'storefront' },
          { href: '/developers/bookings', label: 'Bookings API', desc: 'Members, free slots, bookings', icon: 'event_available' },
          { href: '/developers/website-keys', label: 'Website keys', desc: 'Safe keys for your web pages', icon: 'key' },
        ],
      },
    ],
    more: { href: '/developers', label: 'Developer hub' },
  },
];

export const FOOTER_COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/product/team-inbox', label: 'Team inbox' },
      { href: '/product/broadcast', label: 'WhatsApp broadcast' },
      { href: '/product/chatbot', label: 'No-code chatbot' },
      { href: '/product/whatsapp-flows', label: 'WhatsApp Flows' },
      { href: '/product/catalog', label: 'WhatsApp catalog' },
      { href: '/product/appointments', label: 'Appointments' },
      { href: '/product/whatsapp-business-api', label: 'WhatsApp Business API' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { href: '/solutions/marketing', label: 'For marketing' },
      { href: '/solutions/sales', label: 'For sales' },
      { href: '/solutions/support', label: 'For support' },
      { href: '/solutions/ecommerce', label: 'E-commerce' },
      { href: '/solutions/healthcare', label: 'Healthcare' },
      { href: '/solutions/restaurants', label: 'Restaurants' },
      { href: '/solutions', label: 'All industries' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { href: '/developers', label: 'Developer hub' },
      { href: '/docs', label: 'API documentation' },
      { href: '/developers/messaging', label: 'Messaging API' },
      { href: '/developers/catalog', label: 'Catalog API' },
      { href: '/developers/bookings', label: 'Bookings API' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/help', label: 'Help center' },
      { href: '/resources/whatsapp-templates', label: 'WhatsApp templates' },
      { href: '/resources/whatsapp-pricing', label: 'WhatsApp pricing' },
      { href: '/tools/whatsapp-link-generator', label: 'WhatsApp link generator' },
      { href: '/tools/whatsapp-qr-code', label: 'WhatsApp QR code' },
      { href: '/tools/whatsapp-chat-button', label: 'WhatsApp chat button' },
      { href: '/tools/whatsapp-pricing-calculator', label: 'Cost calculator' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About us' },
      { href: '/contact', label: 'Contact us' },
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/terms', label: 'Terms & Conditions' },
      { href: '/refund', label: 'Refund & Cancellation' },
      { href: '/data-deletion', label: 'Data Deletion' },
    ],
  },
];
