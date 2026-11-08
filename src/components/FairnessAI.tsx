'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fairness, type Tier } from '@/lib/trade';

type Result = { verdict: 'even' | 'offer_higher' | 'offer_lower'; confidence: 'low' | 'medium' | 'high'; reason: string };

// Fairness: the S/M/L meter, with an optional AI check that replaces the label with a verdict.
// Advice only. iGive: true when the viewer is the one giving the offered items.
export function Fairness({ target, targetTier, items, itemTiers, sweeteners, iGive, otherName }: {
  target: string; targetTier: Tier; items: string[]; itemTiers: Tier[]; sweeteners: string[];
  iGive: boolean; otherName: string;
}) {
  const meter = fairness(targetTier, itemTiers, sweeteners.length);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aiOff, setAiOff] = useState(false);

  const key = [target, ...items.slice().sort(), ...sweeteners.slice().sort()].join('|');
  useEffect(() => { setResult(null); setError(''); }, [key]);

  async function check() {
    setBusy(true); setError('');
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/fairness', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify({ target, items, sweeteners }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 501) { setAiOff(true); return; }
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) { setError(json.error ?? 'Try again in a moment.'); return; }
    setResult(json as Result);
  }

  const verdict = !result ? null : result.verdict === 'even' ? 'Even'
    : (result.verdict === 'offer_higher') === iGive ? 'You give more' : `${otherName} gives more`;
  const label = verdict ?? (items.length || sweeteners.length ? meter.label : '');
  const color = result ? (result.verdict === 'even' ? 'var(--blue)' : 'var(--warn)') : meter.color;

  return (
    <div className="card stack" style={{ gap: 10, padding: 16 }}>
      <div className="spread">
        <span className="label" style={{ margin: 0 }}>Fairness</span>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>{label}</span>
      </div>
      <div style={{ height: 8, background: 'var(--border-soft)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${meter.fill * 100}%`, background: color, borderRadius: 999, transition: 'width .2s' }} />
      </div>
      {result?.reason && <p className="body" style={{ fontSize: 13 }}>{result.reason}</p>}
      {!result && !aiOff && items.length > 0 && (
        <button className="text-btn" style={{ padding: 0, alignSelf: 'flex-start', fontSize: 13 }} disabled={busy} onClick={check}>
          {busy ? 'Checking…' : 'Check with AI'}
        </button>
      )}
      {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
