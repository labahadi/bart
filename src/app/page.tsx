'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRemembered } from '@/lib/remembered';
import { supabase } from '@/lib/supabase';
import { displayName, type Listing } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Avatar, ListingCard, Logo } from '@/components/ui';
import { Badge, useNotifications } from '@/components/Notifications';

export default function Home() {
  const { me } = useAuth();
  const { counts } = useNotifications();
  const [listings, setListings] = useRemembered<Listing[] | null>('home:listings', null);
  const [stats, setStats] = useRemembered<{ rating: number | null; trades: number } | null>('home:stats', null);
  const [inCloset, setInCloset] = useRemembered<number | null>('home:closet', null);
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
          <div className="hero">
            <span className="dot" aria-hidden="true" style={{ right: -55, top: -75, width: 150, height: 150, background: 'var(--pink)' }} />
            <span className="dot" aria-hidden="true" style={{ right: 64, top: 18, width: 40, height: 40, background: 'var(--lime)' }} />
            <Link href="/me" aria-label="Open your profile" className="row" style={{ gap: 14, color: '#fff' }}>
              <span style={{ position: 'relative', display: 'inline-flex', borderRadius: 999, boxShadow: '0 0 0 3px #fff' }}>
                <Avatar profile={me} size={58} solid="pink" photo={me.avatar_path} />
                <Badge n={counts.me} />
              </span>
              <span className="grow stack" style={{ gap: 2 }}>
                <span className="display" style={{ fontSize: 26, letterSpacing: -0.8 }}>Hey, {me.first_name ?? 'there'}</span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>View your profile ›</span>
              </span>
            </Link>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="stat"><b>{stats?.trades ?? 0}</b>trade{stats?.trades === 1 ? '' : 's'}</span>
              <span className="stat"><b>{stats?.rating ?? '–'}</b>rating</span>
              <span className="stat"><b>{inCloset ?? 0}</b>in closet</span>
            </div>
            <Link href="/post" className="btn lime" style={{ height: 54 }}>
              <Icon name="plus" size={20} stroke={2.8} /> Add to your closet
            </Link>
          </div>
        )}

        <div className="spread">
          <h2 className="section-title">Fresh on campus</h2>
          <Link href="/find" style={{ fontSize: 14, fontWeight: 700 }}>See all</Link>
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
    </>
  );
}
