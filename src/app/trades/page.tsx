'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { OFFER_SELECT, friendlyError, type Offer } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { OfferCard } from '@/components/OfferCard';
import { BottomNav } from '@/components/ui';

type Tab = 'incoming' | 'sent' | 'done';

export default function Trades() {
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>('incoming');
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!me) return;
    const { data, error } = await supabase.from('offers').select(OFFER_SELECT)
      .or(`from_user.eq.${me.id},to_user.eq.${me.id}`).order('created_at', { ascending: false });
    if (error) setError(error.message); else setOffers(data as unknown as Offer[]);
  }, [me]);

  useEffect(() => {
    load();
    // Refresh when any of my offers change (accepted, declined, completed)
    const ch = supabase.channel('my-offers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'offers' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  async function respond(id: string, action: 'accept' | 'decline' | 'cancel') {
    setBusyId(id); setError('');
    const { error } = await supabase.rpc('respond_offer', { p_offer: id, p_action: action });
    setBusyId(null);
    if (error) setError(friendlyError(error));
    await load();
  }

  if (!me) return null;
  const incoming = (offers ?? []).filter((o) => o.to_user === me.id && o.status !== 'completed');
  const sent = (offers ?? []).filter((o) => o.from_user === me.id && o.status !== 'completed');
  const done = (offers ?? []).filter((o) => o.status === 'completed');
  const pendingCount = incoming.filter((o) => o.status === 'pending').length;
  const list = tab === 'incoming' ? incoming : tab === 'sent' ? sent : done;

  return (
    <>
      <main className="screen">
        <h1 className="title-tab">Trades</h1>
        <div className="segmented">
          <button className={tab === 'incoming' ? 'on' : ''} onClick={() => setTab('incoming')}>
            Incoming{pendingCount ? ` (${pendingCount})` : ''}
          </button>
          <button className={tab === 'sent' ? 'on' : ''} onClick={() => setTab('sent')}>Sent</button>
          <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Done</button>
        </div>
        {error && <div className="alert">{error}</div>}
        {!offers && <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>}
        {offers && list.length === 0 && (
          <div className="empty">
            {tab === 'incoming' ? 'No offers yet. Offers on your listings show up here.'
              : tab === 'sent' ? <>You haven&apos;t sent any offers. <Link href="/">Browse the feed</Link></>
              : 'Completed trades show up here.'}
          </div>
        )}
        {list.map((o) => (
          <OfferCard key={o.id} offer={o} myId={me.id} actions={
            o.status === 'pending' && o.to_user === me.id ? (
              <div className="row" style={{ gap: 8 }}>
                <button className="btn small" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                  disabled={busyId === o.id} onClick={() => respond(o.id, 'decline')}>Decline</button>
                <Link href={`/trades/${o.id}`} className="btn small" style={{ background: 'var(--surface)', color: 'var(--blue)', border: '1.5px solid var(--blue)' }}>
                  Message
                </Link>
                <button className="btn small" disabled={busyId === o.id} onClick={() => respond(o.id, 'accept')}>Accept</button>
              </div>
            ) : o.status === 'pending' && o.from_user === me.id ? (
              <button className="text-btn" style={{ alignSelf: 'flex-start', padding: 0, color: 'var(--muted)' }}
                disabled={busyId === o.id} onClick={() => respond(o.id, 'cancel')}>Cancel offer</button>
            ) : o.status === 'accepted' ? (
              <Link href={`/trades/${o.id}`} className="btn pink small">Open chat + set meetup</Link>
            ) : o.status === 'declined' ? (
              <p className="meta" style={{ margin: 0 }}>Declined. {o.from_user === me.id ? 'Try another item on the feed.' : "They'll get a friendly heads up."}</p>
            ) : null
          } />
        ))}
      </main>
      <BottomNav />
    </>
  );
}
