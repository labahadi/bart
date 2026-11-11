'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { CATEGORIES, type Category, type Listing } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { BottomNav, ListingCard } from '@/components/ui';

// Find: search everything that's up for trade (this used to be the search on Home)
export default function Find() {
  const { me } = useAuth();
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

  const term = query.trim();
  const found = listings?.length ?? 0;

  return (
    <>
      <main className="screen">
        <div>
          <h1 className="title-tab">Find</h1>
          <p className="subtitle">Search everything up for trade on campus</p>
        </div>

        <label className="search" style={{ height: 50, borderColor: 'var(--blue)', borderWidth: 1.5 }}>
          <Icon name="search" size={20} />
          <input type="search" placeholder='Try "lamp" or "tutoring"' value={query} onChange={(e) => setQuery(e.target.value)}
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

        {listings && (
          <span className="meta" style={{ fontSize: 13, fontWeight: 600 }}>
            {found
              ? `${found} result${found === 1 ? '' : 's'}${term ? ` for “${term}”` : ''}`
              : 'Nobody has that up for trade yet'}
          </span>
        )}

        {error && <div className="alert">{error}</div>}
        {!listings && !error && <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>}
        {listings && listings.length > 0 && (
          <div className="grid2">
            {listings.map((l) => <ListingCard key={l.id} listing={l} mine={l.owner_id === me?.id} />)}
          </div>
        )}

        <div className="row" style={{ background: 'var(--pink-tint)', borderRadius: 16, padding: 14 }}>
          <div className="grow">
            <div style={{ fontSize: 14, fontWeight: 700 }}>{found ? 'Not seeing it?' : 'Ask for it instead'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Post what you&apos;re looking for on Wanted. People who have it can answer.</div>
          </div>
          <Link href={`/wanted?ask=${encodeURIComponent(term || '1')}`} className="btn pink small" style={{ width: 'auto', padding: '0 16px', height: 40, borderRadius: 10, flexShrink: 0 }}>Ask</Link>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
