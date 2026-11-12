// A page the automation hasn't started filling yet (a form page, Orders /
// Appointments / Enquiries): it opens once a published WhatsApp flow uses it,
// or a journey with a Book or Order step. flowForms.ts pagesInUse decides.
import { CrmPageHero } from './CrmPageHero';
import { LockRailSvg } from './NavRail';

export function AutomationLockedPage({
  label, form, ordersWord, onOpenAutomation, onOpenAnyway,
}: {
  /** The page's name ("Job applications", "Appointments"). */
  label: string;
  /** The form's title, for a form page. */
  form?: string;
  /** What the Orders page holds, lower-case ("appointments"). */
  ordersWord?: string;
  onOpenAutomation: () => void;
  /** Platform owner (master password): look at the page anyway, this visit. */
  onOpenAnyway?: () => void;
}) {
  const subtitle = form
    ? `This page fills with the answers to the “${form}” WhatsApp form. It unlocks as soon as a published flow uses that form.`
    : `This page fills with the ${ordersWord} your customers make on WhatsApp. It unlocks as soon as your automation takes them: a journey with a Book or Order step, or a published WhatsApp flow.`;
  return (
    <div className="page-body" data-testid="automation-locked">
      <CrmPageHero
        icon={<LockRailSvg size={26} />}
        tone="teal"
        title={`${label} opens with your automation`}
        subtitle={subtitle}
        benefitsTitle="Once it’s open"
        benefits={form
          ? ['Every answer in one place: text, dates, photos and documents', 'Mark each one New, Contacted, Confirmed or Done', 'Open the customer’s chat to reply']
          : ['Today, active, completed and cancelled in their own tabs', 'Change the status and the customer gets an update', 'Open the customer’s chat in one click']}
        actionLabel="Open Automation"
        actionIcon="hub"
        onAction={onOpenAutomation}
        secondaryLabel={onOpenAnyway ? 'Open anyway (master)' : undefined}
        onSecondary={onOpenAnyway}
        note={form ? 'WhatsApp forms are set up for you by our team. Message us to add this one.' : undefined}
        testId="automation-locked-hero"
      />
    </div>
  );
}
