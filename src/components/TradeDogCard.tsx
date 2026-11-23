'use client';

import Link from 'next/link';
import type { Listing } from '@/lib/trade';
import { MascotFace } from './Mascot';
import { SoftIcon } from './SoftIcon';
import { ItemThumb } from './ui';

type Side = Pick<Listing, 'id' | 'title' | 'category' | 'photo_paths'> | null | undefined;

// The big dog card at the top of an accepted ("Trade locked in!") or swapped ("Swapped!") trade.
// The dog pops in every time the trade opens (mascot.css respects reduced motion).
export function TradeDogCard({ title, sub, give, get, planHref }: {
  title: string; sub: string; give: Side; get: Side; planHref?: string | null;
}) {
  return (
    <section className="dog-card" aria-label={title}>
      <span className="confetti" style={{ width: 16, height: 16, borderRadius: 999, background: 'var(--lime)', top: 28, left: 26 }} />
      <span className="confetti" style={{ width: 11, height: 11, borderRadius: 999, background: 'var(--pink)', top: 22, right: 46 }} />
      <span className="confetti" style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--blue)', top: 150, right: 22, transform: 'rotate(20deg)' }} />
      <span className="confetti" style={{ width: 13, height: 13, borderRadius: 4, background: 'var(--pink)', top: 166, left: 24, transform: 'rotate(-25deg)' }} />

      <span className="dog-card-circle">
        <MascotFace face="trade-locked-in" motion="pop-in" width={146} alt="bart dog cheering" />
      </span>
      <h2 className="dog-card-title">{title}</h2>
      {sub && <p className="dog-card-sub">{sub}</p>}

      <div className="dog-card-swap">
        {[give, get].map((item, i) => {
          const inner = (
            <>
              <ItemThumb item={item ?? null} size={56} radius={18} />
              <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'center' }}>{item?.title ?? 'Item'}</span>
            </>
          );
          return item
            ? <Link key={i} href={`/item/${item.id}`} className="dog-card-item" style={{ gridColumn: i === 0 ? 1 : 3 }}>{inner}</Link>
            : <span key={i} className="dog-card-item" style={{ gridColumn: i === 0 ? 1 : 3 }}>{inner}</span>;
        })}
        <span className="dog-card-swap-icon"><SoftIcon name="swap" size={24} color="var(--navy)" /></span>
      </div>

      {planHref && <Link href={planHref} className="btn lime" style={{ height: 52, fontSize: 16, position: 'relative' }}>Plan the meetup</Link>}
    </section>
  );
}
