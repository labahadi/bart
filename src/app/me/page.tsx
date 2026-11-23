'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { classLabel, displayName, OFFER_SELECT, sides, type Listing, type Offer } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Avatar, ItemThumb } from '@/components/ui';

// Your profile: opened from the card on Home. Account things (photo, name, Google Calendar,
// sign out) are in Settings.

const STATUS: Record<Listing['status'], [string, string]> = {
  active: ['Live', 'lime'], in_trade: ['In a trade', 'blue-tint'], traded: ['Traded', 'soft'], removed: ['Taken down', 'soft'],
};

export default function Me() {
  const { me } = useAuth();
  const [tab, setTab] = useState<'closet' | 'saved' | 'trades'>('closet');
  const [closet, setCloset] = useState<Listing[]>([]);
  const [saved, setSaved] = useState<Listing[]>([]);
  const [trades, setTrades] = useState<Offer[] | null>(null);
  const [stats, setStats] = useState<{ rating: number | null; trades: number } | null>(null);

  useEffect(() => {
    if (!me) return;
    supabase.from('listings').select('*').eq('owner_id', me.id).order('created_at', { ascending: false })
      .then(({ data }) => setCloset((data ?? []) as Listing[]));
    supabase.from('saves').select('listing:listings(*)').order('created_at', { ascending: false })
      .then(({ data }) => setSaved(((data ?? []) as unknown as { listing: Listing | null }[]).map((s) => s.listing).filter(Boolean) as Listing[]));
    supabase.from('offers').select(OFFER_SELECT).eq('status', 'completed').order('updated_at', { ascending: false }).limit(50)
      .then(({ data }) => setTrades((data ?? []) as unknown as Offer[]));
    supabase.rpc('trader_stats', { p_user: me.id }).then(({ data }) => setStats(data?.[0] ?? null));
  }, [me]);

  if (!me) return null;
  const traded = closet.filter((l) => l.status === 'traded').length;
  const current = closet.filter((l) => l.status === 'active' || l.status === 'in_trade');
  const rows = tab === 'closet' ? current : saved;

  return (
    <main className="screen no-nav profile-screen">
      <div className="profile-band" aria-hidden="true">
        <span style={{ right: -50, top: -60, width: 170, height: 170, background: 'var(--pink)' }} />
        <span style={{ left: 40, bottom: 30, width: 46, height: 46, background: 'var(--lime)' }} />
      </div>
      <div className="spread" style={{ position: 'relative' }}>
        <Link href="/" className="icon-btn" aria-label="Back"><Icon name="back" size={20} stroke={2.2} /></Link>
        <Link href="/settings" className="chip row" style={{ gap: 6, height: 44, display: 'inline-flex', alignItems: 'center', color: 'var(--ink)', borderRadius: 16 }}>
          <Icon name="edit" size={16} /> Edit profile
        </Link>
      </div>

      <div className="stack" style={{ alignItems: 'center', textAlign: 'center', gap: 6, marginTop: 30, position: 'relative' }}>
        <span style={{ display: 'inline-flex', borderRadius: 999, boxShadow: '0 0 0 5px var(--bg)' }}>
          <Avatar profile={me} size={96} solid="pink" photo={me.avatar_path} />
        </span>
        <h1 className="display" style={{ fontSize: 28, marginTop: 8, letterSpacing: -1 }}>{displayName(me)}</h1>
        <span className="pill blue-tint" style={{ fontSize: 13 }}>
          <Icon name="shield" size={14} /> Verified{me.class_year ? ` · ${classLabel(me.class_year)}` : ' student'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {[
          [String(stats?.trades ?? 0), stats?.trades === 1 ? 'trade' : 'trades', false],
          [stats?.rating ? `${stats.rating}` : '–', 'rating', false],
          [String(traded), 'kept from trash', true],
        ].map(([n, label, lime]) => (
          <div key={label as string} className="card" style={{ borderRadius: 20, textAlign: 'center', padding: 12, ...(lime ? { background: 'var(--lime)', boxShadow: 'none' } : {}) }}>
            <div className="display" style={{ fontSize: 22 }}>{n}{label === 'rating' && stats?.rating ? <span style={{ fontSize: 16 }}> ★</span> : null}</div>
            <div className="meta" style={lime ? { color: 'var(--text-2)' } : undefined}>{label}</div>
          </div>
        ))}
      </div>

      <div className="segmented">
        <button className={tab === 'closet' ? 'on' : ''} onClick={() => setTab('closet')}>Closet</button>
        <button className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>Saved</button>
        <button className={tab === 'trades' ? 'on' : ''} onClick={() => setTab('trades')}>Trades</button>
      </div>

      {tab !== 'trades' && (
        <div className="stack" style={{ gap: 8 }}>
          {rows.length === 0 && tab === 'saved' && <div className="empty">Nothing saved yet. Tap the heart on an item to save it.</div>}
          {rows.map((l) => (
            <Link key={l.id} href={`/item/${l.id}`} className="row"
              style={{ background: 'var(--surface)', borderRadius: 22, padding: '10px 12px', color: 'var(--ink)', boxShadow: 'var(--shadow)', gap: 12 }}>
              <ItemThumb item={l} size={44} />
              <span className="grow">
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{l.title}</span>
                <span className="meta">{l.tier}{l.wants ? ` · Wants: ${l.wants}` : ''}</span>
              </span>
              {tab === 'closet'
                ? <span className={`pill ${STATUS[l.status][1]}`} style={{ fontSize: 11 }}>{STATUS[l.status][0]}</span>
                : <span style={{ color: 'var(--pink)' }}><Icon name="heart" size={18} fill="currentColor" stroke={0} /></span>}
            </Link>
          ))}
        </div>
      )}

      {tab === 'trades' && (
        <div className="stack" style={{ gap: 8 }}>
          {!trades && <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>}
          {trades?.length === 0 && <div className="empty">No finished trades yet.</div>}
          {trades?.map((o) => {
            const { get, give } = sides(o, me.id);
            const other = o.from_user === me.id ? o.to : o.from;
            return (
              <Link key={o.id} href={`/trades/${o.id}`} className="card stack" style={{ gap: 6, color: 'var(--ink)' }}>
                <span className="meta">with {displayName(other)} · {new Date(o.updated_at ?? o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                <span className="row" style={{ gap: 8, fontSize: 14, fontWeight: 600 }}>
                  <span>{give?.title ?? 'Your item'}</span><span style={{ color: 'var(--pink)' }}>⇄</span><span>{get?.title ?? 'Their item'}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
      <Link href="/post" className="fab" aria-label="Add to your closet">
        <Icon name="plus" size={20} stroke={2.8} /> Add
      </Link>
    </main>
  );
}
