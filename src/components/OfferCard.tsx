'use client';

import Link from 'next/link';
import { Icon } from './Icon';
import { Avatar } from './ui';
import { displayName, offerGives, turnOf, type Offer } from '@/lib/trade';

export function statusPill(o: Offer, myId: string) {
  const myTurn = turnOf(o) === myId;
  switch (o.status) {
    case 'pending':
      if (!myTurn) return <span className="pill soft">Waiting</span>;
      return o.counter_count > 0 ? <span className="pill blue-tint">Countered</span> : <span className="pill pink-tint">New offer</span>;
    case 'accepted': return <span className="pill lime">Accepted</span>;
    case 'declined': return <span className="pill soft">Declined</span>;
    case 'cancelled': return <span className="pill soft">Cancelled</span>;
    case 'completed': return <span className="pill green-tint">Done ✓</span>;
  }
}

// The two sides of a trade, from my point of view
// Tapping an item name opens that item's listing (photos, notes, condition)
export function SwapRow({ offer, myId }: { offer: Offer; myId: string }) {
  const iSent = offer.from_user === myId;
  const done = offer.status === 'completed';
  const offered = offer.items.map((i) => i.listing).filter(Boolean) as { id: string; title: string }[];
  const link = (it: { id: string; title: string }) => (
    <Link key={it.id} href={`/item/${it.id}`} style={{ color: 'var(--ink)', textDecoration: 'underline', textDecorationColor: 'var(--border)', textUnderlineOffset: 3 }}>
      {it.title}
    </Link>
  );
  const givesNode = (
    <>
      {offered.map((it, i) => <span key={it.id}>{i > 0 && ' + '}{link(it)}</span>)}
      {offer.sweeteners.map((s) => <span key={s}> + {s.toLowerCase()}</span>)}
    </>
  );
  const getsNode = offer.listing ? link(offer.listing) : 'Item';
  const left = { k: iSent ? (done ? 'You gave' : 'You give') : (done ? 'They gave' : 'They give'), v: givesNode };
  const right = { k: iSent ? (done ? 'You got' : 'For their') : (done ? 'You gave' : 'For your'), v: getsNode };
  return (
    <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
      <div className="swap-box" style={{ background: 'var(--bg)' }}><div className="k">{left.k}</div><div className="v">{left.v}</div></div>
      <span style={{ color: 'var(--pink)', alignSelf: 'center' }}><Icon name="swap" size={20} /></span>
      <div className="swap-box" style={{ background: 'var(--blue-tint)' }}><div className="k">{right.k}</div><div className="v">{right.v}</div></div>
    </div>
  );
}

export function OfferCard({ offer, myId, actions, unread }: { offer: Offer; myId: string; actions?: React.ReactNode; unread?: boolean }) {
  const other = offer.from_user === myId ? offer.to : offer.from;
  const when = new Date(offer.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <div className="card big stack">
      <Link href={`/trades/${offer.id}`} className="row" style={{ color: 'inherit' }}>
        <Avatar profile={other} size={40} />
        <div className="grow">
          <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            {displayName(other)}
            {unread && <span aria-label="New" style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--pink)' }} />}
          </div>
          <div className="meta">{when}</div>
        </div>
        {statusPill(offer, myId)}
      </Link>
      <SwapRow offer={offer} myId={myId} />
      {actions}
    </div>
  );
}
