'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CATEGORIES } from '@/lib/trade';
import { Icon } from '@/components/Icon';
import { ItemArt } from '@/components/ui';

// Three columns: shifting the color pattern by one each row keeps neighbors (side by side and
// stacked) from ever sharing a card color. Pink pictures sit on blue cards, blue on pink and lime.
const ROW_PATTERN = [['blue', 'pink'], ['pink', 'blue'], ['green', 'blue']] as const;

export default function Categories() {
  const router = useRouter();
  return (
    <main className="screen no-nav">
      <div className="row" style={{ gap: 12 }}>
        <button className="icon-btn" aria-label="Back" onClick={() => router.back()}><Icon name="back" size={20} stroke={2.2} /></button>
        <h1 className="title-push">All categories</h1>
      </div>
      <div className="category-grid">
        {CATEGORIES.map((c, i) => {
          const colors = ROW_PATTERN[(i % 3 + Math.floor(i / 3)) % 3];
          return (
            <Link key={c.id} href={`/find?category=${c.id}`} className="category-tile">
              <div className={`img tint-${colors[0]}`}>
                <ItemArt category={c.id} colors={colors} size={46} />
              </div>
              <div className="t">{c.label}</div>
              <div className="ex">{c.examples}</div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
