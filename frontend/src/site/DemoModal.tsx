// "Book a demo" popup on the landing page.
//   1. Details: name, business name, business email, WhatsApp number, category
//   2. Pick a date on the calendar and a time slot, then Book demo
//   3. Confirmation
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dropdown } from '../crm/components/Dropdown';
import { VERTICAL_OPTIONS } from '../crm/verticals';
import { PhoneField, phoneProblem, fullPhone } from './PhoneField';
import { siteApi, FormError, type DemoCalendar, type DemoSlot } from './siteApi';
import { pixelTrack } from './metaPixel';
import './demo.css';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** '16:30' → '4:30 PM' */
function slotLabel(slot: string) {
  const [h, m] = slot.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}
const longDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function Text({
  label, value, onChange, error, type = 'text', autoComplete, inputRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  autoComplete?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const id = useId();
  return (
    <div className={`au-field${error ? ' bad' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        ref={inputRef}
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
      />
      {error && <small id={`${id}-err`} className="au-err">{error}</small>}
    </div>
  );
}

// ------------------------------------------------------------ calendar --

function Calendar({
  cal, value, onPick,
}: {
  cal: DemoCalendar;
  value: string;
  onPick: (date: string) => void;
}) {
  const start = new Date(`${cal.from}T00:00:00`);
  const [month, setMonth] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const first = new Date(month.y, month.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first grid
  const days = new Date(month.y, month.m + 1, 0).getDate();
  const canPrev = iso(month.y, month.m, 1) > cal.from.slice(0, 8) + '01';
  const canNext = iso(month.y, month.m, days) < cal.to;
  const shift = (n: number) => {
    const d = new Date(month.y, month.m + n, 1);
    setMonth({ y: d.getFullYear(), m: d.getMonth() });
  };
  const title = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="dm-cal">
      <div className="dm-cal-head">
        <button type="button" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Previous month">
          <span className="material-icons">chevron_left</span>
        </button>
        <strong aria-live="polite">{title}</strong>
        <button type="button" onClick={() => shift(1)} disabled={!canNext} aria-label="Next month">
          <span className="material-icons">chevron_right</span>
        </button>
      </div>
      <div className="dm-cal-grid" role="grid" aria-label={title}>
        {WEEKDAYS.map((w) => <span key={w} className="dm-cal-wd" role="columnheader">{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = iso(month.y, month.m, i + 1);
          const dow = new Date(month.y, month.m, i + 1).getDay();
          const open = d >= cal.from && d <= cal.to && !cal.closedDays.includes(dow);
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              className={`dm-day${d === value ? ' on' : ''}${d === cal.from ? ' today' : ''}`}
              disabled={!open}
              aria-selected={d === value}
              aria-label={longDate(d)}
              onClick={() => onPick(d)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- modal --

interface Details {
  name: string;
  businessName: string;
  email: string;
  category: string;
}

export function DemoModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [d, setD] = useState<Details>({ name: '', businessName: '', email: '', category: '' });
  const [phone, setPhone] = useState({ iso: 'IN', number: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [cal, setCal] = useState<DemoCalendar | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<DemoSlot[] | null>(null);
  const [closed, setClosed] = useState('');
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState<{ date: string; slot: string; rescheduled: boolean } | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const set = (k: keyof Details) => (v: string) => {
    setD((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
    setError('');
  };

  // Esc closes; keep focus inside on open; pause Lenis and lock background body scroll
  useEffect(() => {
    firstInput.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);

    // Pause Lenis smooth scroll and lock background body while DemoModal is open
    const lenis = (window as unknown as { __lenis?: { stop: () => void; start: () => void } }).__lenis;
    lenis?.stop();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      lenis?.start();
    };
  }, [onClose]);

  useEffect(() => {
    siteApi.demoCalendar().then(setCal).catch(() => setError('Could not load the calendar. Please try again.'));
  }, []);

  // Slots of the picked date.
  useEffect(() => {
    if (!date) return;
    let live = true;
    setSlots(null);
    setSlot('');
    siteApi
      .demoSlots(date)
      .then((r) => {
        if (!live) return;
        setSlots(r.slots || []);
        setClosed(r.closed || '');
      })
      .catch(() => live && setSlots([]));
    return () => {
      live = false;
    };
  }, [date]);

  function next(e: React.FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!d.name.trim()) found.name = 'Enter your name';
    if (!d.businessName.trim()) found.businessName = 'Enter your business name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())) found.email = 'Enter a valid business email';
    const pp = phoneProblem(phone.iso, phone.number);
    if (pp) found.phone = pp;
    if (!d.category) found.category = 'Choose your business category';
    setErrors(found);
    if (Object.keys(found).length) {
      setError('Please fix the highlighted fields.');
      return;
    }
    setError('');
    setStep(2);
  }

  async function book() {
    if (!date || !slot) return;
    setBusy(true);
    setError('');
    try {
      const r = await siteApi.bookDemo({
        name: d.name.trim(),
        businessName: d.businessName.trim(),
        email: d.email.trim(),
        phone: fullPhone(phone.iso, phone.number),
        category: d.category,
        date,
        slot,
      });
      setBooked({ date: r.data.date, slot: r.data.slot, rescheduled: r.rescheduled });
      setStep(3);
      // A demo booked from the website: a lead for the Meta ads (not sent from inside the CRM).
      if (!r.rescheduled) pixelTrack('Lead', { content_name: 'Demo booked' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not book the demo.';
      setError(msg);
      // Someone else took it: refresh the times.
      if (e instanceof FormError && e.fields.slot) siteApi.demoSlots(date).then((r) => setSlots(r.slots || []));
      if (e instanceof FormError && Object.keys(e.fields).some((k) => k !== 'slot' && k !== 'date')) {
        setErrors(e.fields);
        setStep(1);
      }
    } finally {
      setBusy(false);
    }
  }

  const open = useMemo(() => (slots || []).filter((s) => s.left > 0), [slots]);

  return (
    <div
      className="dm-overlay"
      data-lenis-prevent
      data-lenis-prevent-wheel
      data-lenis-prevent-touch
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`dm-box step${step}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-lenis-prevent
        data-lenis-prevent-wheel
        data-lenis-prevent-touch
      >
        <div className="dm-head">
          <div className="dm-head-brand">
            <img src="/image.png" alt="" />
            <h2 id={titleId}>
              {step === 1 ? 'Book your free demo' : step === 2 ? 'Pick a date and time' : 'Your demo is booked'}
            </h2>
          </div>
          {step === 2 && (
            <button type="button" className="dm-back" onClick={() => setStep(1)}>
              <span className="material-icons">arrow_back</span> Details
            </button>
          )}
          <button type="button" className="dm-close" onClick={onClose} aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </div>

        {error && <div className="au-alert dm-alert" role="alert">{error}</div>}

        {step === 1 && (
          <form className="dm-body" onSubmit={next} noValidate>
            <p className="dm-sub">A 30-minute walkthrough of the WhatsApp CRM, set up around your business.</p>
            <div className="au-two">
              <Text label="Name" value={d.name} onChange={set('name')} error={errors.name} autoComplete="name" inputRef={firstInput} />
              <Text label="Business name" value={d.businessName} onChange={set('businessName')} error={errors.businessName} autoComplete="organization" />
            </div>
            <Text label="Business email" type="email" value={d.email} onChange={set('email')} error={errors.email} autoComplete="email" />
            <PhoneField
              label="WhatsApp number"
              iso={phone.iso}
              number={phone.number}
              error={errors.phone}
              onChange={(i, n) => {
                setPhone({ iso: i, number: n });
                setErrors((e) => ({ ...e, phone: '' }));
                setError('');
              }}
            />
            <div className={`au-field${errors.category ? ' bad' : ''}`}>
              <span className="au-label">Category</span>
              <Dropdown options={VERTICAL_OPTIONS} value={d.category} onChange={set('category')} placeholder="Choose your business category" />
              {errors.category && <small className="au-err">{errors.category}</small>}
            </div>
            <button className="au-submit" type="submit">Next: pick a time</button>
          </form>
        )}

        {step === 2 && (
          <div className="dm-body dm-pick">
            {!cal ? (
              <div className="au-spinner" aria-hidden="true" />
            ) : (
              <>
                <Calendar cal={cal} value={date} onPick={setDate} />
                <div className="dm-side">
                  <dl className="dm-summary">
                    <dt>Day</dt><dd>{date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long' }) : '—'}</dd>
                    <dt>Date</dt><dd>{date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</dd>
                    <dt>Time</dt><dd>{slot ? slotLabel(slot) : '—'}</dd>
                  </dl>
                  <div className="dm-tz">
                    <span className="material-icons">schedule</span>
                    (UTC+05:30) India Standard Time
                  </div>
                  {!date && <p className="dm-hint">Choose a date to see the available times.</p>}
                  {date && !slots && <div className="au-spinner sm" aria-hidden="true" />}
                  {date && slots && (open.length === 0 ? (
                    <p className="dm-hint">{closed || 'No times left on this day — please pick another date.'}</p>
                  ) : (
                    <div className="dm-slots" role="radiogroup" aria-label="Available times">
                      {(slots || []).map((s, i) => (
                        <button
                          key={s.slot}
                          type="button"
                          role="radio"
                          aria-checked={slot === s.slot}
                          disabled={s.left <= 0}
                          className={`dm-slot${slot === s.slot ? ' on' : ''}`}
                          style={{ ['--i' as string]: i }}
                          onClick={() => setSlot(s.slot)}
                        >
                          {slotLabel(s.slot)}
                          {s.left <= 0 && <small>{s.past ? 'Passed' : 'Full'}</small>}
                        </button>
                      ))}
                    </div>
                  ))}
                  <button className="au-submit dm-book" type="button" disabled={!date || !slot || busy} onClick={book}>
                    {busy ? 'Booking…' : 'Book demo'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 3 && booked && (
          <div className="dm-body dm-done">
            <span className="material-icons dm-done-icon">event_available</span>
            <h3>{booked.rescheduled ? 'Your demo has been moved' : 'See you soon, ' + d.name.split(' ')[0] + '!'}</h3>
            <p>
              <strong>{longDate(booked.date)}</strong> at <strong>{slotLabel(booked.slot)}</strong> (India Standard Time).
            </p>
            <p className="dm-sub">
              Our team will contact you on WhatsApp at {fullPhone(phone.iso, phone.number)} with the meeting link.
            </p>
            <button className="au-submit" type="button" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
