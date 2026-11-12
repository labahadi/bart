'use client';

// Someone else's profile: photo, name, trades, rating and what's in their closet.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { classLabel, displayName, friendlyError, type Listing, type Profile } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Avatar, ItemThumb, Loading, PushHeader } from '@/components/ui';

type Person = Profile & { avatar_path?: string | null; created_at?: string; class_year?: string | null };

export default function PersonProfile() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const router = useRouter();
  const [person, setPerson] = useState<Person | null | undefined>(undefined);
  const [closet, setCloset] = useState<Listing[]>([]);
  const [stats, setStats] = useState<{ rating: number | null; trades: number } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Your own name goes to your own profile
  useEffect(() => { if (me && id === me.id) router.replace('/me'); }, [me, id, router]);

  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', id).maybeSingle()
      .then(({ data }) => setPerson((data as Person | null) ?? null));
    supabase.from('listings').select('*').eq('owner_id', id).eq('status', 'active').order('created_at', { ascending: false })
      .then(({ data }) => setCloset((data ?? []) as Listing[]));
    supabase.rpc('trader_stats', { p_user: id }).then(({ data }) => setStats(data?.[0] ?? null));
    // Only shows people *you* blocked (nobody can see who blocked them)
    supabase.from('blocks').select('blocked_id').eq('blocked_id', id).then(({ data }) => setBlocked(!!data?.length));
  }, [id]);

  async function setBlock(on: boolean) {
    setBusy(true); setError('');
    const { error } = await supabase.rpc(on ? 'block_user' : 'unblock_user', { p_user: id });
    setBusy(false); setConfirm(false);
    if (error) { setError(friendlyError(error)); return; }
    setBlocked(on);
    if (on) setCloset([]);
    else supabase.from('listings').select('*').eq('owner_id', id).eq('status', 'active').order('created_at', { ascending: false })
      .then(({ data }) => setCloset((data ?? []) as Listing[]));
  }

  if (person === undefined) return <Loading />;

  if (!person) {
    return (
      <main className="screen no-nav">
        <PushHeader title="Profile" />
        <div className="empty">This person isn&apos;t on bart anymore.</div>
      </main>
    );
  }

  const since = person.created_at && new Date(person.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  return (
    <main className="screen no-nav">
      <PushHeader title={person.first_name ?? 'Profile'} />

      <div className="row" style={{ gap: 16 }}>
        <span style={{ display: 'inline-flex', borderRadius: 999, boxShadow: '0 0 0 3px #fff, 0 0 0 5px var(--blue)', margin: 5 }}>
          <Avatar profile={person} size={80} solid="blue" photo={person.avatar_path} />
        </span>
        <div className="stack" style={{ gap: 6 }}>
          <div className="display" style={{ fontSize: 24 }}>{displayName(person)}</div>
          {blocked
            ? <span className="pill soft" style={{ alignSelf: 'flex-start' }}>Blocked</span>
            : <span className="pill blue-tint" style={{ alignSelf: 'flex-start' }}><Icon name="shield" size={14} /> Verified student</span>}
          {(person.class_year || since) && (
            <span className="meta">{[classLabel(person.class_year), since && `On bart since ${since}`].filter(Boolean).join(' · ')}</span>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          [String(stats?.trades ?? 0), 'Trades'],
          [stats?.rating ? `${stats.rating} ★` : '–', 'Rating'],
          [String(closet.length), 'In closet'],
        ].map(([n, label]) => (
          <div key={label} className="card" style={{ borderRadius: 14, textAlign: 'center', padding: 12 }}>
            <div className="display" style={{ fontSize: 22 }}>{n}</div>
            <div className="meta">{label}</div>
          </div>
        ))}
      </div>

      <div>
        <p className="label">Closet</p>
        <div className="stack" style={{ gap: 8 }}>
          {closet.length === 0 && <div className="empty">Nothing up for trade right now.</div>}
          {closet.map((l) => (
            <Link key={l.id} href={`/item/${l.id}`} className="row"
              style={{ background: 'var(--surface)', borderRadius: 14, padding: '10px 12px', color: 'var(--ink)', border: '1px solid var(--border-soft)', gap: 12 }}>
              <ItemThumb item={l} size={44} />
              <span className="grow">
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{l.title}</span>
                <span className="meta">{l.tier}{l.wants ? ` · Wants: ${l.wants}` : ''}</span>
              </span>
              <Icon name="chevron" size={16} />
            </Link>
          ))}
        </div>
      </div>

      {error && <div className="alert"><Icon name="warning" size={18} />{error}</div>}
      {blocked ? (
        <button className="text-btn" style={{ alignSelf: 'center', color: 'var(--muted)' }} disabled={busy} onClick={() => setBlock(false)}>
          Unblock {person.first_name}
        </button>
      ) : confirm ? (
        <div className="card stack" style={{ gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Block {person.first_name}?</span>
          <span className="meta">Ends any open trade. They won&apos;t be told.</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn small" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }} onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn small" style={{ background: 'var(--error)' }} disabled={busy} onClick={() => setBlock(true)}>{busy ? 'Blocking…' : 'Block'}</button>
          </div>
        </div>
      ) : (
        <button className="text-btn" style={{ alignSelf: 'center', color: 'var(--error)' }} onClick={() => setConfirm(true)}>
          Block {person.first_name}
        </button>
      )}
    </main>
  );
}
