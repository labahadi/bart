'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/trade';
import { Icon } from '@/components/Icon';
import { PushHeader } from '@/components/ui';

const REASONS = [
  ['sexual', 'Sexual messages or photos'],
  ['harassment', 'Harassment'],
  ['scam', 'Scam'],
  ['unsafe_meetup', 'Unsafe meetup request'],
  ['other', 'Something else'],
] as const;

// Report a chat. The team sees the conversation and can delete messages.
export default function ReportChat() {
  const { id } = useParams<{ id: string }>();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function send() {
    setBusy(true); setError('');
    const { error } = await supabase.from('chat_reports').insert({ offer_id: id, reason, details: details.trim() || null });
    setBusy(false);
    if (error) setError(friendlyError(error)); else setSent(true);
  }

  if (sent) {
    return (
      <main className="screen no-nav" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 100 }}>
        <span style={{ width: 88, height: 88, borderRadius: 999, background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="shield" size={40} />
        </span>
        <h1 className="display" style={{ fontSize: 28 }}>Thanks for telling us</h1>
        <p className="body">Reports are anonymous. We review them within 24 hours.</p>
        <Link href="/trades" className="btn ink">Back to trades</Link>
      </main>
    );
  }

  return (
    <>
      <main className="screen no-nav">
        <PushHeader title="Report chat" back={`/trades/${id}`} />
        <p className="label" style={{ marginBottom: -6 }}>What happened?</p>
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
