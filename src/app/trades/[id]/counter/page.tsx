'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { OFFER_SELECT, friendlyError, turnOf, type Listing, type Offer } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Loading, PushHeader } from '@/components/ui';
import { Fairness } from '@/components/FairnessAI';

// Counter an offer: change which of the sender's items (and sweeteners) the trade is for.
// Works for both sides: the owner asks for something different, or the sender revises.
export default function Counter() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const router = useRouter();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [closet, setCloset] = useState<Listing[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('offers').select(OFFER_SELECT).eq('id', id).single();
      const o = data as unknown as Offer;
      if (!o) return;
      setOffer(o);
      setPicked(o.items.map((i) => i.listing?.id).filter(Boolean) as string[]);
      // The sender's closet: their active items, plus whatever is already in this offer
      const { data: items } = await supabase.from('listings').select('*')
        .eq('owner_id', o.from_user).eq('status', 'active').order('created_at', { ascending: false });
      setCloset((items ?? []) as Listing[]);
    })();
  }, [id]);

  if (!offer || !closet || !me) return <Loading />;

  const iAmOwner = offer.to_user === me.id;
  const sender = offer.from;
  const myTurn = offer.status === 'pending' && turnOf(offer) === me.id;
  const chosen = closet.filter((l) => picked.includes(l.id));
  const unchanged = picked.slice().sort().join() === offer.items.map((i) => i.listing?.id).sort().join()
    && offer.sweeteners.length === 0;

  async function send() {
    setBusy(true); setError('');
    const { error } = await supabase.rpc('counter_offer', { p_offer: id, p_items: picked, p_sweeteners: [] });
    setBusy(false);
    if (error) setError(friendlyError(error)); else router.replace(`/trades/${id}`);
  }

  return (
    <>
      <main className="screen no-nav">
        <PushHeader title="Counter" back={`/trades/${id}`} />

        <div className="spread" style={{ background: 'var(--blue-tint)', borderRadius: 14, padding: '14px 16px' }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{offer.listing?.title}</span>
          <span className="pill white">{offer.listing?.tier}</span>
        </div>

        <div>
          <p className="label">{iAmOwner ? `From ${sender?.first_name ?? 'their'}'s closet` : 'You give'}</p>
          {closet.length === 0 ? (
            <p className="body">Nothing else listed.</p>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {closet.map((l) => {
                const on = picked.includes(l.id);
                return (
                  <button key={l.id} className={`check-row ${on ? 'on' : ''}`} aria-pressed={on} disabled={!myTurn}
                    onClick={() => setPicked(on ? picked.filter((x) => x !== l.id) : [...picked, l.id])}>
                    <span className="box">{on && <Icon name="check" size={14} stroke={3} />}</span>
                    <span className="row-title grow">{l.title}</span>
                    <span className="pill" style={{ background: 'var(--bg)' }}>{l.tier}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {offer.listing && (
          <Fairness target={offer.listing.id} targetTier={offer.listing.tier} items={picked} itemTiers={chosen.map((l) => l.tier)}
            sweeteners={[]} iGive={!iAmOwner} otherName={(iAmOwner ? sender?.first_name : offer.to?.first_name) ?? 'They'} />
        )}

        {error && <div className="alert"><Icon name="warning" size={18} />{error}</div>}
      </main>
      <div className="action-bar">
        <button className="btn" disabled={!myTurn || picked.length === 0 || unchanged || busy} onClick={send}>
          <Icon name="swap" size={18} />
          {!myTurn ? 'Their turn' : busy ? 'Sending…' : 'Send counter'}
        </button>
      </div>
    </>
  );
}
