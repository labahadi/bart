'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/ui';

// Penn addresses, including school subdomains like wharton.upenn.edu
const isPennEmail = (e: string) => /^[^@\s]+@([a-z0-9-]+\.)*upenn\.edu$/i.test(e.trim());

const RULES = [
  ['No exams, answer keys or graded work', "Tutoring is fine. Doing someone's homework isn't."],
  ['No drugs, alcohol, weapons or adult content', 'These listings get removed and accounts suspended.'],
  ['Meet at Safe Spots', 'Public, staffed places on campus, during the day.'],
  ['Show up, or cancel early', 'Two no-shows means a short break from trading.'],
];

export default function SignUp() {
  const { session, me, refresh } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [code, setCode] = useState('');
  const [first, setFirst] = useState('');
  const [lastInitial, setLastInitial] = useState('');
  const [agreed, setAgreed] = useState([false, false, false, false]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Already signed in: finish the house rules, or go to the feed
  useEffect(() => {
    if (session && me?.rules_accepted_at) router.replace('/');
    else if (session && me) setStep(3);
  }, [session, me, router]);

  const emailBad = touched && email.length > 0 && !isPennEmail(email);

  async function sendCode() {
    setTouched(true);
    if (!isPennEmail(email)) return;
    setBusy(true); setError('');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase() });
    setBusy(false);
    if (error) setError(friendlyError(error)); else setStep(2);
  }

  async function verify() {
    setBusy(true); setError('');
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: 'email' });
    setBusy(false);
    if (error) setError(friendlyError(error));
    // On success, the effect above moves us to step 3 once the profile loads
  }

  async function finish() {
    setBusy(true); setError('');
    const { error } = await supabase.rpc('complete_signup', { p_first_name: first, p_last_initial: lastInitial });
    if (error) { setBusy(false); setError(friendlyError(error)); return; }
    await refresh();
    router.replace('/');
  }

  const allAgreed = agreed.every(Boolean);
  const nameOk = first.trim().length >= 1 && /^[a-z]$/i.test(lastInitial.trim());

  return (
    <main style={{ padding: '40px 24px 40px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100dvh' }}>
      <div className="spread">
        <Logo height={34} />
        <div className="row" style={{ gap: 6 }}>
          {[1, 2, 3].map((n) => (
            <span key={n} style={{
              height: 8, width: n === step ? 22 : 8, borderRadius: 999,
              background: n === step ? 'var(--pink)' : n < step ? 'var(--blue)' : 'var(--dot-off)',
            }} />
          ))}
        </div>
      </div>

      {step === 1 && (
        <>
          <h1 className="display" style={{ fontSize: 34, lineHeight: 1.05, marginTop: 24 }}>
            Trade with people on <span style={{ color: 'var(--pink)' }}>your</span> campus.
          </h1>
          <p className="body" style={{ fontSize: 15 }}>Only verified students can join. Start with your school email.</p>
          <div>
            <label className="label" htmlFor="email" style={{ display: 'block' }}>School email</label>
            <input id="email" className={`input ${emailBad ? 'invalid' : ''}`} style={{ height: 52 }}
              type="email" inputMode="email" autoComplete="email" placeholder="you@upenn.edu"
              value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched(true)}
              onKeyDown={(e) => e.key === 'Enter' && sendCode()} />
            {emailBad && <p className="error-text">Use your upenn.edu email so we know you&apos;re a student.</p>}
          </div>
          <button className="btn" style={{ height: 54 }} disabled={busy || !email} onClick={sendCode}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
          <div className="card stack" style={{ gap: 8 }}>
            {['Your name stays hidden on the feed', 'We never show your email or phone', 'Account ends when you graduate']
              .map((t) => (
                <div key={t} className="row" style={{ gap: 8, fontSize: 13 }}>
                  <span style={{ color: 'var(--blue)', fontWeight: 700 }}>✓</span>{t}
                </div>
              ))}
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="display" style={{ fontSize: 30, lineHeight: 1.05, marginTop: 24 }}>Check your inbox</h1>
          <p className="body" style={{ fontSize: 15 }}>We sent a code to <b>{email}</b></p>
          <div>
            <label className="label" htmlFor="code" style={{ display: 'block' }}>Code</label>
            <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="000000"
              maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => e.key === 'Enter' && code.length >= 6 && verify()}
              style={{ height: 60, fontFamily: 'var(--display)', fontSize: 28, letterSpacing: 10, textAlign: 'center' }} />
          </div>
          <button className="btn" disabled={code.length < 6 || busy} onClick={verify}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
          <p className="meta" style={{ textAlign: 'center' }}>
            Can&apos;t find it? Check your spam or quarantine folder.
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 4 }}>
            <button className="text-btn" onClick={() => { setStep(1); setCode(''); setError(''); }}>Use a different email</button>
            <button className="text-btn" onClick={sendCode} disabled={busy}>Send a new code</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="row" style={{ marginTop: 16 }}>
            <span style={{ width: 48, height: 48, borderRadius: 999, background: 'var(--lime)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={24} />
            </span>
            <div>
              <div className="display" style={{ fontSize: 22 }}>You&apos;re verified</div>
              <div className="meta" style={{ fontSize: 13 }}>One last thing: your name and the house rules</div>
            </div>
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="grow">
              <label className="label" htmlFor="first" style={{ display: 'block' }}>First name</label>
              <input id="first" className="input" autoComplete="given-name" maxLength={40}
                value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div style={{ width: 96 }}>
              <label className="label" htmlFor="last" style={{ display: 'block' }}>Last initial</label>
              <input id="last" className="input" maxLength={1} style={{ textAlign: 'center' }}
                value={lastInitial} onChange={(e) => setLastInitial(e.target.value.replace(/[^a-z]/gi, '').toUpperCase())} />
            </div>
          </div>
          <p className="meta" style={{ marginTop: -8 }}>People you trade with see &quot;{first || 'Jordan'} {lastInitial || 'L'}.&quot; Never on the feed.</p>
          <div className="stack" style={{ gap: 10 }}>
            {RULES.map(([title, sub], i) => (
              <button key={title} className={`check-row ${agreed[i] ? 'on' : ''}`}
                onClick={() => setAgreed(agreed.map((v, j) => (j === i ? !v : v)))} aria-pressed={agreed[i]}>
                <span className="box">{agreed[i] && <Icon name="check" size={14} stroke={3} />}</span>
                <span><div className="row-title">{title}</div><div className="row-sub">{sub}</div></span>
              </button>
            ))}
          </div>
          <button className="btn pink" style={{ height: 54 }} disabled={!allAgreed || !nameOk || busy} onClick={finish}>
            {!allAgreed ? 'Agree to all 4 to continue' : !nameOk ? 'Add your name to continue' : busy ? 'Saving…' : 'Start swapping'}
          </button>
        </>
      )}

      {error && <div className="alert"><Icon name="warning" size={18} />{error}</div>}
    </main>
  );
}
