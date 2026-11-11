'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { displayName, type Listing } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Avatar, BottomNav, ListingCard, Logo } from '@/components/ui';
import { Badge, useNotifications } from '@/components/Notifications';

export default function Home() {
  const { me } = useAuth();
  const { counts } = useNotifications();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [stats, setStats] = useState<{ rating: number | null; trades: number } | null>(null);
  const [inCloset, setInCloset] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('listings').select('*').eq('status', 'active')
      .order('created_at', { ascending: false }).limit(60)
      .then(({ data, error }) => { if (error) setError(error.message); else setListings(data as Listing[]); });
  }, []);

  useEffect(() => {
    if (!me) return;
    supabase.rpc('trader_stats', { p_user: me.id }).then(({ data }) => setStats(data?.[0] ?? null));
    supabase.from('listings').select('id', { count: 'exact', head: true }).eq('owner_id', me.id).in('status', ['active', 'in_trade'])
      .then(({ count }) => setInCloset(count ?? 0));
  }, [me]);

  const summary = [
    stats?.rating ? `${stats.rating} ★` : null,
    stats ? `${stats.trades} trade${stats.trades === 1 ? '' : 's'}` : null,
    inCloset !== null ? `${inCloset} in closet` : null,
  ].filter(Boolean).join(' · ');

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
          <div className="row" style={{ gap: 8 }}>
            <Link href="/activity" className="icon-btn" aria-label="Activity" style={{ position: 'relative' }}>
              <Icon name="bell" size={20} />
              {counts.all > 0 && <span style={{ position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: 999, background: 'var(--pink)', border: '2px solid #fff', boxSizing: 'content-box' }} />}
            </Link>
            <Link href="/settings" className="icon-btn" aria-label="Settings">
              <Icon name="gear" size={20} />
            </Link>
          </div>
        </div>

        {me && (
          <div className="card big stack" style={{ gap: 12, borderRadius: 20 }}>
            <Link href="/me" aria-label="Open your profile" className="row" style={{ gap: 14, color: 'var(--ink)' }}>
              <span style={{ position: 'relative', display: 'inline-flex', borderRadius: 999, boxShadow: '0 0 0 3px #fff, 0 0 0 5px var(--pink)', margin: 5 }}>
                <Avatar profile={me} size={56} solid="pink" photo={me.avatar_path} />
                <Badge n={counts.me} />
              </span>
              <span className="grow stack" style={{ gap: 2 }}>
                <span className="display" style={{ fontSize: 20 }}>{displayName(me)}</span>
                {summary && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{summary}</span>}
                <span className="meta-blue" style={{ fontSize: 13 }}>View your profile</span>
              </span>
              <span style={{ width: 36, height: 36, borderRadius: 999, background: 'var(--bg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="chevron" size={18} stroke={2.4} />
              </span>
            </Link>
            <Link href="/post" className="btn pink" style={{ height: 48 }}>
              <Icon name="plus" size={20} stroke={2.4} /> Add to your closet
            </Link>
          </div>
        )}

        <div className="spread">
          <h2 className="section-title">Fresh on campus</h2>
          <Link href="/find" style={{ fontSize: 13, fontWeight: 600 }}>Search all</Link>
        </div>

        {error && <div className="alert">{error}</div>}
        {!listings && !error && <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>}
        {listings && listings.length === 0 && <div className="empty">Nothing here yet.</div>}
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
