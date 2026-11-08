'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase, photoUrl } from '@/lib/supabase';
import { CATEGORY_ICON, CATEGORY_TINT, categoryLabel, displayName, friendlyError, type Listing, type Profile } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Avatar, Loading } from '@/components/ui';

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const router = useRouter();
  const [item, setItem] = useState<Listing | null>(null);
  const [owner, setOwner] = useState<Profile | null>(null);
  const [stats, setStats] = useState<{ rating: number | null; trades: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('listings').select('*').eq('id', id).maybeSingle();
      if (!data) { setMissing(true); return; }
      setItem(data as Listing);
      const [{ data: p }, { data: s }, { data: sv }] = await Promise.all([
        supabase.from('profiles').select('id,first_name,last_initial').eq('id', data.owner_id).single(),
        supabase.rpc('trader_stats', { p_user: data.owner_id }),
        supabase.from('saves').select('listing_id').eq('listing_id', id).maybeSingle(),
      ]);
      setOwner(p as Profile);
      setStats(s?.[0] ?? null);
      setSaved(!!sv);
    })();
  }, [id]);

  async function toggleSave() {
    setSaved(!saved);
    const res = saved
      ? await supabase.from('saves').delete().eq('listing_id', id)
      : await supabase.from('saves').insert({ listing_id: id });
    if (res.error) { setSaved(saved); setError(friendlyError(res.error)); }
  }

  async function removeListing() {
    if (!confirm('Take this listing down? Pending offers on it will stay in your inbox.')) return;
    const { error } = await supabase.from('listings').update({ status: 'removed' }).eq('id', id);
    if (error) setError(friendlyError(error)); else router.push('/me');
  }

  if (missing) {
    return (
      <main className="screen no-nav" style={{ textAlign: 'center', paddingTop: 120 }}>
        <h1 className="title-push">This item is gone</h1>
        <p className="body">It may have been traded or taken down.</p>
        <Link href="/" className="btn">Back to feed</Link>
      </main>
    );
  }
  if (!item) return <Loading />;

  const mine = item.owner_id === me?.id;
  const wants = (item.wants ?? '').split(',').map((w) => w.trim()).filter(Boolean);

  return (
    <>
      {/* Photo header */}
      <div className={CATEGORY_TINT[item.category]} style={{ height: 280, position: 'relative' }}>
        {item.photo_paths.length > 0 ? (
          <div style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', height: '100%' }}>
            {item.photo_paths.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p} src={photoUrl(p)} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover', flexShrink: 0, scrollSnapAlign: 'start' }} />
            ))}
          </div>
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={CATEGORY_ICON[item.category]} size={104} stroke={1.2} />
          </div>
        )}
        <div className="spread" style={{ position: 'absolute', top: 16, left: 20, right: 20 }}>
          <button className="icon-btn plain" aria-label="Back" onClick={() => router.back()}><Icon name="back" size={20} stroke={2.2} /></button>
          {!mine && (
            <div className="row" style={{ gap: 8 }}>
              <Link href={`/item/${item.id}/report`} className="icon-btn plain" aria-label="Report listing"><Icon name="flag" size={20} /></Link>
              <button className="icon-btn plain" aria-label={saved ? 'Unsave item' : 'Save item'} onClick={toggleSave}
                style={{ color: 'var(--pink)' }}>
                <Icon name="heart" size={20} fill={saved ? 'currentColor' : 'none'} />
              </button>
            </div>
          )}
        </div>
        {item.photo_paths.length > 1 && (
          <span className="pill white" style={{ position: 'absolute', bottom: 14, right: 20 }}>{item.photo_paths.length} photos · swipe</span>
        )}
      </div>

      <main className="screen no-nav" style={{ gap: 14, paddingTop: 20 }}>
        <div className="chips wrap">
          <span className="pill white">{categoryLabel(item.category)}</span>
          {item.condition && <span className="pill white">{item.condition}</span>}
          <span className="pill lime">Trade value: {item.tier}</span>
          {item.status !== 'active' && <span className="pill soft">{item.status === 'in_trade' ? 'In a trade' : item.status === 'traded' ? 'Traded' : 'Taken down'}</span>}
        </div>
        <h1 className="display" style={{ fontSize: 26 }}>{item.title}</h1>
        {item.description && <p className="body">{item.description}</p>}

        <div className="card row" style={{ padding: 12 }}>
          <Avatar profile={owner} size={44} solid="blue" />
          <div className="grow">
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {mine ? 'You' : displayName(owner)} <span className="meta-blue">✓ Penn verified</span>
            </div>
            <div className="meta">
              {stats?.rating ? `${stats.rating} rating · ` : 'New trader · '}
              {stats?.trades ?? 0} trade{stats?.trades === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        {wants.length > 0 && (
          <div>
            <p className="label">Open to</p>
            <div className="chips wrap">
              {wants.map((w) => <span key={w} className="pill white" style={{ fontSize: 13, padding: '6px 12px', fontWeight: 500 }}>{w}</span>)}
            </div>
          </div>
        )}

        <div className="row" style={{ background: 'var(--green-tint)', borderRadius: 12, padding: '10px 12px', fontSize: 13, gap: 8 }}>
          <Icon name="shield" size={18} />
          <span>Meet at a <b>Safe Spot</b>: staffed, public, daytime</span>
        </div>

        {error && <div className="alert">{error}</div>}
      </main>

      <div className="action-bar">
        {mine ? (
          item.status === 'active'
            ? <button className="btn outline" onClick={removeListing}>Take down listing</button>
            : <Link href="/trades" className="btn">See your trades</Link>
        ) : item.status === 'active' ? (
          <Link href={`/item/${item.id}/offer`} className="btn"><Icon name="swap" size={20} /> Propose a trade</Link>
        ) : (
          <button className="btn" disabled>No longer available</button>
        )}
      </div>
    </>
  );
}
