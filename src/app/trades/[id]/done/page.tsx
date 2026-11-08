'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/trade';
import { Icon } from '@/components/Icon';

// Where the QR code points: scanning it with a phone camera opens this page,
// which enters the code and finishes the trade.
function Done() {
  const { id } = useParams<{ id: string }>();
  const code = useSearchParams().get('code') ?? '';
  const router = useRouter();
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('confirm_handoff', { p_offer: id, p_code: code });
      if (error) { setState('error'); setMessage(friendlyError(error)); return; }
      if (data === 'completed') { setState('done'); setTimeout(() => router.replace(`/trades/${id}`), 1500); return; }
      setState('error');
      setMessage(data === 'wrong' ? "Code doesn't match." : data === 'locked' ? 'Too many tries. Ask for a new code.' : 'Code expired.');
    })();
  }, [id, code, router]);

  return (
    <main className="screen no-nav" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 120 }}>
      {state === 'working' && <><div className="spinner" /><p className="body">Finishing your trade…</p></>}
      {state === 'done' && (
        <>
          <span style={{ width: 88, height: 88, borderRadius: 999, background: 'var(--lime)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={40} stroke={2.4} />
          </span>
          <h1 className="display" style={{ fontSize: 28 }}>Swapped!</h1>
        </>
      )}
      {state === 'error' && (
        <>
          <h1 className="title-push">Didn&apos;t work</h1>
          <p className="body">{message}</p>
          <Link href={`/trades/${id}`} className="btn">Back</Link>
        </>
      )}
    </main>
  );
}

export default function DonePage() {
  return <Suspense><Done /></Suspense>;
}
