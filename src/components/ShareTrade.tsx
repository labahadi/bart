'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { bannedMatch } from '@/lib/banned';
import { screenText } from '@/lib/screen';
import { friendlyError } from '@/lib/trade';

// After a trade is finished: post it to the Campus feed (once per trade, either person can)
export function ShareTrade({ offerId }: { offerId: string }) {
  const [shared, setShared] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('feed_posts').select('id').eq('offer_id', offerId).maybeSingle()
      .then(({ data }) => setShared(!!data));
  }, [offerId]);

  async function share() {
    if (bannedMatch(note)) { setError('That includes a banned word.'); return; }
    setBusy(true); setError('');
    const problem = await screenText(note);
    if (problem) { setBusy(false); setError(problem); return; }
    const { error } = await supabase.rpc('share_trade', { p_offer: offerId, p_note: note.trim() || null });
    setBusy(false);
    if (error && !/already/i.test(error.message)) setError(friendlyError(error)); else setShared(true);
  }

  if (shared === null) return null;
  if (shared) {
    return <Link href="/campus" style={{ color: 'var(--lime)', fontSize: 14, fontWeight: 600 }}>On the Campus feed ✓</Link>;
  }
  return (
    <div className="stack" style={{ gap: 8, borderTop: '1px solid #3A3A44', paddingTop: 12 }}>
      <input className="input" style={{ height: 44, color: 'var(--ink)' }} placeholder="Add a note" maxLength={140}
        value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn pink" style={{ height: 46 }} disabled={busy} onClick={share}>{busy ? 'Sharing…' : 'Share to Campus'}</button>
      {error && <div style={{ color: 'var(--pink-bright)', fontSize: 13 }}>{error}</div>}
    </div>
  );
}
