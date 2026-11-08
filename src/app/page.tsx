'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { CATEGORIES, type Category, type Listing } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { BottomNav, ListingCard, Logo } from '@/components/ui';
import Link from 'next/link';
import { useNotifications } from '@/components/Notifications';

export default function Home() {
  const { me } = useAuth();
  const { counts } = useNotifications();
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      let q = supabase.from('listings').select('*').eq('status', 'active')
        .order('created_at', { ascending: false }).limit(60);
      if (category !== 'all') q = q.eq('category', category);
      // Strip characters that have meaning in Supabase filter strings
      const term = query.trim().replace(/[,()%*\\]/g, ' ');
      if (term) q = q.or(`title.ilike.%${term}%,wants.ilike.%${term}%,description.ilike.%${term}%`);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) setError(error.message); else { setError(''); setListings(data as Listing[]); }
    }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [category, query]);

  return (
    <>
      <main className="screen">
        <div className="spread">
          <div className="row" style={{ gap: 10 }}>
            <Logo height={28} />
            <span className="pill lime" style={{ fontWeight: 600, padding: '4px 10px' }}>
              <Icon name="shield" size={14} /> Penn verified
            </span>
          </div>
          <Link href="/activity" className="icon-btn" aria-label="Activity" style={{ position: 'relative' }}>
            <Icon name="bell" size={20} />
            {counts.all > 0 && <span style={{ position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: 999, background: 'var(--pink)', border: '2px solid #fff', boxSizing: 'content-box' }} />}
          </Link>
        </div>

        <label className="search">
          <Icon name="search" size={18} />
          <input placeholder="Textbooks, dorm stuff, skills..." value={query} onChange={(e) => setQuery(e.target.value)}
            aria-label="Search listings" />
        </label>

        <div className="chips">
          <button className={`chip ${category === 'all' ? 'on' : ''}`} onClick={() => setCategory('all')}>All</button>
          {CATEGORIES.map((c) => (
            <button key={c.id} className={`chip ${category === c.id ? 'on' : ''}`} onClick={() => setCategory(c.id)}>
              {c.label}
            </button>
          ))}
        </div>

        <div className="spread">
          <h2 className="section-title">Fresh on campus</h2>
          {listings && <span className="meta" style={{ fontSize: 13 }}>{listings.length} listing{listings.length === 1 ? '' : 's'}</span>}
        </div>

        {error && <div className="alert">{error}</div>}
        {!listings && !error && <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>}
        {listings && listings.length === 0 && (
          <div className="empty">
            {query || category !== 'all' ? 'No matches.' : 'Nothing here yet.'}
          </div>
        )}
        {listings && listings.length > 0 && (
          <div className="grid2">
            {listings.map((l) => <ListingCard key={l.id} listing={l} mine={l.owner_id === me?.id} />)}
          </div>
        )}
      </main>
      <BottomNav />
    </>
  );
}
