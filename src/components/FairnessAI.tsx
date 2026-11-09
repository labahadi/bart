'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fairness, type Tier } from '@/lib/trade';

type Result = { verdict: 'even' | 'offer_higher' | 'offer_lower'; confidence: 'low' | 'medium' | 'high'; reason: string };

// Fairness meter. The AI judges the swap on its own whenever the items change; until it answers
// (or if it's unavailable) the meter uses the S/M/L sizes. Advice only.
// iGive: true when the viewer is the one giving the offered items.
export function Fairness({ target, targetTier, items, itemTiers, sweeteners, iGive, otherName }: {
  target: string; targetTier: Tier; items: string[]; itemTiers: Tier[]; sweeteners: string[];
  iGive: boolean; otherName: string;
}) {
  const meter = fairness(targetTier, itemTiers, sweeteners.length);
  const [result, setResult] = useState<Result | null>(null);
  const [checking, setChecking] = useState(false);

  const key = [target, ...items.slice().sort(), ...sweeteners.slice().sort()].join('|');
  useEffect(() => {
    setResult(null);
    if (!items.length) { setChecking(false); return; }
    let live = true;
    setChecking(true);
    // Wait a moment so tapping several items in a row asks once
    const t = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      const res = await fetch('/api/fairness', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ target, items, sweeteners }),
      }).catch(() => null);
      const json = res?.ok ? await res.json().catch(() => null) : null;
      if (!live) return;
      setChecking(false);
      if (json?.verdict) setResult(json as Result);
    }, 600);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const empty = !items.length && !sweeteners.length;
  const label = empty ? ''
    : result ? (result.verdict === 'even' ? 'Even' : (result.verdict === 'offer_higher') === iGive ? 'You give more' : `${otherName} gives more`)
    : checking ? 'Checking…' : meter.label;
  const color = result
    ? (result.verdict === 'even' ? 'var(--blue)' : result.verdict === 'offer_higher' ? 'var(--pink)' : 'var(--warn)')
    : checking ? 'var(--muted)' : meter.color;
  const fill = result ? { offer_lower: 0.25, even: 0.5, offer_higher: 0.75 }[result.verdict] : meter.fill;

  return (
    <div className="card stack" style={{ gap: 10, padding: 16 }}>
      <div className="spread">
        <span className="label" style={{ margin: 0 }}>Fairness</span>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>{label}</span>
      </div>
      <div style={{ height: 8, background: 'var(--border-soft)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${empty ? 0 : fill * 100}%`, background: color, borderRadius: 999, transition: 'width .3s, background .3s' }} />
      </div>
    </div>
  );
}
