// What each page says while it's empty (CrmPageHero), in the business's own
// words: a clinic adds doctors and gets appointments, a garage adds services,
// a hotel adds room types and gets bookings.
import type { VerticalConfig } from './verticals';

export interface HeroCopy {
  title: string;
  subtitle: string;
  benefitsTitle: string;
  benefits: string[];
  actionLabel: string;
}

const low = (s: string) => s.toLowerCase();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "a doctor", "an agent". */
const an = (word: string) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;

export function offersHero(): HeroCopy {
  return {
    title: 'Run offers your customers see on WhatsApp',
    subtitle: 'Put a sale price on any product or size. WhatsApp shows the old price struck through next to the new one.',
    benefitsTitle: 'What an offer does',
    benefits: [
      'Percent or flat discounts per product, size or flavour',
      'Sale prices update in your WhatsApp catalog automatically',
      'Switch an offer off any time and prices go back to normal',
    ],
    actionLabel: 'Create offer',
  };
}

export function categoriesHero(v: VerticalConfig): HeroCopy {
  const one = low(v.categoryLabel);
  const many = low(v.categoryPlural);
  if (v.showsPage('catalog')) {
    const what = v.key === 'restaurant' ? 'menu' : 'products';
    return {
      title: `Sort your ${what} into ${many}`,
      subtitle: `${v.customerPlural} pick ${an(one)} in your WhatsApp flow, then see only what’s in it.`,
      benefitsTitle: `Why add ${many}`,
      benefits: [
        'Each one shows with its own 1:1 image in WhatsApp lists',
        `A product can sit in more than one ${one}`,
        `The catalog message lists only the ${one} they picked`,
      ],
      actionLabel: `Add ${one}`,
    };
  }
  const members = low(v.memberLabel);
  return {
    title: `Group your ${members} into ${many}`,
    subtitle: `${v.customerPlural} pick ${an(one)} first in your WhatsApp flow, then see only the ${members} in it.`,
    benefitsTitle: `Why add ${many}`,
    benefits: [
      'Each one shows with its own 1:1 image in WhatsApp lists',
      `Shorter lists: ${low(v.customerPlural)} only see the ${members} that fit`,
      'The ready-made flows in Automation → Templates use them straight away',
    ],
    actionLabel: `Add ${one}`,
  };
}

export function membersHero(v: VerticalConfig): HeroCopy {
  const many = low(v.memberLabel);
  const one = low(v.memberSingular);
  const who = v.customerPlural;
  if (v.archetype === 'lead') {
    return {
      title: `Add your ${many} to your WhatsApp enquiries`,
      subtitle: `${who} pick ${an(one)} in the flow, so every enquiry says who or what it’s for.`,
      benefitsTitle: `Why add ${many}`,
      benefits: [
        `Show each ${one} with a photo and a short description`,
        `Enquiries arrive with the ${one} they chose`,
        'Hide one any time without deleting it',
      ],
      actionLabel: `Add ${one}`,
    };
  }
  if (v.archetype === 'unit') {
    return {
      title: `Add your ${many} so ${low(who)} can book them`,
      subtitle: `Add photos, the ${low(v.feeLabel)}, amenities and the times each one can be booked.`,
      benefitsTitle: `Why add ${many}`,
      benefits: [
        `${who} browse your ${many} with photos and prices in WhatsApp`,
        'Only times that are still free can be booked',
        `Bookings land on the ${v.ordersLabel} page with a PDF slip`,
      ],
      actionLabel: `Add ${one}`,
    };
  }
  return {
    title: `Add your ${many} so ${low(who)} can book them`,
    subtitle: `Set each ${one}’s ${low(v.feeLabel)} and hours. WhatsApp shows only the times that are still free.`,
    benefitsTitle: `Why add ${many}`,
    benefits: [
      `${who} pick ${an(one)} and a free time in WhatsApp`,
      'Booked times disappear; breaks and days off stay closed',
      `Mark ${an(one)} unavailable and booked ${low(who)} are told`,
    ],
    actionLabel: `Add ${one}`,
  };
}

export function ordersHero(v: VerticalConfig): HeroCopy {
  const page = low(v.ordersLabel);
  const who = low(v.customerLabel);
  if (v.archetype === 'catalog') {
    return {
      title: `Your WhatsApp ${page} appear here`,
      subtitle: `When ${an(who)} orders from your catalog on WhatsApp, the order lands here with what they bought and how they’re paying.`,
      benefitsTitle: 'What you can do here',
      benefits: [
        'Change the status and the customer gets an update',
        'See paid / not paid, the delivery address and the location pin',
        'Open the customer’s chat in one click',
      ],
      actionLabel: 'Set up an order flow',
    };
  }
  if (v.archetype === 'lead') {
    return {
      title: `Your WhatsApp ${page} appear here`,
      subtitle: `When ${an(who)} sends an enquiry on WhatsApp, it lands here with what they asked for.`,
      benefitsTitle: 'What you can do here',
      benefits: [
        'Mark each one New, In progress or Closed',
        'Their form answers are on the Form submissions tab',
        'Open the chat to follow up in one click',
      ],
      actionLabel: 'Set up an enquiry flow',
    };
  }
  return {
    title: `Your WhatsApp ${page} appear here`,
    subtitle: `When ${an(who)} books a time on WhatsApp, it lands here with the ${low(v.memberSingular)}, the day and how they’re paying.`,
    benefitsTitle: 'What you can do here',
    benefits: [
      'Today, active, completed and cancelled in their own tabs',
      'Each booking keeps its PDF slip',
      'Reschedules and cancellations from WhatsApp update it here',
    ],
    actionLabel: 'Set up a booking flow',
  };
}

/** A form page (Forms → "Pickup requests") with no answers yet. */
export function formPageHero(label: string, formTitle: string | null, usedIn: string[]): HeroCopy {
  if (!formTitle) {
    return {
      title: 'Answers from your own forms appear here',
      subtitle: 'Forms you build field by field in Automation land here when customers send them.',
      benefitsTitle: 'What you can do here',
      benefits: FORM_BENEFITS,
      actionLabel: 'Open Automation',
    };
  }
  return {
    title: `Collect ${low(label)} on WhatsApp`,
    subtitle: usedIn.length
      ? `No ${low(label)} yet. When customers send the “${formTitle}” form, their answers appear here.`
      : `No ${low(label)} yet. Add the “${formTitle}” form to a WhatsApp flow and customers’ answers appear here.`,
    benefitsTitle: 'What you can do here',
    benefits: FORM_BENEFITS,
    actionLabel: 'Add it in Automation',
  };
}

const FORM_BENEFITS = [
  'Every answer in one place: text, dates, photos and documents',
  'Mark each one New, Contacted, Confirmed or Done',
  'Open the customer’s chat to reply',
];

/** Orders → Form submissions with nothing yet. */
export function submissionsHero(): HeroCopy {
  return {
    title: 'Form answers from WhatsApp appear here',
    subtitle: 'Add a ready-made form to a flow (Automation → Flows → Build → Forms). Every answer customers send lands here.',
    benefitsTitle: 'What you can do here',
    benefits: FORM_BENEFITS,
    actionLabel: 'Add a form in Automation',
  };
}

export function flowsHero(v: VerticalConfig): HeroCopy {
  return {
    title: 'Automate your WhatsApp chats with Flows',
    subtitle: 'Forms, menus, bookings and orders that open inside WhatsApp. Start from a ready-made flow or build your own.',
    benefitsTitle: 'What Flows do',
    benefits: [
      `Ready-made flows for ${v.key === 'other' ? 'your business' : cap(v.label)}, already wired`,
      'Customers fill forms and pick times without leaving the chat',
      'Answers, bookings and orders land straight in your CRM',
    ],
    actionLabel: 'Browse templates',
  };
}
