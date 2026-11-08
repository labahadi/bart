'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase, getSafeSpots, type SafeSpot } from '@/lib/supabase';
import { SWEETENERS, displayName, fairness, friendlyError, type Listing, type Profile } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Loading, PushHeader } from '@/components/ui';

export default function BuildOffer() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const router = useRouter();
  const [target, setTarget] = useState<Listing | null>(null);
  const [owner, setOwner] = useState<Profile | null>(null);
  const [closet, setCloset] = useState<Listing[] | null>(null);
  const [spots, setSpots] = useState<SafeSpot[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [sweet, setSweet] = useState<string[]>([]);
  const [spot, setSpot] = useState<string>('van-pelt');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!me) return;
    (async () => {
      const { data: t } = await supabase.from('listings').select('*').eq('id', id).single();
      if (!t) return;
      setTarget(t as Listing);
      const [{ data: p }, { data: mineData }, s] = await Promise.all([
        supabase.from('profiles').select('id,first_name,last_initial').eq('id', t.owner_id).single(),
        supabase.from('listings').select('*').eq('owner_id', me.id).eq('status', 'active').order('created_at', { ascending: false }),
        getSafeSpots(),
      ]);
      setOwner(p as Profile);
      setCloset((mineData ?? []) as Listing[]);
      setSpots(s);
      if (s.length) setSpot(s[0].id);
    })();
  }, [id, me]);

  if (!target || !closet) return <Loading />;

  const chosen = closet.filter((l) => picked.includes(l.id));
  const fair = fairness(target.tier, chosen.map((l) => l.tier), sweet.length);
  const ownerFirst = owner?.first_name ?? 'their';

  async function send() {
    setBusy(true); setError('');
    const { data, error } = await supabase.rpc('create_offer', {
      p_listing: id, p_my_items: picked, p_sweeteners: sweet, p_spot: spot,
    });
    setBusy(false);
    if (error) setError(friendlyError(error)); else router.replace(`/trades/${data}`);
  }

  return (
    <>
      <main className="screen no-nav">
        <PushHeader title="Propose a trade" subtitle={`For ${ownerFirst}'s ${target.title.toLowerCase()} (${target.tier})`} />

        <div>
          <p className="label">From your closet</p>
          {closet.length === 0 ? (
            <div className="card stack" style={{ gap: 10 }}>
              <p className="body">You need at least one item listed to trade. Post something you&apos;d give up, then come back.</p>
              <Link href="/post" className="btn pink small">Post an item</Link>
            </div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {closet.map((l) => {
                const on = picked.includes(l.id);
                return (
                  <button key={l.id} className={`check-row ${on ? 'on' : ''}`} aria-pressed={on}
                    onClick={() => setPicked(on ? picked.filter((x) => x !== l.id) : [...picked, l.id])}>
                    <span className="box">{on && <Icon name="check" size={14} stroke={3} />}</span>
                    <span className="row-title grow">{l.title}</span>
                    <span className="pill" style={{ background: 'var(--bg)' }}>{l.tier}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p className="label">Add a sweetener (optional)</p>
          <div className="chips wrap">
            {SWEETENERS.map((s) => {
              const on = sweet.includes(s);
              return (
                <button key={s} className={`chip ${on ? 'pink-on' : ''}`} style={{ height: 40 }}
                  onClick={() => setSweet(on ? sweet.filter((x) => x !== s) : [...sweet, s])}>{s}</button>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="spread" style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Fairness check</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: fair.color }}>{picked.length || sweet.length ? fair.label : '—'}</span>
          </div>
          <div style={{ height: 10, background: 'var(--border-soft)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${fair.fill * 100}%`, background: fair.color, borderRadius: 999, transition: 'width .2s' }} />
          </div>
          <p className="meta" style={{ margin: '8px 0 0' }}>Rough guide only. You two decide what&apos;s fair.</p>
        </div>

        <div>
          <p className="label">Suggest a safe meetup spot</p>
          <div className="chips wrap">
            {spots.map((s) => (
              <button key={s.id} className={`chip ${spot === s.id ? 'on' : ''}`} onClick={() => setSpot(s.id)}>{s.short_name}</button>
            ))}
          </div>
        </div>

        {error && <div className="alert"><Icon name="warning" size={18} />{error}</div>}
      </main>
      <div className="action-bar">
        <button className="btn" disabled={picked.length === 0 || busy} onClick={send}>
          <Icon name="send" size={18} /> {busy ? 'Sending…' : picked.length ? `Send offer to ${displayName(owner)}` : 'Pick something to offer'}
        </button>
      </div>
    </>
  );
}
