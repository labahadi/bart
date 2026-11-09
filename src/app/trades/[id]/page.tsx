'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase, getSafeSpots, type SafeSpot } from '@/lib/supabase';
import { uploadChatPhoto } from '@/lib/photos';
import { blockedAnywhere } from '@/lib/banned';
import { OFFER_SELECT, displayName, friendlyError, offerGives, sides, turnOf, type Offer } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { clash, freeTimes, type FreeTimes } from '@/lib/calendar';
import { nyParts } from '@/lib/time';
import { Icon } from '@/components/Icon';
import { Handoff } from '@/components/Handoff';
import { directionsUrl } from '@/lib/campus';
import { ShareTrade } from '@/components/ShareTrade';
import { useNotifications } from '@/components/Notifications';
import { SwapRow, statusPill } from '@/components/OfferCard';
import { ItemThumb, Loading } from '@/components/ui';

type Message = { id: string; sender_id: string; body: string | null; image_path: string | null; created_at: string };

const fmtMeet = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// "a, b and c"
const joinAnd = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

// Google Calendar link for the meetup (1 hour), written from the viewer's side
function calendarLink(o: Offer, myId: string, spot?: SafeSpot) {
  if (!o.meet_at) return '#';
  const start = new Date(o.meet_at);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const iSent = o.from_user === myId;
  const other = iSent ? o.to : o.from;
  const offered = [...o.items.map((i) => i.listing?.title).filter(Boolean) as string[], ...o.sweeteners.map((x) => x.toLowerCase())];
  const target = o.listing?.title ? [o.listing.title] : [];
  const [give, get] = iSent ? [offered, target] : [target, offered];
  const name = other ? `${other.first_name}${other.last_initial ? ` ${other.last_initial}.` : ''}` : 'a Penn student';
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `bart Exchange With ${name}`,
    dates: `${f(start)}/${f(end)}`,
    // The street address, so the calendar can map it (older meetups at a listed spot only have its name)
    location: o.meet_address || `${o.meet_custom || spot?.name || ''}, Philadelphia, PA 19104`,
    details: `Bring ${joinAnd(give) || 'your item'} to trade for ${joinAnd(get) || 'their item'}`,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

// Send a friend the plan: a short text plus a link to a page they can open without bart
async function shareWithFriend(o: Offer, spot?: SafeSpot) {
  const place = o.meet_custom || spot?.name || o.meet_address || '';
  const when = o.meet_at ? fmtMeet(o.meet_at) : '';
  const { data: token } = await supabase.rpc('share_meetup', { p_offer: o.id });
  const link = token ? `${window.location.origin}/m/${token}` : '';
  const text = `Meeting someone from bart: ${when} at ${place}${link ? `\n${link}` : ''}`;
  if (typeof navigator !== 'undefined' && navigator.share) navigator.share({ text }).catch(() => {});
  else window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
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
  const [details, setDetails] = useState(false);
  const [cal, setCal] = useState<FreeTimes | null>(null);
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

  // If I'm the one confirming, check the proposed time against my calendar (if linked)
  const toConfirm = offer && me && offer.status === 'accepted' && offer.meet_at && !offer.meet_confirmed_at && offer.meet_proposed_by !== me.id ? offer.meet_at : null;
  useEffect(() => {
    if (!toConfirm) { setCal(null); return; }
    const d = nyParts(new Date(toConfirm));
    freeTimes(id, `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`).then(setCal);
  }, [id, toConfirm]);

  async function confirmMeetup() {
    if (!offer?.meet_at) return;
    setBusy(true); setError('');
    const { error } = await supabase.rpc('confirm_meetup', { p_offer: id });
    if (error) { setBusy(false); setError(friendlyError(error)); return; }
    const d = nyParts(new Date(offer.meet_at));
    const where = offer.meet_custom ?? spots.find((x) => x.id === offer.meet_spot)?.name ?? '';
    await supabase.from('messages').insert({ offer_id: id, body: `Meetup confirmed: ${d.wd} ${d.m}/${d.d}, ${new Date(offer.meet_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} at ${where}` });
    setBusy(false);
    await loadOffer();
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
  const place = offer.meet_custom ?? spot?.short_name ?? '';
  const pending = !!offer.meet_at && !offer.meet_confirmed_at;
  const proposedByMe = offer.meet_proposed_by === me.id;
  const meetShort = offer.meet_at ? new Date(offer.meet_at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  const myClash = toConfirm ? clash(new Date(toConfirm), cal, otherName) : null;
  const confirmButtons = (
    <div className="row" style={{ gap: 8 }}>
      <Link href={`/trades/${id}/meetup`} className="btn small" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
        Suggest another time
      </Link>
      <button className="btn small" disabled={busy} onClick={confirmMeetup}>Confirm</button>
    </div>
  );
  const myTurn = offer.status === 'pending' && turnOf(offer) === me.id;
  const canChat = offer.status === 'pending' || offer.status === 'accepted';

  const { get, give } = sides(offer, me.id);
  const answer = (action: 'accept' | 'decline') => act(() => supabase.rpc('respond_offer', { p_offer: id, p_action: action }));
  const turnButtons = (
    <div className="row" style={{ gap: 8 }}>
      <button className="btn small" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }} disabled={busy}
        onClick={() => answer('decline')}>Decline</button>
      <Link href={`/trades/${id}/counter`} className="btn small" style={{ background: 'var(--surface)', color: 'var(--blue)', border: '1.5px solid var(--blue)' }}>
        Counter
      </Link>
      <button className="btn small" disabled={busy} onClick={() => answer('accept')}>Accept</button>
    </div>
  );

  // One line under the header, only when there's something to do next
  const strip =
    myTurn ? (
      <div key="turn" className="stack" style={{ gap: 8, padding: '10px 16px 12px', background: 'var(--surface)', borderBottom: '1px solid var(--border-soft)' }}>
        <span style={{ fontSize: 13 }}>
          <b>{offer.counter_count > 0 ? `${otherName} countered` : `${otherName} offers`}</b>{' '}
          {offer.items.map((i, n) => i.listing && (
            <span key={i.listing.id}>{n > 0 && ' + '}
              <Link href={`/item/${i.listing.id}`} style={{ color: 'var(--ink)', textDecoration: 'underline', textDecorationColor: 'var(--border)', textUnderlineOffset: 3 }}>{i.listing.title}</Link>
            </span>
          ))}
          {offer.sweeteners.map((sw) => <span key={sw}> + {sw.toLowerCase()}</span>)}
        </span>
        {turnButtons}
      </div>
    ) : offer.status === 'pending' ? (
      <button key="waiting" onClick={() => setDetails(true)} style={{ width: '100%', textAlign: 'left', borderWidth: '0 0 1px 0', borderStyle: 'solid', borderColor: 'var(--border-soft)', background: 'var(--bg)', padding: '10px 20px', fontSize: 13, color: 'var(--muted)' }}>
        Waiting for {otherName}
      </button>
    ) : offer.status === 'accepted' && pending && !proposedByMe ? (
      <div key="confirm" className="stack" style={{ gap: 8, padding: '10px 16px 12px', background: 'var(--surface)', borderBottom: '1px solid var(--border-soft)' }}>
        <span style={{ fontSize: 13 }}><b>{otherName} proposed</b> {meetShort} · {place}</span>
        {myClash && <span style={{ fontSize: 12, color: 'var(--warn)', fontWeight: 600 }}>{myClash}</span>}
        {confirmButtons}
      </div>
    ) : offer.status === 'accepted' && pending ? (
      <button key="proposed" onClick={() => setDetails(true)} style={{ width: '100%', textAlign: 'left', borderWidth: '0 0 1px 0', borderStyle: 'solid', borderColor: 'var(--border-soft)', background: 'var(--bg)', padding: '10px 20px', fontSize: 13, color: 'var(--muted)' }}>
        Waiting for {otherName} to confirm {meetShort} · {place}
      </button>
    ) : offer.status === 'accepted' ? (
      <button key="meetup" onClick={() => (offer.meet_at ? setDetails(true) : router.push(`/trades/${id}/meetup`))} className="spread"
        style={{ width: '100%', borderWidth: 0, background: 'var(--ink)', color: '#fff', padding: '10px 20px', fontSize: 13, fontWeight: 600 }}>
        <span className="row" style={{ gap: 8, minWidth: 0 }}>
          <span style={{ color: 'var(--lime)', display: 'inline-flex', flexShrink: 0 }}><Icon name="pin" size={16} /></span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {offer.meet_at ? `${meetShort} · ${place}` : 'Propose a meetup'}
          </span>
        </span>
        <span style={{ color: 'var(--lime)', whiteSpace: 'nowrap', flexShrink: 0 }}>{offer.meet_at ? 'Finish ›' : 'Propose ›'}</span>
      </button>
    ) : offer.status === 'completed' && !myRating ? (
      <button key="rate" onClick={() => setDetails(true)} className="spread"
        style={{ width: '100%', borderWidth: 0, background: 'var(--lime)', color: 'var(--ink)', padding: '10px 20px', fontSize: 13, fontWeight: 700 }}>
        <span>Swapped! Rate {otherName}</span><span>›</span>
      </button>
    ) : null;

  return (
    <>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border-soft)', padding: '12px 16px' }} className="row">
          <button className="icon-btn" aria-label="Back" onClick={() => router.push('/trades')}><Icon name="back" size={20} stroke={2.2} /></button>
          <button onClick={() => setDetails(true)} className="grow" aria-label="Trade details"
            style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--ink)', minWidth: 0, textAlign: 'left',
              fontFamily: 'var(--display)', fontSize: 18, fontWeight: 700, letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayName(other)}
          </button>
          <span className="row" style={{ gap: 4, flexShrink: 0 }}>
            {get ? <Link href={`/item/${get.id}`} aria-label={`See ${get.title}`}><ItemThumb item={get} size={32} radius={8} /></Link> : <ItemThumb item={null} size={32} radius={8} />}
            <span style={{ color: 'var(--pink)', display: 'inline-flex' }}><Icon name="swap" size={14} /></span>
            {give ? <Link href={`/item/${give.id}`} aria-label={`See ${give.title}`}><ItemThumb item={give} size={32} radius={8} /></Link> : <ItemThumb item={null} size={32} radius={8} />}
          </span>
        </header>
        {strip}
      </div>

      <main className="screen" style={{ paddingBottom: 100, gap: 12 }}>
        {/* Messages */}
        {messages.map((m) => {
          const mine = m.sender_id === me.id;
          const system = ['Countered: ', 'Meetup set: ', 'Meetup proposed: ', 'Meetup confirmed: '].some((p) => m.body?.startsWith(p));
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

        {error && <div className="alert">{error}</div>}
        <div ref={bottom} />
      </main>

      {/* Trade details: everything about the trade, so the chat stays just messages */}
      {details && (
        <div role="dialog" aria-label="Trade details" onClick={() => setDetails(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(22,22,26,0.35)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} className="stack"
            style={{ width: '100%', maxWidth: 430, maxHeight: '88dvh', overflowY: 'auto', background: 'var(--bg)', borderRadius: '24px 24px 0 0', padding: '12px 20px 28px', gap: 14 }}>
            <span style={{ width: 40, height: 5, borderRadius: 999, background: 'var(--dot-off)', alignSelf: 'center' }} />
            <div className="spread">
              <h2 className="title-push">Trade</h2>
              <button className="icon-btn" aria-label="Close" onClick={() => setDetails(false)}><Icon name="close" size={18} /></button>
            </div>

            <div className="card stack">
              <div className="spread">
                <span style={{ fontSize: 15, fontWeight: 700 }}>{displayName(other)}</span>
                {statusPill(offer, me.id)}
              </div>
              <SwapRow offer={offer} myId={me.id} />
              {myTurn && turnButtons}
              {offer.status === 'pending' && !myTurn && <p className="meta" style={{ margin: 0 }}>Waiting for {otherName}</p>}
            </div>

            {(offer.status === 'accepted' || offer.status === 'completed') && (
          <div style={{ background: 'var(--ink)', color: '#fff', borderRadius: 18, padding: 16 }} className="stack">
            <div className="row">
              <span style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--lime)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="pin" size={20} />
              </span>
              <div className="grow">
                <div style={{ fontSize: 15, fontWeight: 600 }}>{offer.meet_at ? fmtMeet(offer.meet_at) : 'No time yet'}</div>
                <div style={{ fontSize: 13, color: 'var(--dark-sub)' }}>
                  {offer.meet_custom ?? spot?.name ?? ''}
                  {offer.meet_walk_min != null && ` · ${offer.meet_walk_min} min walk`}
                </div>
                {offer.status === 'accepted' && offer.meet_at && (
                  <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color: pending ? 'var(--pink-bright)' : 'var(--lime)' }}>
                    {!pending ? 'Confirmed' : proposedByMe ? `Waiting for ${otherName} to confirm` : `${otherName} proposed this`}
                  </div>
                )}
              </div>
              {offer.status === 'accepted' && (
                <Link href={`/trades/${id}/meetup`} style={{ background: '#fff', color: 'var(--ink)', borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 600 }}>
                  {offer.meet_at ? 'Change' : 'Propose'}
                </Link>
              )}
            </div>
            {offer.status === 'accepted' && pending && !proposedByMe && (
              <div className="stack" style={{ gap: 8 }}>
                {myClash && <span style={{ fontSize: 12, color: 'var(--pink-bright)', fontWeight: 600 }}>{myClash}</span>}
                {confirmButtons}
              </div>
            )}
            {offer.meet_at && offer.status === 'accepted' && (
              <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                <a href={directionsUrl({ name: offer.meet_custom ?? spot?.name ?? '', lat: offer.meet_lat, lng: offer.meet_lng })} target="_blank" rel="noreferrer"
                  style={{ color: 'var(--lime)', fontSize: 13, fontWeight: 600 }}>Directions</a>
                {!pending && (
                  <a href={calendarLink(offer, me.id, spot)} target="_blank" rel="noreferrer"
                    style={{ color: 'var(--pink-bright)', fontSize: 13, fontWeight: 600 }}>Add to calendar</a>
                )}
                <button onClick={() => shareWithFriend(offer, spot)}
                  style={{ background: 'none', border: 'none', padding: 0, color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  Share with a friend
                </button>
              </div>
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

            <Link href={`/trades/${id}/report`} className="row" style={{ gap: 8, color: 'var(--muted)', fontSize: 13, fontWeight: 600, alignSelf: 'flex-start' }}>
              <Icon name="flag" size={16} /> Report chat
            </Link>
          </div>
        </div>
      )}

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
