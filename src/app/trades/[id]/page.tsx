'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase, getSafeSpots, type SafeSpot } from '@/lib/supabase';
import { OFFER_SELECT, displayName, friendlyError, offerGives, type Offer } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { SwapRow, statusPill } from '@/components/OfferCard';
import { Avatar, Loading } from '@/components/ui';

type Message = { id: string; sender_id: string; body: string; created_at: string };

const fmtMeet = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Google Calendar link for the meetup (1 hour)
function calendarLink(o: Offer, spot?: SafeSpot) {
  if (!o.meet_at) return '#';
  const start = new Date(o.meet_at);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const p = new URLSearchParams({
    action: 'TEMPLATE', text: `bart: ${o.listing?.title ?? 'trade'}`, dates: `${f(start)}/${f(end)}`,
    location: spot?.name ?? '', details: `Trade: ${offerGives(o)} for ${o.listing?.title ?? ''}`,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export default function TradeChat() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const router = useRouter();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [spots, setSpots] = useState<SafeSpot[]>([]);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const loadOffer = useCallback(async () => {
    const { data } = await supabase.from('offers').select(OFFER_SELECT).eq('id', id).maybeSingle();
    if (!data) setMissing(true); else setOffer(data as unknown as Offer);
  }, [id]);

  useEffect(() => {
    loadOffer();
    getSafeSpots().then(setSpots);
    supabase.from('messages').select('id,sender_id,body,created_at').eq('offer_id', id).order('created_at')
      .then(({ data }) => setMessages(data ?? []));
    supabase.from('ratings').select('stars').eq('offer_id', id).maybeSingle()
      .then(({ data }) => setMyRating(data?.stars ?? null));

    // Live updates: new messages and changes to the trade
    const ch = supabase.channel(`trade-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `offer_id=eq.${id}` },
        (payload) => setMessages((m) => (m.some((x) => x.id === payload.new.id) ? m : [...m, payload.new as Message])))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'offers', filter: `id=eq.${id}` }, () => loadOffer())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, loadOffer]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
    const { data, error } = await supabase.from('messages').insert({ offer_id: id, body }).select('id,sender_id,body,created_at').single();
    if (error) { setError(friendlyError(error)); setText(body); return; }
    setMessages((m) => (m.some((x) => x.id === data.id) ? m : [...m, data]));
  }

  async function act(fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true); setError('');
    const { error } = await fn();
    setBusy(false);
    if (error) setError(friendlyError(error));
    await loadOffer();
  }

  async function rate(stars: number) {
    setMyRating(stars);
    const { error } = await supabase.rpc('rate_trade', { p_offer: id, p_stars: stars });
    if (error) setError(friendlyError(error));
  }

  if (missing) {
    return (
      <main className="screen no-nav" style={{ textAlign: 'center', paddingTop: 120 }}>
        <h1 className="title-push">Trade not found</h1>
        <Link href="/trades" className="btn">Back to trades</Link>
      </main>
    );
  }
  if (!offer || !me) return <Loading />;

  const iSent = offer.from_user === me.id;
  const other = iSent ? offer.to : offer.from;
  const otherName = other?.first_name ?? 'them';
  const spot = spots.find((s) => s.id === offer.meet_spot);
  const iConfirmed = iSent ? offer.from_confirmed : offer.to_confirmed;
  const theyConfirmed = iSent ? offer.to_confirmed : offer.from_confirmed;
  const canChat = offer.status === 'pending' || offer.status === 'accepted';

  return (
    <>
      <header style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)', borderBottom: '1px solid var(--border-soft)', padding: '12px 20px' }}
        className="row">
        <button className="icon-btn" aria-label="Back" onClick={() => router.push('/trades')}><Icon name="back" size={20} stroke={2.2} /></button>
        <Avatar profile={other} size={40} solid="blue" />
        <div className="grow">
          <div style={{ fontSize: 16, fontWeight: 600 }}>{displayName(other)}</div>
          <div className="meta" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {offer.listing?.title} ⇄ {offerGives(offer)}
          </div>
        </div>
      </header>

      <main className="screen" style={{ paddingBottom: 100, gap: 12 }}>
        {/* Pinned offer */}
        <div className="card stack">
          <div className="spread">
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: 'var(--muted)' }}>{iSent ? 'YOUR OFFER' : 'THEIR OFFER'}</span>
            {statusPill(offer, me.id)}
          </div>
          <SwapRow offer={offer} myId={me.id} />
          {offer.status === 'pending' && !iSent && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn small" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }} disabled={busy}
                onClick={() => act(() => supabase.rpc('respond_offer', { p_offer: id, p_action: 'decline' }))}>Decline</button>
              <button className="btn small" disabled={busy}
                onClick={() => act(() => supabase.rpc('respond_offer', { p_offer: id, p_action: 'accept' }))}>Accept</button>
            </div>
          )}
          {offer.status === 'pending' && iSent && (
            <p className="meta" style={{ margin: 0 }}>Waiting for {otherName} to accept. You can message them meanwhile.</p>
          )}
        </div>

        {/* Messages */}
        {messages.length === 0 && canChat && (
          <p className="meta" style={{ textAlign: 'center', margin: '8px 0' }}>Say hi and agree on the details.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.sender_id === me.id ? 'out' : 'in'}`}>{m.body}</div>
        ))}

        {/* Meetup + completion */}
        {(offer.status === 'accepted' || offer.status === 'completed') && (
          <div style={{ background: 'var(--ink)', color: '#fff', borderRadius: 18, padding: 16 }} className="stack">
            <div className="row">
              <span style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--lime)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="pin" size={20} />
              </span>
              <div className="grow">
                <div style={{ fontSize: 15, fontWeight: 600 }}>{offer.meet_at ? 'Meetup set' : 'Set the meetup'}</div>
                <div style={{ fontSize: 13, color: 'var(--dark-sub)' }}>
                  {offer.meet_at ? `${fmtMeet(offer.meet_at)} · ${spot?.name ?? ''}` : `Suggested: ${spot?.name ?? 'pick a Safe Spot'}`}
                </div>
              </div>
              {offer.status === 'accepted' && (
                <Link href={`/trades/${id}/meetup`} style={{ background: '#fff', color: 'var(--ink)', borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 600 }}>
                  {offer.meet_at ? 'Edit' : 'Pick time'}
                </Link>
              )}
            </div>
            {offer.meet_at && offer.status === 'accepted' && (
              <a href={calendarLink(offer, spot)} target="_blank" rel="noreferrer"
                style={{ color: 'var(--pink-bright)', fontSize: 13, fontWeight: 600 }}>Add to Google Calendar ›</a>
            )}
            {offer.status === 'accepted' && !iConfirmed && (
              <button className="btn lime" style={{ height: 46 }} disabled={busy}
                onClick={() => act(() => supabase.rpc('confirm_complete', { p_offer: id }))}>Mark trade complete</button>
            )}
            {iConfirmed && offer.status !== 'completed' && !theyConfirmed && (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--dark-sub)' }}>You marked it complete. Waiting for {otherName} to confirm.</p>
            )}
            {iConfirmed && (
              <div className="stack" style={{ gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{offer.status === 'completed' ? 'Swapped! ' : ''}How was {otherName}?</div>
                <div className="row" style={{ gap: 8 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => rate(n)}
                      style={{ width: 44, height: 44, borderRadius: 10, border: '1px solid var(--text-2)', background: 'transparent', fontSize: 20,
                        color: myRating && n <= myRating ? 'var(--pink-bright)' : '#6B6B76' }}>★</button>
                  ))}
                </div>
                {myRating && <span style={{ fontSize: 12, color: 'var(--dark-sub)' }}>Thanks. Ratings build trust for everyone.</span>}
              </div>
            )}
          </div>
        )}

        {error && <div className="alert">{error}</div>}
        <div ref={bottom} />
      </main>

      {canChat && (
        <div className="action-bar" style={{ padding: '10px 16px 22px', alignItems: 'center' }}>
          <input className="chat-input" placeholder={`Message ${otherName}`} value={text} maxLength={1000}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="round-send" aria-label="Send" disabled={!text.trim()} onClick={send}><Icon name="send" size={20} /></button>
        </div>
      )}
    </>
  );
}
