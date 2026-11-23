'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { recall, remember } from '@/lib/remembered';
import { supabase } from '@/lib/supabase';
import { CATEGORIES, type Category, type Listing } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { ListingCard } from '@/components/ui';
import { MascotFace, NoResultsCard, SniffingDots } from '@/components/Mascot';

// Find: search everything that's up for trade (this used to be the search on Home)
// Both sniff cards run on the page clock, so when "Sniffing around" turns into
// "Couldn't sniff it out" the dog carries on mid-sniff instead of restarting
function syncSniff(el: HTMLElement | null) {
  if (el) el.style.setProperty('--sniff-delay', `-${Math.round(performance.now() % 2400)}ms`);
}

export default function Find() {
  const { me } = useAuth();
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');
  const [listings, setListings] = useState<Listing[] | null>(() => recall<Listing[]>('find:all') ?? null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // While someone types (and for 1 second after they stop) the dog keeps sniffing
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  function onType(value: string) {
    setQuery(value);
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1000);
  }
  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  // Opened from All categories (/find?category=kitchen): start filtered to that category
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('category');
    if (c && CATEGORIES.some((x) => x.id === c)) setCategory(c as Category);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      let q = supabase.from('listings').select('*').eq('status', 'active')
        .order('created_at', { ascending: false }).limit(60);
      if (category !== 'all') q = q.eq('category', category);
      // Strip characters that have meaning in Supabase filter strings
      const term = query.trim().replace(/[,()%*\\]/g, ' ');
      if (term) q = q.or(`title.ilike.%${term}%,wants.ilike.%${term}%,description.ilike.%${term}%`);
      const { data, error } = await q;
      if (cancelled) return;
      setLoading(false);
      if (error) setError(error.message); else {
        setError(''); setListings(data as Listing[]);
        if (category === 'all' && !term) remember('find:all', data);
      }
    }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [category, query]);

  const term = query.trim();
  const found = listings?.length ?? 0;
  // Sniffing: first load, while typing, or while a new search is still on its way
  const sniffing = !error && (!listings || typing || (loading && !!term));
  const noResults = !sniffing && !error && found === 0;

  return (
    <>
      <main className="screen">
        <div className="spread" style={{ alignItems: 'flex-end' }}>
          <div>
            <h1 className="title-tab">Find</h1>
            <p className="subtitle">Search everything up for trade on campus</p>
          </div>
          <Link href="/categories" style={{ fontSize: 14, fontWeight: 700, paddingBottom: 4, flexShrink: 0 }}>All categories</Link>
        </div>

        <label className="search" style={{ height: 50, borderColor: 'var(--blue)', borderWidth: 1.5 }}>
          <Icon name="search" size={20} />
          <input type="search" placeholder='Try "lamp" or "tutoring"' value={query} onChange={(e) => onType(e.target.value)}
            aria-label="Search listings" style={{ fontSize: 16 }} />
        </label>

        <div className="chips">
          <button className={`chip ${category === 'all' ? 'on' : ''}`} onClick={() => setCategory('all')}>All</button>
          {CATEGORIES.map((c) => (
            <button key={c.id} className={`chip ${category === c.id ? 'on' : ''}`} onClick={() => setCategory(c.id)}>
              {c.label}
            </button>
          ))}
        </div>

        {!sniffing && found > 0 && (
          <span className="meta" style={{ fontSize: 13, fontWeight: 600 }}>
            {`${found} result${found === 1 ? '' : 's'}${term ? ` for “${term}”` : ''}`}
          </span>
        )}

        {error && <div className="alert">{error}</div>}

        {/* The dog sniffs while loading and while you type. If nothing turns up, the same card
            (same dog, same spot) becomes "Couldn't sniff it out" and the buttons slide in. */}
        {sniffing && (
          <div className="sniff-card" role="status" ref={syncSniff}>
            <MascotFace face="sniffing" motion="sniff" width={70} alt="bart dog sniffing around" />
            <span className="stack" style={{ gap: 3 }}>
              <b style={{ fontSize: 17 }}><SniffingDots label="Sniffing around campus" /></b>
              <span style={{ fontSize: 13, color: '#E4E9FF' }}>Checking closets near you</span>
            </span>
          </div>
        )}
        {noResults && (
          <div className="sniff-reveal" role="status" ref={syncSniff}>
            <NoResultsCard
              onPostWanted={() => router.push(`/wanted?ask=${encodeURIComponent(term || '1')}`)}
              onBrowse={() => { setQuery(''); setCategory('all'); window.history.replaceState(null, '', '/find'); }}
            />
          </div>
        )}

        {sniffing && (
          <div className="grid2" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i}>
                <div className="skeleton" style={{ height: 132, borderRadius: 26 }} />
                <div className="skeleton" style={{ height: 14, width: `${70 - i * 5}%`, marginTop: 10 }} />
                <div className="skeleton" style={{ height: 12, width: '45%', marginTop: 8, opacity: 0.7 }} />
              </div>
            ))}
          </div>
        )}
        {!sniffing && found > 0 && listings && (
          <div className="grid2">
            {listings.map((l, i) => <ListingCard key={l.id} listing={l} mine={l.owner_id === me?.id} position={i} />)}
          </div>
        )}

        {!sniffing && found > 0 && (
          <div className="row" style={{ background: 'var(--pink-tint)', borderRadius: 16, padding: 14 }}>
            <div className="grow">
              <div style={{ fontSize: 14, fontWeight: 700 }}>Not seeing it?</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Post what you&apos;re looking for on Wanted. People who have it can answer.</div>
            </div>
            <Link href={`/wanted?ask=${encodeURIComponent(term || '1')}`} className="btn pink small" style={{ width: 'auto', padding: '0 16px', height: 40, borderRadius: 10, flexShrink: 0 }}>Ask</Link>
          </div>
        )}
      </main>
    </>
  );
}
