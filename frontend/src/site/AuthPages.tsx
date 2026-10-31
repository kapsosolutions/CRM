// Sign-in and sign-up for business owners.
//   #/login            email + password (or Continue with Google)
//   #/register         first/last name, business email, password ×2, phone, category
//   #/register/google  the same form after Google: name + email filled in from
//                      the Google account, the rest still to enter
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Dropdown } from '../crm/components/Dropdown';
import { VERTICAL_OPTIONS } from '../crm/verticals';
import {
  siteApi, googleSignInPopup, redirectToGoogle, inGooglePopup, googleStartRoute, setGoogleError, googleError,
  clearGoogleError, clearGooglePopupMark,
  pendingGoogle, savePendingGoogle, clearPendingGoogle, FormError, type RegisterForm,
} from './siteApi';
import { PhoneField, phoneProblem, fullPhone } from './PhoneField';
import { useSmoothScroll } from './useSmoothScroll';
import './site.css';

const go = (route: string) => {
  window.location.hash = route;
};

/** A labelled input with its own error line. */
export function Field({
  label, value, onChange, type = 'text', error, autoComplete, readOnly, placeholder, inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  error?: string;
  autoComplete?: string;
  readOnly?: boolean;
  placeholder?: string;
  inputMode?: 'tel' | 'email' | 'text';
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className={`au-field${error ? ' bad' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="au-input-wrap">
        <input
          id={id}
          type={isPassword && shown ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          readOnly={readOnly}
          placeholder={placeholder}
          inputMode={inputMode}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
        />
        {isPassword && (
          <button
            type="button"
            className="au-eye"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? 'Hide password' : 'Show password'}
          >
            {shown ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M2 10C3.8 6.8 6.5 5 10 5C13.5 5 16.2 6.8 18 10C16.2 13.2 13.5 15 10 15C6.5 15 3.8 13.2 2 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                <line x1="3" y1="3" x2="17" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M2 10C3.8 6.8 6.5 5 10 5C13.5 5 16.2 6.8 18 10C16.2 13.2 13.5 15 10 15C6.5 15 3.8 13.2 2 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            )}
          </button>
        )}
      </div>
      {error && <small id={`${id}-err`} className="au-err">{error}</small>}
    </div>
  );
}

/**
 * A Supabase access token from Google → signed in, or on to the rest of the
 * sign-up form when this Google account has no business yet.
 */
async function finishGoogle(accessToken: string, onSignedIn: (token: string) => void) {
  const r = await siteApi.google(accessToken);
  if (r.needsProfile && r.profile) {
    savePendingGoogle({ accessToken, profile: r.profile });
    go('#/register/google');
  } else {
    onSignedIn(r.token);
  }
}

function GoogleButton({
  label, onError, onSignedIn,
}: {
  label: string;
  onError: (m: string) => void;
  onSignedIn: (token: string) => void;
}) {
  // idle → waiting (popup open) → finishing (token in, talking to the server).
  // "stalled" = the popup didn't hand a result back (yet): the button is
  // usable again and the full-page fallback is offered. A late result from
  // the popup still signs in.
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'stalled' | 'finishing'>('idle');
  const attempt = useRef(0);

  async function start() {
    const mine = ++attempt.current;
    const current = () => attempt.current === mine;
    setPhase('waiting');
    onError('');
    try {
      // Opens Google in a popup window; this page stays as it is.
      const r = await googleSignInPopup({ onStalled: () => current() && setPhase('stalled') });
      if (!current()) return; // replaced by a newer attempt
      if (!r) {
        setPhase('stalled');
        return;
      }
      setPhase('finishing');
      if (r.error) {
        onError(r.error);
        setPhase('stalled');
      } else if (r.accessToken) {
        await finishGoogle(r.accessToken, onSignedIn);
      }
    } catch (e) {
      if (!current()) return;
      onError(e instanceof Error ? e.message : 'Google sign-in failed');
      setPhase('stalled');
    }
  }

  async function inThisWindow() {
    attempt.current++;
    setPhase('finishing');
    onError('');
    try {
      await redirectToGoogle();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Google sign-in failed');
      setPhase('stalled');
    }
  }

  const busy = phase === 'waiting' || phase === 'finishing';
  return (
    <>
      <button type="button" className="au-google" disabled={busy} onClick={start}>
        <GoogleLogo />
        {phase === 'waiting' ? 'Waiting for Google…' : phase === 'finishing' ? 'Signing you in…' : phase === 'stalled' ? 'Try again with Google' : label}
      </button>
      {phase === 'waiting' && (
        <div className="au-google-help">
          Finish signing in in the Google window.{' '}
          {/* Only resets the button: if the popup still delivers, it signs in. */}
          <button type="button" className="au-linkbtn" onClick={() => setPhase('stalled')}>Cancel</button>
        </div>
      )}
      {phase === 'stalled' && (
        <div className="au-google-help">
          Google window didn’t sign you in?{' '}
          <button type="button" className="au-linkbtn" onClick={inThisWindow}>Sign in with Google in this window</button>
        </div>
      )}
    </>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function AuthCard({
  title,
  subtitle,
  children,
  imageSrc,
  imageAlt,
  imageSide = 'left',
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  imageSrc?: string;
  imageAlt?: string;
  imageSide?: 'left' | 'right';
}) {
  useSmoothScroll();
  return (
    <div className="au-page">
      <main className="au-main">
        <div className={`au-split-card ${imageSide === 'right' ? 'img-right' : 'img-left'}${!imageSrc ? ' single-card' : ''}`}>
          {imageSide === 'left' && imageSrc && (
            <div className="au-card-visual">
              <img src={imageSrc} alt={imageAlt || 'Authentication'} className="au-card-img" />
            </div>
          )}

          <div className="au-card-form">
            <h1>{title}</h1>
            {subtitle && <p className="au-sub">{subtitle}</p>}
            {children}
          </div>

          {imageSide === 'right' && imageSrc && (
            <div className="au-card-visual">
              <img src={imageSrc} alt={imageAlt || 'Authentication'} className="au-card-img" />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/** Shown once, after a sign-out the user didn't ask for (password change etc.). */
export function useSignedOutReason() {
  const [reason] = useState(() => {
    try {
      const r = sessionStorage.getItem('crm_signed_out_reason') || '';
      if (r) sessionStorage.removeItem('crm_signed_out_reason');
      return r;
    } catch {
      return '';
    }
  });
  return reason;
}

/** An error a full-page Google sign-in came back with (Supabase's #error=…). */
function useGoogleError() {
  const [message] = useState(googleError);
  useEffect(() => {
    if (message) clearGoogleError();
  }, [message]);
  return message;
}

// ---------------------------------------------------------------- Login --

export function LoginPage({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const googleProblem = useGoogleError();
  const [error, setError] = useState(googleProblem);
  const signedOut = useSignedOutReason();

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to your WhatsApp CRM workspace"
      imageSrc="/login.png"
      imageAlt="WhatsApp CRM Login"
      imageSide="left"
    >
      {signedOut && <div className="au-alert">{signedOut}</div>}
      {error && <div className="au-alert" role="alert">{error}</div>}
      <GoogleButton label="Continue with Google" onError={setError} onSignedIn={onSignedIn} />
      <div className="au-or"><span>or</span></div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!email.trim() || !password) {
            setError('Enter your email and password.');
            return;
          }
          setBusy(true);
          setError('');
          try {
            const r = await siteApi.login(email.trim(), password);
            onSignedIn(r.token);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Sign-in failed');
          } finally {
            setBusy(false);
          }
        }}
        noValidate
      >
        <Field label="Business email address" value={email} onChange={setEmail} type="email" autoComplete="username" inputMode="email" />
        <Field label="Password" value={password} onChange={setPassword} type="password" autoComplete="current-password" />
        <div className="au-switch-link">
          New here? <a href="#/register">Create an account</a>
        </div>
        <button className="au-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </AuthCard>
  );
}

// ------------------------------------------------------------- Register --

/** "You're signing up as" card for a Google sign-up. */
function GoogleAccountCard({ name, email, avatarUrl }: { name: string; email: string; avatarUrl?: string }) {
  const [imgOk, setImgOk] = useState(!!avatarUrl);
  const initial = (name || email).trim().charAt(0).toUpperCase();
  return (
    <div className="au-gcard">
      {imgOk ? (
        <img className="au-gcard-avatar" src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setImgOk(false)} />
      ) : (
        <span className="au-gcard-avatar" aria-hidden="true">{initial}</span>
      )}
      <div className="au-gcard-text">
        <strong>{name || email}</strong>
        <small>{email}</small>
      </div>
      <span className="material-icons au-gcard-ok" aria-label="Google account verified">check_circle</span>
    </div>
  );
}

const BLANK: RegisterForm = {
  firstName: '', lastName: '', email: '', password: '', confirmPassword: '', phone: '', category: '',
};

/** The same checks the server makes, so mistakes show before a round trip. */
function check(f: RegisterForm, google: boolean, phone: { iso: string; number: string }): Record<string, string> {
  const e: Record<string, string> = {};
  // A Google sign-up's name comes from the Google account, not the form.
  if (!google && !f.firstName.trim()) e.firstName = 'First name is required';
  if (!google && !f.lastName.trim()) e.lastName = 'Last name is required';
  if (!google && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = 'Enter a valid business email address';
  // A Google sign-up has no password: Google is how they sign in.
  if (!google) {
    if (f.password.length < 8) e.password = 'At least 8 characters';
    else if (!/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) e.password = 'Use letters and at least one number';
    if (f.confirmPassword !== f.password) e.confirmPassword = 'Passwords do not match';
  }
  const pp = phoneProblem(phone.iso, phone.number);
  if (pp) e.phone = pp;
  if (!f.category) e.category = 'Choose your business category';
  return e;
}

export function RegisterPage({ google = false, onSignedIn }: { google?: boolean; onSignedIn: (token: string) => void }) {
  const [pending] = useState(() => (google ? pendingGoogle() : null));
  const [form, setForm] = useState<RegisterForm>(() =>
    pending ? { ...BLANK, ...pending.profile } : { ...BLANK },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const googleProblem = useGoogleError();
  const [error, setError] = useState(googleProblem);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState({ iso: 'IN', number: '' });
  const onPhone = (iso: string, number: string) => {
    setPhone({ iso, number });
    setForm((f) => ({ ...f, phone: fullPhone(iso, number) }));
    setErrors((e) => ({ ...e, phone: '' }));
    setError('');
  };
  const set = (k: keyof RegisterForm) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
    // The summary line goes once the user starts fixing things.
    setError('');
  };

  // The Google step lost its token (new tab, expired) — start it again.
  useEffect(() => {
    if (google && !pending) go('#/register');
  }, [google, pending]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = check(form, google, phone);
    setErrors(found);
    if (Object.keys(found).length) {
      setError('Please fix the highlighted fields.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = google && pending
        ? await siteApi.googleComplete(pending.accessToken, {
          firstName: form.firstName, lastName: form.lastName, phone: form.phone, category: form.category,
        })
        : await siteApi.register(form);
      clearPendingGoogle();
      onSignedIn(r.token);
    } catch (err) {
      if (err instanceof FormError && Object.keys(err.fields).length) setErrors(err.fields);
      setError(err instanceof Error ? err.message : 'Sign-up failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={google ? 'Finish creating your account' : 'Create your account'}
      subtitle={google
        ? 'Just your phone number and business category, and you’re in.'
        : 'Start your 7-day free trial. No credit card required.'}
    >
      {error && <div className="au-alert" role="alert">{error}</div>}
      {!google && (
        <>
          <GoogleButton label="Continue with Google" onError={setError} onSignedIn={onSignedIn} />
          <div className="au-or"><span>or</span></div>
        </>
      )}
      <form onSubmit={submit} noValidate>
        {google && pending ? (
          <GoogleAccountCard
            name={`${pending.profile.firstName} ${pending.profile.lastName}`.trim()}
            email={pending.profile.email}
            avatarUrl={pending.profile.avatarUrl}
          />
        ) : (
          <>
            <div className="au-two">
              <Field label="First name" value={form.firstName} onChange={set('firstName')} error={errors.firstName} autoComplete="given-name" />
              <Field label="Last name" value={form.lastName} onChange={set('lastName')} error={errors.lastName} autoComplete="family-name" />
            </div>
            <Field
              label="Business email address"
              value={form.email}
              onChange={set('email')}
              type="email"
              inputMode="email"
              error={errors.email}
              autoComplete="email"
            />
            <div className="au-two">
              <Field label="Password" value={form.password} onChange={set('password')} type="password" error={errors.password} autoComplete="new-password" />
              <Field label="Confirm password" value={form.confirmPassword} onChange={set('confirmPassword')} type="password" error={errors.confirmPassword} autoComplete="new-password" />
            </div>
          </>
        )}
        <PhoneField iso={phone.iso} number={phone.number} onChange={onPhone} error={errors.phone} />
        <div className={`au-field${errors.category ? ' bad' : ''}`}>
          <span className="au-label" id="au-cat-label">Category</span>
          <div aria-labelledby="au-cat-label">
            <Dropdown
              options={VERTICAL_OPTIONS}
              value={form.category}
              onChange={set('category')}
              placeholder="Choose your business category"
            />
          </div>
          {errors.category && <small className="au-err">{errors.category}</small>}
        </div>
        {!google && (
          <div className="au-switch-link">
            Already registered? <a href="#/login">Log in</a>
          </div>
        )}
        <button className="au-submit" type="submit" disabled={busy}>
          {busy ? 'Creating your account…' : google ? 'Finish sign-up' : 'Create account'}
        </button>
        <p className="au-fine">
          After signing up you’ll connect your WhatsApp Business Account from inside the CRM.
        </p>
      </form>
    </AuthCard>
  );
}

// ---------------------------------------------------- Google redirect back --

/** Handles the return from Google: sign in, or continue to the sign-up form. */
export function GoogleReturn({ accessToken, error, onSignedIn }: {
  accessToken?: string;
  error?: string;
  onSignedIn: (token: string) => void;
}) {
  // Landed here inside the sign-in popup (Supabase or ngrok's warning page sent
  // it to the site root instead of /auth-callback.html): hand the result to
  // the page that opened it and close. Decided once, before anything below
  // clears the hash.
  const [inPopup] = useState(inGooglePopup);
  const [handedBack, setHandedBack] = useState(false);
  // StrictMode runs effects twice in dev; sign in only once.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (inPopup) {
      const msg = { type: 'kapso-google-auth', hash: window.location.hash.replace(/^#/, ''), at: Date.now() };
      try { new BroadcastChannel('kapso-auth').postMessage(msg); } catch { /* ignore */ }
      try {
        localStorage.setItem('kapso-google-auth', JSON.stringify(msg));
        localStorage.removeItem('kapso-google-auth');
      } catch { /* ignore */ }
      clearGooglePopupMark();
      window.history.replaceState(null, '', window.location.pathname);
      window.close();
      // Still open (the browser wouldn't let a script close it).
      setTimeout(() => setHandedBack(true), 800);
      return;
    }
    // Drop the tokens from the address bar straight away.
    window.history.replaceState(null, '', window.location.pathname);
    // A problem goes back to the page the user started on, which shows it.
    const back = (message: string) => {
      setGoogleError(message);
      go(googleStartRoute());
    };
    if (error || !accessToken) {
      back(error || 'Google sign-in did not return a result.');
      return;
    }
    finishGoogle(accessToken, onSignedIn)
      .catch((e) => back(e instanceof Error ? e.message : 'Google sign-in failed'));
  }, [accessToken, error, onSignedIn, inPopup]);

  if (inPopup && handedBack) {
    return (
      <AuthCard title="You can close this window" subtitle="Your Google sign-in was sent back to the WhatsApp CRM tab.">
        <button className="au-submit" type="button" onClick={() => window.close()}>Close window</button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Signing you in…" subtitle="One moment.">
      <div className="au-spinner" aria-hidden="true" />
    </AuthCard>
  );
}
