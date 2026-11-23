'use client';

import Link from 'next/link';
import type { Listing } from '@/lib/trade';
import { Icon } from './Icon';
import { MascotFace } from './Mascot';
import { ItemThumb } from './ui';

type Side = Pick<Listing, 'id' | 'title' | 'category' | 'photo_paths'> | null;

// Full-screen "Trade locked in!" moment, shown once when a trade is accepted.
// The dog pops in with a bounce and stays (mascot.css respects reduced motion).
export function TradeLockedIn({ otherName, youAccepted, give, get, planHref, onClose }: {
  otherName: string; youAccepted: boolean; give: Side; get: Side; planHref: string | null; onClose: () => void;
}) {
  return (
    <div className="locked-in" role="dialog" aria-modal="true" aria-label="Trade locked in">
      <span className="confetti" style={{ width: 22, height: 22, borderRadius: 999, background: 'var(--lime)', top: 120, left: 40 }} />
      <span className="confetti" style={{ width: 14, height: 14, borderRadius: 999, background: 'var(--pink)', top: 90, right: 70 }} />
      <span className="confetti" style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--blue)', top: 330, right: 32, transform: 'rotate(20deg)' }} />
      <span className="confetti" style={{ width: 18, height: 18, borderRadius: 5, background: 'var(--pink)', top: 360, left: 30, transform: 'rotate(-25deg)' }} />

      <button className="locked-close" aria-label="Close" onClick={onClose}><Icon name="close" size={20} stroke={2.4} /></button>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24, position: 'relative' }}>
        <span className="locked-circle">
          <MascotFace face="trade-locked-in" motion="pop-in" width={216} alt="bart dog cheering" />
        </span>
      </div>
      <h1 className="locked-title">Trade locked in!</h1>
      <p className="locked-sub">{youAccepted ? `You and ${otherName} have a deal.` : `${otherName} accepted your offer.`}</p>

      <div className="locked-swap">
        {[give, get].map((item, i) => (
          <div key={i} className="stack" style={{ alignItems: 'center', gap: 6, gridColumn: i === 0 ? 1 : 3 }}>
            <ItemThumb item={item} size={64} radius={20} />
            <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'center' }}>{item?.title ?? 'Item'}</span>
          </div>
        ))}
        <span className="locked-swap-icon"><Icon name="swap" size={22} stroke={2.4} /></span>
      </div>

      <div className="stack" style={{ marginTop: 'auto', gap: 10, position: 'relative' }}>
        {planHref
          ? <Link href={planHref} className="btn lime" style={{ height: 56, fontSize: 17 }}>Plan the meetup</Link>
          : <button className="btn lime" style={{ height: 56, fontSize: 17 }} onClick={onClose}>Back to the chat</button>}
        <Link href="/" className="btn" style={{ background: 'transparent', color: '#fff', height: 50 }}>Back to home</Link>
      </div>
    </div>
  );
}
