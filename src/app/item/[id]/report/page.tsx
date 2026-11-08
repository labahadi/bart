'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/trade';
import { Icon } from '@/components/Icon';
import { PushHeader } from '@/components/ui';

const REASONS = [
  ['banned_item', 'Banned item'],
  ['scam', 'Scam or fake listing'],
  ['unsafe_meetup', 'Unsafe meetup request'],
  ['harassment', 'Harassment'],
  ['other', 'Something else'],
] as const;

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('listings').select('title').eq('id', id).maybeSingle().then(({ data }) => setTitle(data?.title ?? ''));
  }, [id]);

  async function send() {
    setBusy(true); setError('');
    const { error } = await supabase.from('reports').insert({ listing_id: id, reason, details: details.trim() || null });
    setBusy(false);
    // A second report from the same person counts as already sent
    if (error && !/duplicate/i.test(error.message)) setError(friendlyError(error)); else setSent(true);
  }

  if (sent) {
    return (
      <main className="screen no-nav" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 100 }}>
        <span style={{ width: 88, height: 88, borderRadius: 999, background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="shield" size={40} />
        </span>
        <h1 className="display" style={{ fontSize: 28 }}>Thanks for looking out</h1>
        <p className="body">Reports are anonymous. We review them within 24 hours.</p>
        <Link href="/" className="btn ink">Back to feed</Link>
      </main>
    );
  }

  return (
    <>
      <main className="screen no-nav">
        <PushHeader title="Report" />
        {title && <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</p>}
        <p className="label" style={{ marginBottom: -6 }}>What&apos;s wrong?</p>
        <div className="stack" style={{ gap: 10 }}>
          {REASONS.map(([value, label]) => (
            <button key={value} className={`check-row pink ${reason === value ? 'on' : ''}`} onClick={() => setReason(value)}
              role="radio" aria-checked={reason === value}>
              <span className="radio" />
              <span className="row-title">{label}</span>
            </button>
          ))}
        </div>
        <div>
          <label className="label" htmlFor="details" style={{ display: 'block' }}>Details</label>
          <textarea id="details" className="input" rows={3} maxLength={1000} placeholder="Optional"
            value={details} onChange={(e) => setDetails(e.target.value)} />
        </div>
        {error && <div className="alert">{error}</div>}
      </main>
      <div className="action-bar">
        <button className="btn pink" disabled={!reason || busy} onClick={send}>{busy ? 'Sending…' : 'Send report'}</button>
      </div>
    </>
  );
}
