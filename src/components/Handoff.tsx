'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/trade';

// Finish a trade in person: one person shows a 4-digit code, the other types it in.
export function Handoff({ offerId, otherName, onDone }: { offerId: string; otherName: string; onDone: () => void }) {
  const [mode, setMode] = useState<'choose' | 'show' | 'enter'>('choose');
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(0);

  async function show() {
    setMode('show'); setError('');
    const { data, error } = await supabase.rpc('handoff_code', { p_offer: offerId });
    if (error || !data?.[0]) { setError(friendlyError(error ?? 'Could not make a code')); return; }
    setCode(data[0]);
  }

  // Countdown, and a fresh code when this one runs out
  useEffect(() => {
    if (mode !== 'show' || !code) return;
    const tick = () => {
      const s = Math.max(0, Math.round((new Date(code.expires_at).getTime() - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0) show();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, code]);

  async function enter() {
    setBusy(true); setError('');
    const { data, error } = await supabase.rpc('confirm_handoff', { p_offer: offerId, p_code: typed });
    setBusy(false);
    if (error) { setError(friendlyError(error)); return; }
    if (data === 'completed') onDone();
    else if (data === 'wrong') { setError("Code doesn't match"); setTyped(''); }
    else if (data === 'locked') setError('Too many tries. Ask for a new code.');
    else setError(`Ask ${otherName} to show their code`);
  }

  if (mode === 'choose') {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Finish the trade</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn lime" style={{ height: 46 }} onClick={show}>Show my code</button>
          <button className="btn" style={{ height: 46, background: '#fff', color: 'var(--ink)' }} onClick={() => setMode('enter')}>Enter code</button>
        </div>
      </div>
    );
  }

  if (mode === 'show') {
    return (
      <div className="stack" style={{ gap: 10, alignItems: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--dark-sub)' }}>Show {otherName} this code</div>
        <div style={{ fontFamily: 'var(--display)', fontSize: 56, fontWeight: 700, letterSpacing: 16, color: 'var(--lime)' }}>{code?.code ?? '····'}</div>
        <div style={{ fontSize: 12, color: 'var(--dark-sub)' }}>{left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''}</div>
        {error && <div style={{ color: 'var(--pink-bright)', fontSize: 13 }}>{error}</div>}
        <button className="text-btn" style={{ color: '#fff' }} onClick={() => setMode('choose')}>Back</button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{otherName}&apos;s code</div>
      <input className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="0000" maxLength={4} value={typed}
        onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, 4))}
        onKeyDown={(e) => e.key === 'Enter' && typed.length === 4 && enter()}
        style={{ height: 60, fontFamily: 'var(--display)', fontSize: 30, letterSpacing: 14, textAlign: 'center', color: 'var(--ink)' }} />
      <button className="btn lime" style={{ height: 46 }} disabled={typed.length !== 4 || busy} onClick={enter}>
        {busy ? 'Checking…' : 'Finish trade'}
      </button>
      {error && <div style={{ color: 'var(--pink-bright)', fontSize: 13 }}>{error}</div>}
      <button className="text-btn" style={{ color: '#fff', alignSelf: 'flex-start', padding: 0 }} onClick={() => { setMode('choose'); setError(''); }}>Back</button>
    </div>
  );
}
