// Plan reminders, in the notification bell (the top bar shows the same from
// REMIND_DAYS before the end, services/plans.js):
//   - "Your free trial ends in 3 days" / "Your Pro plan ends on …", once per end date
//   - "Your free trial has ended" / "Your Pro plan has ended", once, within 3 days of the end
// Businesses from before plans existed (kept on Premium, no end date) are never touched.
import Business from '../models/Business.js';
import logger from './logger.js';
import { notify } from './notifications.js';
import { planState } from './plans.js';

const TICK_MS = 60 * 60 * 1000; // hourly
const ENDED_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
let timer = null;

const dateText = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** One pass over every business. Returns how many notifications were sent. */
export async function sendPlanReminders(now = new Date()) {
  const rows = await Business.find({ active: true })
    .select('createdAt trialEndsAt subscription planNotices name')
    .lean();
  let sent = 0;
  for (const biz of rows) {
    const s = planState(biz, now);
    const notices = biz.planNotices || {};
    try {
      if ((s.status === 'trial' || s.status === 'active') && s.endingSoon && notices.endingFor !== s.endsAt) {
        const days = s.daysLeft <= 1 ? 'today' : `in ${s.daysLeft} days`;
        // eslint-disable-next-line no-await-in-loop
        await notify(biz._id, {
          type: 'plan_ending',
          title: s.status === 'trial' ? `Your free trial ends ${days}` : `Your ${s.name} plan ends ${days}`,
          body: s.status === 'trial'
            ? `It ends on ${dateText(s.endsAt)}. Choose a plan to keep using the CRM.`
            : `Renew before ${dateText(s.endsAt)} to keep ${s.name}.`,
          target: { view: 'profile', id: 'billing' },
        });
        // eslint-disable-next-line no-await-in-loop
        await Business.updateOne({ _id: biz._id }, { $set: { planNotices: { ...notices, endingFor: s.endsAt } } });
        sent += 1;
      } else if (s.status === 'free' && s.ended?.at && notices.endedFor !== s.ended.at
        && now.getTime() - new Date(s.ended.at).getTime() < ENDED_WINDOW_MS) {
        // eslint-disable-next-line no-await-in-loop
        await notify(biz._id, {
          type: 'plan_ended',
          title: s.ended.kind === 'trial' ? 'Your free trial has ended' : `Your ${s.ended.name} plan has ended`,
          body: 'Choose a plan to keep using the CRM. Your chats, contacts and templates are kept.',
          target: { view: 'profile', id: 'billing' },
        });
        // eslint-disable-next-line no-await-in-loop
        await Business.updateOne({ _id: biz._id }, { $set: { planNotices: { ...notices, endedFor: s.ended.at } } });
        sent += 1;
      }
    } catch (err) {
      logger.warn('plan reminder failed', { business: biz.name, error: err.message });
    }
  }
  return sent;
}

export function startPlanReminders() {
  if (timer) return;
  const tick = () => sendPlanReminders().catch((err) => logger.warn('plan reminders pass failed', { error: err.message }));
  setTimeout(tick, 30000);
  timer = setInterval(tick, TICK_MS);
}

export default { sendPlanReminders, startPlanReminders };
