// /help: common questions, grouped.
import { CtaBand, PageHero, SiteLink, SitePage } from '../SiteChrome';
import { PAGE_META } from '../siteMeta';
import { FaqList, Section } from './parts';
import type { Faq } from '../content/products';

const GROUPS: { id: string; icon: string; title: string; faqs: Faq[] }[] = [
  {
    id: 'getting-started',
    icon: 'rocket_launch',
    title: 'Getting started',
    faqs: [
      { q: 'What do I need to start?', a: 'A phone number that can receive an SMS or call for verification, and a Facebook account to create or pick your Meta business. Sign up, then connect the number with Meta’s official signup inside the CRM. It takes a few minutes.' },
      { q: 'Can I use a number that is already on the WhatsApp app?', a: 'Yes. The number moves to the WhatsApp Business API, which works through the CRM instead of the phone app. Our team guides you through the move.' },
      { q: 'Do I need Meta business verification?', a: 'You can start without it. Verifying your business with Meta raises your messaging limits and is needed for some features, and we can help you through it.' },
      { q: 'Can I see it before I sign up?', a: 'Yes. Book a free 30-minute demo with our team. After you sign up, every feature is free for 7 days.' },
    ],
  },
  {
    id: 'whatsapp-api',
    icon: 'verified',
    title: 'WhatsApp Business API',
    faqs: [
      { q: 'What is the WhatsApp Business API?', a: 'Meta’s official way for businesses to use WhatsApp from software: a shared team inbox, automation, campaigns and integrations, instead of one phone.' },
      { q: 'What is the 24-hour window?', a: 'After a customer messages you, you can reply freely for 24 hours. Outside that window, you can only start a conversation with an approved template.' },
      { q: 'How many people can I message a day?', a: 'Meta sets a daily limit on how many people your number can start conversations with. It rises automatically as you send messages people want to receive, and business verification raises it too.' },
      { q: 'Is there a setup fee?', a: 'No. Connecting your number to the API through Kapso is free; you pay only for your plan and Meta’s message charges.' },
    ],
  },
  {
    id: 'templates',
    icon: 'description',
    title: 'Templates & campaigns',
    faqs: [
      { q: 'How long does template approval take?', a: 'Meta usually reviews a template within minutes, sometimes up to a day. The CRM shows its status and Meta’s reason if it is rejected.' },
      { q: 'Which template formats can I make?', a: 'Text, image, video and document templates with buttons on every plan. Carousels from Basic, limited-time offers from Pro, and authentication (one-time code) templates from Basic.' },
      { q: 'What does a campaign message cost?', a: 'Meta charges each template message by category: marketing, utility or authentication. Rates differ by country; see our WhatsApp pricing guide.' },
      { q: 'Can I schedule campaigns and follow-ups?', a: 'Yes. Schedule a campaign for later, or add drip follow-ups that go out after hours or days and stop when the person replies.' },
    ],
  },
  {
    id: 'automation',
    icon: 'account_tree',
    title: 'Automation',
    faqs: [
      { q: 'Do I need to code to build a chatbot?', a: 'No. Journeys are built with a drag-and-drop builder: messages, buttons, lists, media, keyword replies and conditions.' },
      { q: 'What are WhatsApp Flows?', a: 'Native forms that open inside WhatsApp, for bookings, orders, sign-ups and surveys. Build them visually in the CRM (Basic plan and up).' },
      { q: 'Can a person take over from the bot?', a: 'Yes. One tap pauses the bot for that chat while your team replies.' },
    ],
  },
  {
    id: 'billing',
    icon: 'receipt_long',
    title: 'Plans & billing',
    faqs: [
      { q: 'Is there a free trial?', a: 'Yes, 7 days with every feature, with up to 5 templates and 3 campaigns during the trial. No card is needed.' },
      { q: 'Do plans renew automatically?', a: 'No. You pay for a month, quarter or year in advance and we never charge you again on our own.' },
      { q: 'Are Meta’s message charges included in the plan?', a: 'No. Meta charges them to your WhatsApp account separately. Each number gets 1,000 free service messages (replies) a month; see our WhatsApp pricing guide.' },
      { q: 'Can I get a refund?', a: 'See our Refund and Cancellation Policy for when refunds apply.' },
    ],
  },
  {
    id: 'api',
    icon: 'code',
    title: 'API & integrations',
    faqs: [
      { q: 'What can I do with the API?', a: 'Send templates and one-time codes, read your catalog, offers, members and free slots, update products and take bookings, from your own servers and websites.' },
      { q: 'Where do I get an API key?', a: 'In the CRM, open API on the Templates, Catalog, Categories, Members or Offers page. The API is in the Basic, Pro and Premium plans.' },
      { q: 'Can I show my products or doctors on my website?', a: 'Yes. Create a website key for your domain and use the ready-made snippet, or call the API from your own code. See the API documentation.' },
    ],
  },
  {
    id: 'account',
    icon: 'manage_accounts',
    title: 'Account & data',
    faqs: [
      { q: 'Who can see my customers’ data?', a: 'Only your account. We process it to run the service, as our Privacy Policy describes.' },
      { q: 'How do I delete my account and data?', a: 'Follow the steps on our Data Deletion page, or email privacy@kapsosolutions.com.' },
      { q: 'Can my whole team use one account?', a: 'Your team signs in to the same account from any browser and works from the shared inbox.' },
    ],
  },
];

export function HelpPage() {
  return (
    <SitePage meta={PAGE_META.get('/help')}>
      {(openDemo) => (
        <>
          <PageHero eyebrow="Help center" title={<>How can we <em>help</em>?</>} sub="Answers to the questions we hear most. Can’t find yours? WhatsApp us or send a message.">
            <div className="sx-chip-row center">
              {GROUPS.map((g) => (
                <a key={g.id} className="sx-chip" href={`#${g.id}`}>
                  <span className="material-icons" aria-hidden="true">{g.icon}</span>
                  {g.title}
                </a>
              ))}
            </div>
          </PageHero>
          {GROUPS.map((g, i) => (
            <Section key={g.id} id={g.id} title={g.title} tint={i % 2 === 1} center>
              <FaqList items={g.faqs} />
            </Section>
          ))}
          <Section center>
            <p className="sx-sub">
              Still stuck? <SiteLink href="/contact?topic=support">Send us a message</SiteLink>, read the <SiteLink href="/docs">API docs</SiteLink>, or see
              our <SiteLink href="/privacy">Privacy Policy</SiteLink> and <SiteLink href="/refund">Refund Policy</SiteLink>.
            </p>
          </Section>
          <CtaBand onDemo={openDemo} />
        </>
      )}
    </SitePage>
  );
}
