// The CRM sidebar: grouped sections with labels (collapses to icons, and is a drawer on small screens).
import { CrownIcon } from './PlanLocked';
import { FLOWS_MIN_LIMIT, flowsLockLimit, useMessagingLimit } from './MessagingLimit';
import type { ReactNode } from 'react';

/** A padlock, drawn like the sidebar's other icons. */
export function LockRailSvg({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={`lock-svg${className ? ` ${className}` : ''}`} aria-hidden="true">
      <rect x="3.5" y="8" width="13" height="9.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 8V5.5C6.5 3.567 8.067 2 10 2C11.933 2 13.5 3.567 13.5 5.5V8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="12.5" r="1.1" fill="currentColor" />
      <path d="M10 13.5V15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export type CrmView = 'chats' | 'templates' | 'campaigns' | 'flows' | 'catalog' | 'categories' | 'members' | 'offers' | 'orders' | 'ads' | 'create' | 'payment-config' | 'profile' | 'settings' | 'channel-status'
  // One ready-made form's submissions: 'form:pickup_request' (flowForms.ts).
  | `form:${string}`;

/** A form page's sidebar entry. */
export interface FormRailItem {
  key: `form:${string}`;
  label: string;
  /** Material icon ligature. */
  icon: string;
}

export const isFormView = (v: CrmView): v is `form:${string}` => v.startsWith('form:');

interface Props {
  view: CrmView;
  onChange: (v: CrmView) => void;
  /** Only these views are shown (business-vertical aware). Omit to show all. */
  allowed?: CrmView[];
  /** Overrides for item labels, e.g. Members → "Doctors". */
  labels?: Partial<Record<CrmView, string>>;
  /** Red count bubbles, e.g. { chats: 2 } = two chats with unread messages. */
  badges?: Partial<Record<CrmView, number>>;
  /** Items shown with a lock: the feature is coming soon (features.ts). */
  soon?: Partial<Record<CrmView, boolean>>;
  /** Items outside the business's plan, with the plan that unlocks them ("Basic"). */
  locked?: Partial<Record<CrmView, string>>;
  /** The Forms section: one page per ready-made form ("Pickup requests"). */
  forms?: FormRailItem[];
  /**
   * Pages that WhatsApp Flows fill (orders / appointments / enquiries, payment
   * configuration, the form pages). They carry a lock while the number's daily
   * limit keeps Flows closed (under FLOWS_MIN_LIMIT).
   */
  flowsFed?: CrmView[];
  /** The daily-limit lock doesn't apply (the platform owner, the demo). */
  limitBypass?: boolean;
  /**
   * Other locks, with why: WhatsApp not connected yet, or a page the
   * automation doesn't use yet (flowForms.ts pagesInUse).
   */
  extraLocks?: Partial<Record<CrmView, string>>;
}

/* User-provided vector SVGs matching WATI style navigation */
export function ChatsRailSvg() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3 0C1.34315 0 0 1.34315 0 3V11C0 12.6569 1.34315 14 3 14H11C12.6569 14 14 12.6569 14 11V3C14 1.34315 12.6569 0 11 0H3ZM13 7H9.5C9.22386 7 8.99999 7.22297 8.99999 7.49911L8.99967 7.51142C8.99925 7.52383 8.99835 7.54435 8.99639 7.5718C8.99245 7.62686 8.98435 7.7088 8.96774 7.80843C8.93414 8.01005 8.86786 8.27125 8.74029 8.52639C8.61369 8.77958 8.43166 9.01755 8.16796 9.19335C7.9074 9.36706 7.53751 9.5 7 9.5C6.46249 9.5 6.0926 9.36706 5.83204 9.19335C5.56834 9.01755 5.38631 8.77958 5.25971 8.52639C5.13214 8.27125 5.06586 8.01005 5.03226 7.80843C5.01565 7.7088 5.00755 7.62686 5.00361 7.5718C5.00165 7.54435 5.00075 7.52383 5.00033 7.51142L5 7.49938C4.99966 7.22352 4.77594 7 4.5 7H1V3C1 1.89543 1.89543 1 3 1H11C12.1046 1 13 1.89543 13 3V7ZM1 8H4.0505C4.09652 8.26433 4.18655 8.61614 4.36529 8.97361C4.55119 9.34542 4.83791 9.73245 5.27734 10.0254C5.7199 10.3204 6.28751 10.5 7 10.5C7.71249 10.5 8.2801 10.3204 8.72266 10.0254C9.16209 9.73245 9.44881 9.34542 9.63471 8.97361C9.81345 8.61614 9.90348 8.26433 9.9495 8H13V11C13 12.1046 12.1046 13 11 13H3C1.89543 13 1 12.1046 1 11V8Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function TemplatesRailSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M11.5 1C10.6716 1 10 1.67157 10 2.5V7.5C10 8.32843 10.6716 9 11.5 9H17.5C18.3284 9 19 8.32843 19 7.5V2.5C19 1.67157 18.3284 1 17.5 1H11.5ZM12.5 6H16.5C16.7761 6 17 6.22386 17 6.5C17 6.77614 16.7761 7 16.5 7H12.5C12.2239 7 12 6.77614 12 6.5C12 6.22386 12.2239 6 12.5 6ZM12 3.5C12 3.22386 12.2239 3 12.5 3H16.5C16.7761 3 17 3.22386 17 3.5C17 3.77614 16.7761 4 16.5 4H12.5C12.2239 4 12 3.77614 12 3.5ZM4.6 3H9V4H4.6C3.70383 4 3 4.71348 3 5.56582V12.2764C3 13.1288 3.70383 13.8423 4.6 13.8423H6.19908L6.2 17L6.20346 16.9997L6.20502 16.9988L10.4809 13.8423H15.4C16.2962 13.8423 17 13.1288 17 12.2764V10H17.5C17.6712 10 17.8384 9.98278 18 9.94999V12.2764C18 13.6935 16.8359 14.8423 15.4 14.8423H10.81L6.79895 17.8034C6.35668 18.1298 5.73 18.0406 5.39921 17.6042C5.26989 17.4335 5.2 17.2262 5.2 17.0133L5.19937 14.8423H4.6C3.16406 14.8423 2 13.6935 2 12.2764V5.56582C2 4.14876 3.16406 3 4.6 3Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function CampaignsRailSvg() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="17.5" viewBox="0 0 16 14" fill="none" aria-hidden="true">
      <path
        d="M16 1.50082C16 0.515273 15.0658 -0.202472 14.1135 0.0514668L1.11351 3.51813C0.456876 3.69323 0 4.28791 0 4.96749V7.47845C0 8.12409 0.413145 8.6973 1.02566 8.90147L3 9.55959V10.4492C3 12.2441 4.45507 13.6992 6.25 13.6992C7.62112 13.6992 8.79324 12.8505 9.27086 11.6499L14.0257 13.2348C14.997 13.5586 16 12.8356 16 11.8118V1.50082ZM8.31998 11.3329C7.97657 12.1363 7.17866 12.6992 6.25 12.6992C5.00736 12.6992 4 11.6919 4 10.4492V9.89292L8.31998 11.3329ZM14.3712 1.0177C14.6886 0.933056 15 1.1723 15 1.50082V11.8118C15 12.1531 14.6657 12.394 14.3419 12.2861L1.34189 7.95279C1.13771 7.88473 1 7.69366 1 7.47845V4.96749C1 4.74096 1.15229 4.54274 1.37117 4.48437L14.3712 1.0177Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function AutomationRailSvg() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="19" viewBox="0 0 20 19" fill="none" aria-hidden="true">
      <path
        d="M0 9.25473C0 11.3271 1.67996 13.007 3.75228 13.007C5.56782 13.007 7.08221 11.7176 7.42963 10.0046H9.50226V13.2546C9.50226 14.4972 10.5096 15.5046 11.7523 15.5046H12.5777C12.9261 17.2164 14.4399 18.5046 16.2545 18.5046C18.3269 18.5046 20.0068 16.8246 20.0068 14.7523C20.0068 12.68 18.3269 11 16.2545 11C14.4383 11 12.9234 12.2905 12.5768 14.0046H11.7523C11.338 14.0046 11.0023 13.6688 11.0023 13.2546V5.25457C11.0023 4.84036 11.338 4.50457 11.7523 4.50457H12.5777C12.9261 6.21638 14.4399 7.50457 16.2545 7.50457C18.3269 7.50457 20.0068 5.82462 20.0068 3.75229C20.0068 1.67996 18.3269 0 16.2545 0C14.4383 0 12.9234 1.29048 12.5768 3.00457H11.7523C10.5096 3.00457 9.50226 4.01193 9.50226 5.25457V8.50457H7.42957C7.08202 6.7917 5.56771 5.50244 3.75228 5.50244C1.67996 5.50244 0 7.1824 0 9.25473ZM3.75228 11.507C2.50838 11.507 1.5 10.4986 1.5 9.25473C1.5 8.01082 2.50838 7.00244 3.75228 7.00244C4.99619 7.00244 6.00457 8.01082 6.00457 9.25473C6.00457 10.4986 4.99619 11.507 3.75228 11.507ZM16.2545 17.0046C15.0106 17.0046 14.0023 15.9962 14.0023 14.7523C14.0023 13.5084 15.0106 12.5 16.2545 12.5C17.4984 12.5 18.5068 13.5084 18.5068 14.7523C18.5068 15.9962 17.4984 17.0046 16.2545 17.0046ZM14.0023 3.75229C14.0023 2.50838 15.0106 1.5 16.2545 1.5C17.4984 1.5 18.5068 2.50838 18.5068 3.75229C18.5068 4.99619 17.4984 6.00457 16.2545 6.00457C15.0106 6.00457 14.0023 4.99619 14.0023 3.75229Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function CatalogRailSvg() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M0 0.75C0 0.335786 0.335786 0 0.75 0H1.30826C2.25873 0 2.82782 0.638993 3.15325 1.23299C3.37016 1.62894 3.52708 2.08818 3.64982 2.50395C3.68306 2.50134 3.71674 2.5 3.7508 2.5H16.2481C17.0783 2.5 17.6778 3.29442 17.4502 4.0928L15.6224 10.5019C15.2856 11.6832 14.2062 12.4978 12.9779 12.4978H7.02977C5.79128 12.4978 4.7056 11.6699 4.37783 10.4756L3.61734 7.70455L2.35874 3.45578L2.3567 3.44834C2.201 2.88051 2.05487 2.35005 1.83773 1.9537C1.62686 1.5688 1.45877 1.5 1.30826 1.5H0.75C0.335786 1.5 0 1.16421 0 0.75ZM5.07283 7.34027L5.82434 10.0786C5.97333 10.6215 6.46682 10.9978 7.02977 10.9978H12.9779C13.5362 10.9978 14.0268 10.6275 14.18 10.0906L15.9168 4H4.08549L5.05906 7.28682C5.06434 7.3046 5.06892 7.32243 5.07283 7.34027ZM8.5 15.5C8.5 16.6046 7.60457 17.5 6.5 17.5C5.39543 17.5 4.5 16.6046 4.5 15.5C4.5 14.3954 5.39543 13.5 6.5 13.5C7.60457 13.5 8.5 14.3954 8.5 15.5ZM7 15.5C7 15.2239 6.77614 15 6.5 15C6.22386 15 6 15.2239 6 15.5C6 15.7761 6.22386 16 6.5 16C6.77614 16 7 15.7761 7 15.5ZM15.5 15.5C15.5 16.6046 14.6046 17.5 13.5 17.5C12.3954 17.5 11.5 16.6046 11.5 15.5C11.5 14.3954 12.3954 13.5 13.5 13.5C14.6046 13.5 15.5 14.3954 15.5 15.5ZM14 15.5C14 15.2239 13.7761 15 13.5 15C13.2239 15 13 15.2239 13 15.5C13 15.7761 13.2239 16 13.5 16C13.7761 16 14 15.7761 14 15.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function OffersRailSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M18 10L10 18L2 10V3H9L18 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="6" cy="6" r="1.2" fill="currentColor" />
      <path d="M8 12L12 8M8.5 8.5H8.51M11.5 11.5H11.51" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function AdsRailSvg({ size = 18, width, height, className = '', style }: { size?: number; width?: number; height?: number; className?: string; style?: React.CSSProperties } = {}) {
  const w = width ?? size;
  const h = height ?? Math.round((size * 21) / 18);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={w} height={h} viewBox="0 0 18 21" fill="none" className={className} style={style} aria-hidden="true">
      <path
        d="M6.75 0C7.16421 0 7.5 0.335786 7.5 0.75V3.25C7.5 3.66421 7.16421 4 6.75 4C6.33579 4 6 3.66421 6 3.25V0.75C6 0.335786 6.33579 0 6.75 0ZM1.96965 1.96981C2.26253 1.67691 2.73741 1.67689 3.03031 1.96977L4.78031 3.71965C5.07322 4.01253 5.07323 4.48741 4.78035 4.78031C4.48747 5.07322 4.01259 5.07323 3.71969 4.78035L1.96969 3.03047C1.67678 2.73759 1.67677 2.26271 1.96965 1.96981ZM11.5303 1.96979C11.8232 2.26269 11.8232 2.73756 11.5303 3.03045L9.78033 4.78045C9.48744 5.07335 9.01256 5.07335 8.71967 4.78045C8.42678 4.48756 8.42678 4.01269 8.71967 3.71979L10.4697 1.96979C10.7626 1.6769 11.2374 1.6769 11.5303 1.96979ZM0 6.75C0 6.33579 0.335786 6 0.75 6H3.25C3.66421 6 4 6.33579 4 6.75C4 7.16421 3.66421 7.5 3.25 7.5H0.75C0.335786 7.5 0 7.16421 0 6.75ZM8.17734 6.48562C7.32176 5.75227 6 6.36019 6 7.48706V18.7608C6 19.9715 7.49462 20.5426 8.30191 19.6403L10.9165 16.7181C11.1918 16.4104 11.5801 16.2274 11.9927 16.2109L15.8327 16.0573C17.0304 16.0094 17.5484 14.518 16.6384 13.7379L8.17734 6.48562ZM7.5 18.287V7.88067L15.3123 14.5769L11.9327 14.7121C11.1146 14.7448 10.3446 15.1077 9.79865 15.7179L7.5 18.287Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SettingsRailSvg() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="19" height="20" viewBox="0 0 19 20" fill="none" aria-hidden="true">
      <path
        d="M6.08023 1.5316L5.82068 2.87197C5.61834 3.91693 4.53781 4.54078 3.53167 4.19354L2.23824 3.74714C2.00313 4.0671 1.80194 4.41323 1.63983 4.78022L2.67435 5.67816C3.47818 6.37588 3.47818 7.62363 2.67434 8.32135L1.63967 9.21943C1.80174 9.5864 2.00289 9.93251 2.23795 10.2525L3.53167 9.80597C4.5378 9.45873 5.61834 10.0826 5.82068 11.1275L6.08032 12.4684C6.47266 12.5104 6.88354 12.5101 7.27569 12.4675L7.53516 11.1275C7.7375 10.0826 8.81804 9.45873 9.82417 9.80597L11.1115 10.2503C11.3469 9.92946 11.5483 9.5824 11.7104 9.21441L10.6815 8.32135C9.87766 7.62363 9.87766 6.37588 10.6815 5.67816L11.7102 4.78524C11.5481 4.41723 11.3467 4.07015 11.1112 3.74935L9.82417 4.19354C8.81804 4.54078 7.73751 3.91693 7.53516 2.87198L7.27579 1.53249C6.88357 1.48987 6.47262 1.48956 6.08023 1.5316ZM5.29749 0.135421C5.74313 0.0465128 6.20347 0 6.67392 0C7.14766 0 7.61114 0.0471646 8.05968 0.137289C8.35793 0.197214 8.59043 0.431356 8.64826 0.730014L9.00781 2.58682C9.03671 2.73609 9.19107 2.82522 9.33481 2.77561L11.1194 2.15971C11.4068 2.06053 11.7256 2.14465 11.9266 2.3727C12.5351 3.06285 13.0101 3.87455 13.3104 4.76741C13.4073 5.05553 13.3207 5.37364 13.0911 5.57289L11.6647 6.81096C11.5499 6.91063 11.5499 7.08888 11.6647 7.18855L13.0912 8.42673C13.3208 8.62597 13.4074 8.94406 13.3105 9.23216C13.0103 10.125 12.5354 10.9367 11.927 11.6269C11.726 11.855 11.4071 11.9391 11.1197 11.8399L9.33481 11.2239C9.19108 11.1743 9.03671 11.2634 9.00781 11.4127L8.64816 13.27C8.59033 13.5687 8.35782 13.8028 8.05957 13.8627C7.61106 13.9528 7.14762 14 6.67392 14C6.20351 14 5.74321 13.9535 5.2976 13.8646C4.9989 13.805 4.7659 13.5707 4.708 13.2717L4.34804 11.4127C4.31913 11.2634 4.16477 11.1743 4.02103 11.2239L2.23 11.842C1.94271 11.9412 1.62399 11.8572 1.42292 11.6293C0.814931 10.9401 0.340033 10.1297 0.0393625 9.23819C-0.0578547 8.94993 0.0286745 8.63151 0.258409 8.43211L1.6911 7.18856C1.80593 7.08888 1.80593 6.91063 1.6911 6.81096L0.258536 5.56752C0.0287886 5.3681 -0.057736 5.04965 0.0395054 4.76139C0.340244 3.86988 0.815219 3.05944 1.42329 2.37033C1.62436 2.14246 1.94306 2.05845 2.23033 2.1576L4.02104 2.77561C4.16477 2.82522 4.31913 2.73609 4.34804 2.58681L4.7079 0.728347C4.76581 0.429324 4.9988 0.195012 5.29749 0.135421ZM11.6144 12.6339C11.4228 12.5678 11.2082 12.6223 11.0858 12.7838C10.8617 13.0793 10.6734 13.4034 10.5271 13.7495C10.4482 13.9362 10.5083 14.1495 10.6614 14.2824L11.6684 15.1565C11.8772 15.3378 11.8772 15.6618 11.6684 15.8431L10.6612 16.7173C10.5082 16.8502 10.448 17.0635 10.5269 17.2502C10.6732 17.5963 10.8615 17.9203 11.0855 18.2158C11.2079 18.3773 11.4226 18.4319 11.6142 18.3658L12.8738 17.931C13.1352 17.8408 13.4158 18.0028 13.4684 18.2742L13.7218 19.583C13.7604 19.7822 13.9153 19.941 14.1167 19.9658C14.2992 19.9884 14.4852 20 14.6738 20C14.8625 20 15.0484 19.9884 15.231 19.9658C15.4324 19.941 15.5873 19.7822 15.6259 19.583L15.8793 18.2742C15.9318 18.0028 16.2125 17.8408 16.4738 17.931L17.7335 18.3658C17.9251 18.4319 18.1397 18.3773 18.2622 18.2158C18.4861 17.9203 18.6745 17.5963 18.8207 17.2502C18.8996 17.0635 18.8395 16.8502 18.6864 16.7174L17.6792 15.8431C17.4705 15.6618 17.4705 15.3378 17.6792 15.1565L18.6863 14.2824C18.8394 14.1495 18.8995 13.9362 18.8206 13.7495C18.6743 13.4033 18.4859 13.0793 18.2619 12.7838C18.1395 12.6223 17.9248 12.5678 17.7333 12.6339L16.4738 13.0686C16.2125 13.1588 15.9318 12.9968 15.8793 12.7254L15.6259 11.417C15.5874 11.2178 15.4325 11.059 15.2311 11.0342C15.0485 11.0116 14.8625 11 14.6738 11C14.4852 11 14.2992 11.0116 14.1166 11.0342C13.9152 11.059 13.7603 11.2178 13.7217 11.417L13.4684 12.7254C13.4158 12.9968 13.1352 13.1588 12.8738 13.0686L11.6144 12.6339ZM14.6736 16.7506C13.983 16.7506 13.4231 16.1907 13.4231 15.5C13.4231 14.8094 13.983 14.2495 14.6736 14.2495C15.3643 14.2495 15.9242 14.8094 15.9242 15.5C15.9242 16.1907 15.3643 16.7506 14.6736 16.7506ZM5.67386 6.99993C5.67386 6.44771 6.12155 6 6.67386 6C7.22617 6 7.67386 6.44771 7.67386 6.99993C7.67386 7.55215 7.22617 7.99986 6.67386 7.99986C6.12155 7.99986 5.67386 7.55215 5.67386 6.99993ZM6.67386 4.5C5.29318 4.5 4.17386 5.61923 4.17386 6.99993C4.17386 8.38063 5.29318 9.49986 6.67386 9.49986C8.05454 9.49986 9.17386 8.38063 9.17386 6.99993C9.17386 5.61923 8.05454 4.5 6.67386 4.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ProfileRailSvg() {
  return (
    <svg width="15" height="17" viewBox="0 0 14 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M7 0C4.79086 0 3 1.79086 3 4C3 6.20914 4.79086 8 7 8C9.20914 8 11 6.20914 11 4C11 1.79086 9.20914 0 7 0ZM4 4C4 2.34315 5.34315 1 7 1C8.65685 1 10 2.34315 10 4C10 5.65685 8.65685 7 7 7C5.34315 7 4 5.65685 4 4ZM2.00873 9C0.903151 9 0 9.88687 0 11C0 12.6912 0.83281 13.9663 2.13499 14.7966C3.41697 15.614 5.14526 16 7 16C8.85474 16 10.583 15.614 11.865 14.7966C13.1672 13.9663 14 12.6912 14 11C14 9.89557 13.1045 9.00001 12 9.00001L2.00873 9ZM1 11C1 10.4467 1.44786 10 2.00873 10L12 10C12.5522 10 13 10.4478 13 11C13 12.3088 12.3777 13.2837 11.3274 13.9534C10.2568 14.636 8.73511 15 7 15C5.26489 15 3.74318 14.636 2.67262 13.9534C1.62226 13.2837 1 12.3088 1 11Z"
        fill="currentColor"
      />
    </svg>
  );
}

/* Create: a picture frame with a plus (new post / reel / story). */
export function CreateRailSvg({ size = 20 }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M10.5 2.75H5C3.75736 2.75 2.75 3.75736 2.75 5V15C2.75 16.2426 3.75736 17.25 5 17.25H15C16.2426 17.25 17.25 16.2426 17.25 15V9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.9 13.6L6.4 10.4C6.95 9.9 7.8 9.9 8.35 10.42L11.75 13.6M10.6 12.5L12.05 11.15C12.6 10.64 13.45 10.64 14 11.15L17.1 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 1.75V7.25M12.75 4.5H18.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CategoriesRailSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="2" width="6.5" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11.5" y="2" width="6.5" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="11.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11.5" y="11.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function OrdersRailSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M5 2L6.5 3L8.25 2L10 3L11.75 2L13.5 3L15 2V18L13.5 17L11.75 18L10 17L8.25 18L6.5 17L5 18V2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.5 7H12.5M7.5 10H12.5M7.5 13H10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function LogoutSvg({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M9 3H4.5C3.67157 3 3 3.67157 3 4.5V15.5C3 16.3284 3.67157 17 4.5 17H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 6L16 10L12 14M7 10H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A bank: pediment roof, four columns, a base. */
export function PaymentConfigRailSvg() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon="bank"
    >
      <path d="M2.75 7.25L10 2.75L17.25 7.25H2.75Z" />
      <path d="M4.75 9.75V14.25M8.25 9.75V14.25M11.75 9.75V14.25M15.25 9.75V14.25" />
      <path d="M3.25 14.25H16.75M2.25 17.25H17.75" />
      <circle cx="10" cy="5.4" r="0.6" fill="currentColor" strokeWidth="0.8" />
    </svg>
  );
}

export function MembersRailSvg() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="17" viewBox="0 0 20 17" fill="none" aria-hidden="true">
      <path
        d="M3.5 4C3.5 2.61929 4.61929 1.5 6 1.5C7.38071 1.5 8.5 2.61929 8.5 4C8.5 5.38071 7.38071 6.5 6 6.5C4.61929 6.5 3.5 5.38071 3.5 4ZM6 0C3.79086 0 2 1.79086 2 4C2 6.20914 3.79086 8 6 8C8.20914 8 10 6.20914 10 4C10 1.79086 8.20914 0 6 0ZM13.5 5C13.5 4.17157 14.1716 3.5 15 3.5C15.8284 3.5 16.5 4.17157 16.5 5C16.5 5.82843 15.8284 6.5 15 6.5C14.1716 6.5 13.5 5.82843 13.5 5ZM15 2C13.3431 2 12 3.34315 12 5C12 6.65685 13.3431 8 15 8C16.6569 8 18 6.65685 18 5C18 3.34315 16.6569 2 15 2ZM12.2484 15.0377C12.9507 15.3232 13.8517 15.5 15.001 15.5C17.2833 15.5 18.5867 14.8027 19.2979 13.9421C19.643 13.5244 19.8186 13.1027 19.9077 12.7795C19.9521 12.6181 19.9754 12.48 19.9875 12.377C19.9936 12.3254 19.997 12.2821 19.9988 12.2487C19.9997 12.232 20.0003 12.2177 20.0006 12.2059L20.0009 12.1903L20.001 12.1839L20.001 12.1811L20.001 12.1786C20.001 10.9754 19.0256 10 17.8224 10H12.1796C12.1521 10 12.1248 10.0005 12.0977 10.0015C12.4916 10.4126 12.7787 10.927 12.914 11.5H17.8224C18.194 11.5 18.4958 11.7986 18.5009 12.1689C18.5006 12.1746 18.4997 12.1855 18.4979 12.2011C18.4934 12.2387 18.4835 12.3015 18.4615 12.3812C18.4177 12.5402 18.3277 12.7613 18.1416 12.9865C17.7903 13.4116 16.9687 14 15.001 14C14.0209 14 13.3252 13.854 12.8302 13.655C12.7231 14.0551 12.5452 14.5378 12.2484 15.0377ZM2.25 10C1.00736 10 0 11.0074 0 12.25V12.5011L3.15905e-06 12.5022L1.38879e-05 12.5048L6.634e-05 12.5111L0.000351369 12.5277C0.000642955 12.5406 0.00116694 12.5571 0.00209707 12.5771C0.00395602 12.6169 0.00744516 12.6705 0.013976 12.7358C0.0270116 12.8661 0.0523263 13.045 0.10165 13.2564C0.199948 13.6776 0.396544 14.2404 0.791826 14.8051C1.61066 15.9749 3.17178 17 6 17C8.82822 17 10.3893 15.9749 11.2082 14.8051C11.6035 14.2404 11.8001 13.6776 11.8983 13.2564C11.9477 13.045 11.973 12.8661 11.986 12.7358C11.9926 12.6705 11.996 12.6169 11.9979 12.5771C11.9988 12.5571 11.9994 12.5406 11.9996 12.5277L11.9999 12.5111L12 12.5048L12 12.5022L12 12.25C12 11.0074 10.9926 10 9.75 10H2.25ZM1.50047 12.5072L1.5 12.4947V12.25C1.5 11.8358 1.83579 11.5 2.25 11.5H9.75C10.1642 11.5 10.5 11.8358 10.5 12.25V12.4946L10.4995 12.5072C10.4988 12.5222 10.4972 12.5493 10.4935 12.5865C10.486 12.6612 10.4703 12.7753 10.4376 12.9155C10.3718 13.1974 10.2403 13.5721 9.97933 13.9449C9.48566 14.6501 8.42178 15.5 6 15.5C3.57822 15.5 2.51434 14.6501 2.02067 13.9449C1.75971 13.5721 1.62818 13.1974 1.56241 12.9155C1.5297 12.7753 1.514 12.6612 1.50653 12.5865C1.50281 12.5493 1.50117 12.5222 1.50047 12.5072Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface RailItem {
  key: CrmView;
  label: string;
  icon?: string;
  svg?: ReactNode;
}

const ITEMS: RailItem[] = [
  { key: 'chats', svg: <ChatsRailSvg />, label: 'Chats' },
  { key: 'templates', svg: <TemplatesRailSvg />, label: 'Templates' },
  { key: 'campaigns', svg: <CampaignsRailSvg />, label: 'Campaigns' },
  { key: 'flows', svg: <AutomationRailSvg />, label: 'Automation' },
  { key: 'catalog', svg: <CatalogRailSvg />, label: 'Catalog' },
  { key: 'categories', svg: <CategoriesRailSvg />, label: 'Categories' },
  { key: 'members', svg: <MembersRailSvg />, label: 'Members' },
  { key: 'offers', svg: <OffersRailSvg />, label: 'Offers' },
  { key: 'orders', svg: <OrdersRailSvg />, label: 'Orders & bookings' },
  { key: 'ads', svg: <AdsRailSvg />, label: 'Ads' },
  { key: 'create', svg: <CreateRailSvg />, label: 'Create' },
  { key: 'payment-config', svg: <PaymentConfigRailSvg />, label: 'Payment Configuration' },
];

// Sidebar sections, in order. A section with no item for this business type is left out.
const GROUPS: { label?: string; keys: CrmView[] }[] = [
  { keys: ['chats'] },
  { label: 'Messaging', keys: ['templates', 'campaigns', 'flows'] },
  { label: 'Commerce', keys: ['catalog', 'categories', 'offers', 'orders', 'payment-config'] },
  { label: 'Team', keys: ['members'] },
  { label: 'Marketing', keys: ['ads', 'create'] },
];

const EXTRA_TITLES: Partial<Record<CrmView, string>> = {
  'channel-status': 'Channels',
  profile: 'Business profile',
  settings: 'Business profile',
};

/** The page's name, as the sidebar and the top bar show it. */
export function viewLabel(view: CrmView, labels?: Partial<Record<CrmView, string>>): string {
  return labels?.[view] || ITEMS.find((it) => it.key === view)?.label || EXTRA_TITLES[view] || '';
}

function CollapseSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 4V16" />
      <path d="M16.5 10H7.5M11 6.5L7.5 10L11 13.5" />
    </svg>
  );
}

interface SidebarProps extends Props {
  /** Icons only (wide screens). */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Picks the logo that reads on the background. */
  theme?: 'light' | 'dark';
  /** The logo goes back to Chats. */
  onHome?: () => void;
  /** Pinned under the menu (the daily messaging limit). */
  footer?: ReactNode;
  /** An event's logos (admin panel → Events), for the light and dark theme. */
  logoLight?: string;
  logoDark?: string;
}

export function NavRail({
  view, onChange, allowed, labels, badges, soon, locked: planLocked, collapsed = false, onToggleCollapsed, theme = 'light', onHome, footer, forms = [], logoLight, logoDark,
  flowsFed = [], limitBypass = false, extraLocks = {},
}: SidebarProps) {
  const { data: limitData } = useMessagingLimit();
  const dayLimit = limitBypass ? null : flowsLockLimit(limitData);
  const fed = new Set<CrmView>([...flowsFed, ...forms.map((f) => f.key)]);
  const limitWhy = dayLimit === null ? '' : `Opens when your WhatsApp number can message ${FLOWS_MIN_LIMIT.toLocaleString('en-IN')} customers a day (now ${dayLimit.toLocaleString('en-IN')}). It fills from WhatsApp Flows.`;
  // Form pages come from the business's forms, not from its type's page list.
  const shown = (key: CrmView) => isFormView(key) || !allowed || allowed.includes(key);
  const byKey = new Map<CrmView, RailItem>([...ITEMS, ...forms].map((it) => [it.key, it]));
  // The Forms section sits under Messaging, next to Automation where the forms are built.
  const groups = forms.length
    ? [...GROUPS.slice(0, 2), { label: 'Forms', keys: forms.map((f) => f.key) as CrmView[] }, ...GROUPS.slice(2)]
    : GROUPS;
  return (
    <nav className={`nav-rail crm-sidebar${collapsed ? ' collapsed' : ''}`} aria-label="CRM sections">
      <div className="crm-side-brand">
        <button type="button" className="crm-side-logo" onClick={onHome} title="Kapso CRM - Home">
          <img src={theme === 'dark' ? logoDark || '/logo1.png' : logoLight || '/logo.png'} alt="Kapso Solutions" className="crm-side-logo-full" data-testid="crm-logo" />
          <span className="crm-side-logo-mark" aria-hidden="true">K</span>
        </button>
        {onToggleCollapsed && (
          <button
            type="button"
            className="crm-side-collapse"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
            title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
          >
            <CollapseSvg />
          </button>
        )}
      </div>
      <div className="nav-rail-top crm-side-menu">
        {groups.map((g) => {
          const items = g.keys.filter(shown).map((k) => byKey.get(k)!).filter(Boolean);
          if (!items.length) return null;
          return (
            <div className="crm-side-group" key={g.label || 'main'}>
              {g.label && <div className="crm-side-label">{g.label}</div>}
              {items.map((it) => {
                const label = labels?.[it.key] || it.label;
                const count = badges?.[it.key] || 0;
                const isSoon = !!soon?.[it.key];
                // A plan lock shows even on a "Soon" item (Ads, Create): the crown.
                const needs = planLocked?.[it.key];
                // The plan's crown comes first: buying the plan is the next step.
                const why = needs || isSoon ? '' : extraLocks[it.key] || (fed.has(it.key) ? limitWhy : '');
                const limitLocked = !!why;
                const locked = isSoon || !!needs || limitLocked;
                return (
                  <button
                    key={it.key}
                    type="button"
                    className={`rail-btn crm-side-item${view === it.key ? ' active' : ''}${locked ? ' soon' : ''}${limitLocked ? ' limit-locked' : ''}`}
                    onClick={() => onChange(it.key)}
                    title={needs ? `${label} · ${needs} plan` : limitLocked ? `${label} · ${why}` : label}
                    aria-label={isSoon ? `${label}, coming soon${needs ? `, needs the ${needs} plan` : ''}` : needs ? `${label}, needs the ${needs} plan` : limitLocked ? `${label}, locked. ${why}` : count > 0 ? `${label}, ${count} unread` : label}
                    aria-current={view === it.key ? 'page' : undefined}
                    data-soon={isSoon ? 'true' : undefined}
                    data-plan-locked={needs || undefined}
                    data-limit-locked={limitLocked ? 'true' : undefined}
                    data-view={it.key}
                  >
                    <span className="crm-side-icon">
                      {it.svg ? it.svg : <span className="material-icons">{it.icon}</span>}
                      {locked && (
                        <span className={`rail-soon${needs ? ' crown' : ''}`} aria-hidden="true">
                          {needs ? <CrownIcon size={11} /> : <LockRailSvg size={10} />}
                        </span>
                      )}
                    </span>
                    <span className="crm-side-text">{label}</span>
                    {isSoon && <span className="crm-side-pill soon" aria-hidden="true">Soon</span>}
                    {needs && (
                      <span className="crm-side-crown" aria-hidden="true" data-testid="rail-crown"><CrownIcon size={15} /></span>
                    )}
                    {limitLocked && (
                      <span className="crm-side-lock" aria-hidden="true" data-testid="rail-lock"><LockRailSvg size={15} /></span>
                    )}
                    {count > 0 && (
                      <span className="rail-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {footer && <div className="crm-side-foot">{footer}</div>}
    </nav>
  );
}