'use client';

// Top of a finished trade (swapped, declined or cancelled): small cards for what happened,
// the items, the ratings and any Campus likes and comments, so a past trade isn't just an empty chat.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import type { Listing, Offer } from '@/lib/trade';
import { Icon } from '@/components/Icon';
import { ItemThumb } from '@/components/ui';

type Item = Pick<Listing, 'id' | 'title' | 'tier' | 'category' | 'photo_paths'> & { description?: string | null; condition?: string | null };
type Reviews = { my_stars: number | null; their_stars: number | null; they_rated: boolean };
type Post = { id: string; note: string | null; likes: number; comments: { id: string; body: string; author: string }[]; commentCount: number };

const TZ = 'America/New_York';
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }) : '');

const Stars = ({ n }: { n: number }) => (
  <span aria-label={`${n} of 5 stars`} style={{ letterSpacing: 1, color: 'var(--pink)', fontSize: 15 }}>
    {'★'.repeat(n)}<span style={{ color: 'var(--border)' }}>{'★'.repeat(5 - n)}</span>
  </span>
);

export function PastRecap({ offer, meId, otherName, place, onRate }: {
  offer: Offer; meId: string; otherName: string; place: string; onRate: () => void;
}) {
  const [items, setItems] = useState<Record<string, Item>>({});
  const [reviews, setReviews] = useState<Reviews | null>(null);
  const [post, setPost] = useState<Post | null>(null);

  const iSent = offer.from_user === meId;
  const offered = offer.items.map((i) => i.listing).filter(Boolean) as Item[];
  const target = offer.listing ? [offer.listing as Item] : [];
  const gave = iSent ? offered : target;
  const got = iSent ? target : offered;
  const swapped = offer.status === 'completed';

  useEffect(() => {
    const ids = [...offered, ...target].map((l) => l.id);
    if (ids.length) {
      supabase.from('listings').select('id,title,tier,category,photo_paths,description,condition').in('id', ids)
        .then(({ data }) => setItems(Object.fromEntries((data ?? []).map((l) => [l.id, l as Item]))));
    }
    if (!swapped) return;
    supabase.rpc('trade_reviews', { p_offer: offer.id }).then(({ data }) => setReviews((data as Reviews[] | null)?.[0] ?? null));
    (async () => {
      const { data: p } = await supabase.from('feed_posts').select('id,note').eq('offer_id', offer.id).maybeSingle();
      if (!p) return;
      const [{ count: likes }, { data: cs, count }] = await Promise.all([
        supabase.from('post_likes').select('post_id', { count: 'exact', head: true }).eq('post_id', p.id),
        supabase.from('post_comments').select('id,body,author:profiles!post_comments_author_id_fkey(first_name)', { count: 'exact' })
          .eq('post_id', p.id).order('created_at', { ascending: false }).limit(3),
      ]);
      setPost({
        id: p.id, note: p.note, likes: likes ?? 0, commentCount: count ?? 0,
        comments: ((cs ?? []) as unknown as { id: string; body: string; author: { first_name: string | null } | null }[])
          .reverse().map((c) => ({ id: c.id, body: c.body, author: c.author?.first_name ?? 'Someone' })),
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.id, swapped]);

  const outcome = swapped
    ? { label: 'Swapped', when: day(offer.meet_at ?? offer.updated_at), where: place }
    : { label: offer.status === 'declined' ? 'Declined' : 'Cancelled', when: day(offer.updated_at ?? offer.created_at), where: '' };

  const itemCard = (l: Item, side: 'gave' | 'got') => {
    const full = items[l.id] ?? l;
    return (
      <Link key={`${side}-${l.id}`} href={`/item/${l.id}`} className="card recap-item">
        <ItemThumb item={full} size={56} radius={14} />
        <span className="recap-item-text">
          <span className="recap-tag">{side === 'gave' ? 'You gave' : 'You got'}</span>
          <span className="recap-title">{full.title}</span>
          <span className="meta">{[full.tier, full.condition].filter(Boolean).join(' · ')}</span>
          {full.description && <span className="recap-desc">{full.description}</span>}
        </span>
      </Link>
    );
  };

  return (
    <section className="recap" aria-label="Trade recap">
      <div className={`recap-outcome ${swapped ? 'done' : 'off'}`}>
        <span className="recap-outcome-icon"><Icon name={swapped ? 'check' : 'close'} size={16} stroke={2.6} /></span>
        <span className="grow" style={{ minWidth: 0 }}>
          <b>{outcome.label}</b>{outcome.when && ` · ${outcome.when}`}
          {outcome.where && <span className="recap-where">{outcome.where}</span>}
        </span>
      </div>

      <div className="recap-items">
        {gave.map((l) => itemCard(l, 'gave'))}
        {got.map((l) => itemCard(l, 'got'))}
        {offer.sweeteners.length > 0 && (
          <span className="meta" style={{ paddingLeft: 4 }}>
            Plus {offer.sweeteners.map((s) => s.toLowerCase()).join(', ')}
          </span>
        )}
      </div>

      {swapped && reviews && (
        <button className="card recap-reviews" onClick={reviews.my_stars ? undefined : onRate}>
          <span className="recap-card-head">Ratings</span>
          <span className="spread">
            <span>You rated {otherName}</span>
            {reviews.my_stars ? <Stars n={reviews.my_stars} /> : <span className="recap-action">Rate ›</span>}
          </span>
          <span className="spread">
            <span>{otherName} rated you</span>
            {reviews.their_stars ? <Stars n={reviews.their_stars} />
              : <span className="meta">{reviews.they_rated ? 'Rate them to see it' : 'Not yet'}</span>}
          </span>
        </button>
      )}

      {post && (
        <Link href="/campus" className="card recap-post">
          <span className="spread">
            <span className="recap-card-head">On Campus</span>
            <span className="row" style={{ gap: 12, fontSize: 14, fontWeight: 700 }}>
              <span className="row" style={{ gap: 4, color: 'var(--pink)' }}><Icon name="heart" size={15} fill="currentColor" />{post.likes}</span>
              <span className="row" style={{ gap: 4, color: 'var(--muted)' }}><Icon name="chat" size={15} />{post.commentCount}</span>
            </span>
          </span>
          {post.note && <span className="recap-desc">&ldquo;{post.note}&rdquo;</span>}
          {post.comments.map((c) => (
            <span key={c.id} style={{ fontSize: 14 }}><b>{c.author}</b> {c.body}</span>
          ))}
          {post.commentCount > post.comments.length && <span className="meta">See all {post.commentCount} on Campus</span>}
        </Link>
      )}
    </section>
  );
}
