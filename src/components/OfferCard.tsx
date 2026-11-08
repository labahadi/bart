'use client';

import Link from 'next/link';
import { Icon } from './Icon';
import { Avatar } from './ui';
import { displayName, offerGives, type Offer } from '@/lib/trade';

export function statusPill(o: Offer, myId: string) {
  const incoming = o.to_user === myId;
  switch (o.status) {
    case 'pending': return incoming ? <span className="pill pink-tint">New offer</span> : <span className="pill soft">Waiting</span>;
    case 'accepted': return <span className="pill lime">Accepted</span>;
    case 'declined': return <span className="pill soft">Declined</span>;
    case 'cancelled': return <span className="pill soft">Cancelled</span>;
    case 'completed': return <span className="pill green-tint">Done ✓</span>;
  }
}

// The two sides of a trade, from my point of view
export function SwapRow({ offer, myId }: { offer: Offer; myId: string }) {
  const iSent = offer.from_user === myId;
  const gives = offerGives(offer);
  const gets = offer.listing?.title ?? 'Item';
  const done = offer.status === 'completed';
  const left = iSent ? { k: done ? 'You gave' : 'You give', v: gives } : { k: done ? 'They gave' : 'They give', v: gives };
  const right = iSent ? { k: done ? 'You got' : 'For their', v: gets } : { k: done ? 'You gave' : 'For your', v: gets };
  return (
    <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
      <div className="swap-box" style={{ background: 'var(--bg)' }}><div className="k">{left.k}</div><div className="v">{left.v}</div></div>
      <span style={{ color: 'var(--pink)', alignSelf: 'center' }}><Icon name="swap" size={20} /></span>
      <div className="swap-box" style={{ background: 'var(--blue-tint)' }}><div className="k">{right.k}</div><div className="v">{right.v}</div></div>
    </div>
  );
}

export function OfferCard({ offer, myId, actions }: { offer: Offer; myId: string; actions?: React.ReactNode }) {
  const other = offer.from_user === myId ? offer.to : offer.from;
  const when = new Date(offer.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <div className="card big stack">
      <Link href={`/trades/${offer.id}`} className="row" style={{ color: 'inherit' }}>
        <Avatar profile={other} size={40} />
        <div className="grow">
          <div style={{ fontSize: 15, fontWeight: 600 }}>{displayName(other)}</div>
          <div className="meta">{when}</div>
        </div>
        {statusPill(offer, myId)}
      </Link>
      <SwapRow offer={offer} myId={myId} />
      {actions}
    </div>
  );
}
