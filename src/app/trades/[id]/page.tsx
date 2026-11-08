'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase, getSafeSpots, type SafeSpot } from '@/lib/supabase';
import { uploadChatPhoto } from '@/lib/photos';
import { blockedAnywhere } from '@/lib/banned';
import { OFFER_SELECT, displayName, friendlyError, offerGives, turnOf, type Offer } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Handoff } from '@/components/Handoff';
import { ShareTrade } from '@/components/ShareTrade';
import { useNotifications } from '@/components/Notifications';
import { SwapRow, statusPill } from '@/components/OfferCard';
import { Avatar, Loading } from '@/components/ui';

type Message = { id: string; sender_id: string; body: string | null; image_path: string | null; created_at: string };

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
  const { unreadRefs, markRead } = useNotifications();
  useEffect(() => { if (unreadRefs.has(id)) markRead({ ref: id }); }, [unreadRefs, id, markRead]);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [spots, setSpots] = useState<SafeSpot[]>([]);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadOffer = useCallback(async () => {
    const { data } = await supabase.from('offers').select(OFFER_SELECT).eq('id', id).maybeSingle();
    if (!data) setMissing(true); else setOffer(data as unknown as Offer);
  }, [id]);

  useEffect(() => {
    loadOffer();
    getSafeSpots().then(setSpots);
    supabase.from('messages').select('id,sender_id,body,image_path,created_at').eq('offer_id', id).order('created_at')
      .then(({ data }) => setMessages((data ?? []) as Message[]));
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

  // Chat photos are private: get short-lived links for any we haven't loaded yet
  useEffect(() => {
    const need = messages.map((m) => m.image_path).filter((p): p is string => !!p && !photoUrls[p]);
    if (!need.length) return;
    supabase.storage.from('chat-photos').createSignedUrls(need, 60 * 60).then(({ data }) => {
      if (!data) return;
      setPhotoUrls((u) => ({ ...u, ...Object.fromEntries(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl])) }));
    });
  }, [messages, photoUrls]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  async function postMessage(fields: { body?: string; image_path?: string }) {
    if (fields.body && blockedAnywhere(fields.body)) { setError("That message includes words that aren't allowed on bart."); return false; }
    setError('');
    const { data, error } = await supabase.from('messages').insert({ offer_id: id, ...fields })
      .select('id,sender_id,body,image_path,created_at').single();
    if (error) {
      setError(/row-level security/i.test(error.message) ? "That message includes words that aren't allowed on bart." : friendlyError(error));
      return false;
    }
    setMessages((m) => (m.some((x) => x.id === data.id) ? m : [...m, data as Message]));
    return true;
  }

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
    if (!(await postMessage({ body }))) setText(body);
  }

  async function sendPhoto(file: File | undefined) {
    if (!file) return;
    setSendingPhoto(true); setError('');
    try {
      const msg = await uploadChatPhoto(id, file);
      setMessages((m) => (m.some((x) => x.id === msg.id) ? m : [...m, msg as Message]));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSendingPhoto(false);
      if (fileInput.current) fileInput.current.value = '';
    }
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
  const myTurn = offer.status === 'pending' && turnOf(offer) === me.id;
  const canChat = offer.status === 'pending' || offer.status === 'accepted';

  return (
    <>
      <header style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)', borderBottom: '1px solid var(--border-soft)', padding: '12px 20px' }}
        className="row">
        <button className="icon-btn" aria-label="Back" onClick={() => router.push('/trades')}><Icon name="back" size={20} stroke={2.2} /></button>
        <Avatar profile={other} size={40} solid="blue" />
        <div className="grow" style={{ fontFamily: 'var(--display)', fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>{displayName(other)}</div>
        <Link href={`/trades/${id}/report`} className="icon-btn plain" aria-label="Report this chat" style={{ background: 'transparent' }}>
          <Icon name="flag" size={20} />
        </Link>
      </header>

      <main className="screen" style={{ paddingBottom: 100, gap: 12 }}>
        {/* Pinned offer */}
        <div className="card stack">
          <div className="spread">
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: 'var(--muted)' }}>
              OFFER
            </span>
            {statusPill(offer, me.id)}
          </div>
          <SwapRow offer={offer} myId={me.id} />
          {myTurn && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn small" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }} disabled={busy}
                onClick={() => act(() => supabase.rpc('respond_offer', { p_offer: id, p_action: 'decline' }))}>Decline</button>
              <Link href={`/trades/${id}/counter`} className="btn small" style={{ background: 'var(--surface)', color: 'var(--blue)', border: '1.5px solid var(--blue)' }}>
                Counter
              </Link>
              <button className="btn small" disabled={busy}
                onClick={() => act(() => supabase.rpc('respond_offer', { p_offer: id, p_action: 'accept' }))}>Accept</button>
            </div>
          )}
          {offer.status === 'pending' && !myTurn && (
            <p className="meta" style={{ margin: 0 }}>Waiting for {otherName}</p>
          )}
        </div>

        {/* Messages */}
        {messages.map((m) => {
          const mine = m.sender_id === me.id;
          const system = m.body?.startsWith('Countered: ') || m.body?.startsWith('Meetup set: ');
          if (system) {
            return <p key={m.id} className="meta" style={{ textAlign: 'center', margin: '4px 0' }}>{mine ? 'You' : otherName} · {m.body}</p>;
          }
          return (
            <div key={m.id} className={`bubble ${mine ? 'out' : 'in'}`} style={m.image_path ? { padding: 4 } : undefined}>
              {m.image_path && (photoUrls[m.image_path]
                ? (
                  <a href={photoUrls[m.image_path]} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoUrls[m.image_path]} alt="Photo" style={{ width: 220, maxHeight: 280, objectFit: 'cover', borderRadius: 14 }} />
                  </a>
                )
                : <div style={{ width: 220, height: 160, borderRadius: 14, background: 'var(--border-soft)' }} />)}
              {m.body && <div style={m.image_path ? { padding: '6px 10px 4px' } : undefined}>{m.body}</div>}
            </div>
          );
        })}
        {sendingPhoto && <div className="bubble out" style={{ opacity: 0.6 }}>Sending photo…</div>}

        {/* Meetup + finishing */}
        {(offer.status === 'accepted' || offer.status === 'completed') && (
          <div style={{ background: 'var(--ink)', color: '#fff', borderRadius: 18, padding: 16 }} className="stack">
            <div className="row">
              <span style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--lime)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="pin" size={20} />
              </span>
              <div className="grow">
                <div style={{ fontSize: 15, fontWeight: 600 }}>{offer.meet_at ? fmtMeet(offer.meet_at) : 'No time yet'}</div>
                <div style={{ fontSize: 13, color: 'var(--dark-sub)' }}>{spot?.name ?? ''}</div>
              </div>
              {offer.status === 'accepted' && (
                <Link href={`/trades/${id}/meetup`} style={{ background: '#fff', color: 'var(--ink)', borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 600 }}>
                  {offer.meet_at ? 'Edit' : 'Set'}
                </Link>
              )}
            </div>
            {offer.meet_at && offer.status === 'accepted' && (
              <a href={calendarLink(offer, spot)} target="_blank" rel="noreferrer"
                style={{ color: 'var(--pink-bright)', fontSize: 13, fontWeight: 600 }}>Add to calendar</a>
            )}
            {offer.status === 'accepted' && (
              <div style={{ borderTop: '1px solid #3A3A44', paddingTop: 12 }}>
                <Handoff offerId={id} otherName={otherName} onDone={loadOffer} />
              </div>
            )}
            {offer.status === 'completed' && (
              <div className="stack" style={{ gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>Rate {otherName}</div>
                <div className="row" style={{ gap: 8 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => rate(n)}
                      style={{ width: 44, height: 44, borderRadius: 10, border: '1px solid var(--text-2)', background: 'transparent', fontSize: 20,
                        color: myRating && n <= myRating ? 'var(--pink-bright)' : '#6B6B76' }}>★</button>
                  ))}
                </div>
                <ShareTrade offerId={id} />
              </div>
            )}
          </div>
        )}

        {error && <div className="alert">{error}</div>}
        <div ref={bottom} />
      </main>

      {canChat && (
        <div className="action-bar" style={{ padding: '10px 16px 22px', alignItems: 'center' }}>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => sendPhoto(e.target.files?.[0])} />
          <button className="icon-btn" aria-label="Send a photo" disabled={sendingPhoto} onClick={() => fileInput.current?.click()}
            style={{ width: 46, height: 46, border: 'none', background: 'var(--bg)' }}>
            <Icon name="camera" size={22} />
          </button>
          <input className="chat-input" placeholder={`Message ${otherName}`} value={text} maxLength={1000}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="round-send" aria-label="Send" disabled={!text.trim()} onClick={send}><Icon name="send" size={20} /></button>
        </div>
      )}
    </>
  );
}
