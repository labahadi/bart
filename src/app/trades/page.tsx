'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { OFFER_SELECT, displayName, friendlyError, initial, offerGives, sides, turnOf, type Offer } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { BottomNav, ItemThumb } from '@/components/ui';
import { useNotifications } from '@/components/Notifications';

type Last = { offer_id: string; sender_id: string; body: string | null; image_path: string | null; created_at: string };

const when = (iso: string) => {
  const d = new Date(iso);
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return 'now';
  if (mins < 60) return `${Math.round(mins)}m`;
  if (mins < 1440) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (mins < 7 * 1440) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Chats: one list of conversations, newest first. Anything waiting on you sits at the top.
export default function Chats() {
  const { me } = useAuth();
  const { unreadRefs } = useNotifications();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [last, setLast] = useState<Record<string, Last>>({});
  const [showPast, setShowPast] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!me) return;
    const { data, error } = await supabase.from('offers').select(OFFER_SELECT)
      .or(`from_user.eq.${me.id},to_user.eq.${me.id}`).order('created_at', { ascending: false });
    if (error) { setError(error.message); return; }
    const list = data as unknown as Offer[];
    setOffers(list);
    // Latest message in each chat
    if (list.length) {
      const { data: msgs } = await supabase.from('messages').select('offer_id,sender_id,body,image_path,created_at')
        .in('offer_id', list.map((o) => o.id)).order('created_at', { ascending: false }).limit(300);
      const map: Record<string, Last> = {};
      (msgs ?? []).forEach((m) => { if (!map[m.offer_id]) map[m.offer_id] = m as Last; });
      setLast(map);
    }
  }, [me]);

  useEffect(() => {
    load();
    const ch = supabase.channel('my-chats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'offers' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  async function respond(id: string, action: 'accept' | 'decline') {
    setBusyId(id); setError('');
    const { error } = await supabase.rpc('respond_offer', { p_offer: id, p_action: action });
    setBusyId(null);
    if (error) setError(friendlyError(error));
    load();
  }

  if (!me) return null;

  const activity = (o: Offer) => {
    const t = [o.created_at, o.updated_at, last[o.id]?.created_at].filter(Boolean) as string[];
    return t.sort().at(-1)!;
  };
  const sorted = [...(offers ?? [])].sort((a, b) => activity(b).localeCompare(activity(a)));
  const yourTurn = sorted.filter((o) => o.status === 'pending' && turnOf(o) === me.id);
  const active = sorted.filter((o) => (o.status === 'pending' && turnOf(o) !== me.id) || o.status === 'accepted');
  const past = sorted.filter((o) => o.status === 'completed' || o.status === 'declined' || o.status === 'cancelled');

  // The grey line under the name: last message, or what's happening
  function preview(o: Offer) {
    const m = last[o.id];
    const otherFirst = (o.from_user === me!.id ? o.to : o.from)?.first_name ?? 'They';
    if (m && !m.body?.startsWith('Countered: ') && !m.body?.startsWith('Meetup set: ')) {
      const who = m.sender_id === me!.id ? 'You: ' : '';
      return who + (m.body ?? 'Photo');
    }
    switch (o.status) {
      case 'pending': return turnOf(o) === me!.id
        ? (o.counter_count > 0 ? `${otherFirst} countered: ${offerGives(o)}` : `Offers ${offerGives(o)}`)
        : `Waiting for ${otherFirst}`;
      case 'accepted': return o.meet_at ? 'Meetup set' : 'Accepted · set a meetup';
      case 'completed': return 'Swapped';
      case 'declined': return 'Declined';
      default: return 'Cancelled';
    }
  }

  function Row({ o }: { o: Offer }) {
    const other = o.from_user === me!.id ? o.to : o.from;
    const { get } = sides(o, me!.id);
    const unread = unreadRefs.has(o.id);
    return (
      <Link href={`/trades/${o.id}`} className="row" style={{ padding: '10px 4px', color: 'var(--ink)', gap: 12 }}>
        <span style={{ position: 'relative', flexShrink: 0 }}>
          <ItemThumb item={get} size={52} radius={14} />
          <span style={{ position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, borderRadius: 999, background: 'var(--blue)', color: '#fff',
            fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg)' }}>
            {initial(other)}
          </span>
        </span>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="spread">
            <span style={{ fontSize: 15, fontWeight: unread ? 700 : 600 }}>{displayName(other)}</span>
            <span className="meta" style={{ flexShrink: 0 }}>{when(activity(o))}</span>
          </span>
          <span className="spread" style={{ gap: 8 }}>
            <span style={{ fontSize: 13, color: unread ? 'var(--ink)' : 'var(--muted)', fontWeight: unread ? 600 : 400,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview(o)}</span>
            {unread && <span style={{ width: 9, height: 9, borderRadius: 999, background: 'var(--pink)', flexShrink: 0 }} />}
          </span>
        </span>
      </Link>
    );
  }

  return (
    <>
      <main className="screen">
        <h1 className="title-tab">Chats</h1>
        {error && <div className="alert">{error}</div>}
        {!offers && <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>}
        {offers && offers.length === 0 && <div className="empty"><Link href="/">Find something to trade</Link></div>}

        {yourTurn.length > 0 && (
          <div className="stack" style={{ gap: 10 }}>
            <p className="label" style={{ margin: 0 }}>Your turn</p>
            {yourTurn.map((o) => (
              <div key={o.id} className="card" style={{ padding: '6px 12px 12px' }}>
                <Row o={o} />
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn small" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                    disabled={busyId === o.id} onClick={() => respond(o.id, 'decline')}>Decline</button>
                  <Link href={`/trades/${o.id}/counter`} className="btn small" style={{ background: 'var(--surface)', color: 'var(--blue)', border: '1.5px solid var(--blue)' }}>Counter</Link>
                  <button className="btn small" disabled={busyId === o.id} onClick={() => respond(o.id, 'accept')}>Accept</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {active.length > 0 && (
          <div className="stack" style={{ gap: 0 }}>
            {yourTurn.length > 0 && <p className="label" style={{ margin: '4px 0 2px' }}>Chats</p>}
            {active.map((o) => <Row key={o.id} o={o} />)}
          </div>
        )}

        {past.length > 0 && (
          <div className="stack" style={{ gap: 0 }}>
            <button className="text-btn" style={{ alignSelf: 'flex-start', padding: '8px 0', color: 'var(--muted)' }} onClick={() => setShowPast(!showPast)}>
              {showPast ? 'Hide past trades' : `Past trades (${past.length})`}
            </button>
            {showPast && past.map((o) => <Row key={o.id} o={o} />)}
          </div>
        )}
      </main>
      <BottomNav />
    </>
  );
}
