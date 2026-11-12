'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { bannedMatch } from '@/lib/banned';
import { screenText } from '@/lib/screen';
import { friendlyError, type Listing, type Profile } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Avatar, BottomNav, ProfileLink } from '@/components/ui';
import { useNotifications } from '@/components/Notifications';

// Wanted: what people on campus are looking for (this used to be the ISO board on Campus).
// Same tables as before: iso_posts ("Looking for" posts) and iso_responses ("I have it").

type Iso = { id: string; author_id: string; want: string; can_offer: string | null; open: boolean; created_at: string; author: Profile | null };
type IsoResponse = { iso_id: string; responder_id: string; listing: { id: string; title: string } | null; responder: Profile | null };

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

// Loose word match between a request and your closet: "desk lamp" finds "Clip-on desk lamp"
const STOP = new Set(['the', 'and', 'for', 'with', 'any', 'some', 'size', 'new', 'used', 'one', 'pair', 'like', 'need', 'want', 'looking', 'good']);
const words = (s: string) => new Set(
  s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => (w.length > 3 ? w.replace(/s$/, '') : w)),
);
function matchFor(want: string, closet: Listing[]) {
  const w = words(want);
  return closet.find((l) => [...words(l.title)].some((t) => w.has(t))) ?? null;
}

const DISMISS_KEY = 'bart-wanted-dismissed';
const readDismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]'); } catch { return []; } };

export default function Wanted() {
  const { me } = useAuth();
  const { unread, markRead } = useNotifications();
  const [tab, setTab] = useState<'yours' | 'all'>('yours');
  const [isos, setIsos] = useState<Iso[] | null>(null);
  const [responses, setResponses] = useState<IsoResponse[]>([]);
  const [closet, setCloset] = useState<Listing[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [composing, setComposing] = useState(false);
  const [want, setWant] = useState('');
  const [canOffer, setCanOffer] = useState('');
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Opened from Find's "Ask" button: start a request, filled in with what they searched for
  useEffect(() => {
    setDismissed(readDismissed());
    const ask = new URLSearchParams(window.location.search).get('ask');
    if (ask) {
      setComposing(true); setTab('all');
      if (ask !== '1') setWant(ask.slice(0, 80));
      window.history.replaceState(null, '', '/wanted');
    }
  }, []);

  // Seeing Wanted clears the "someone has it" badges
  const isoUnread = unread.filter((n) => n.kind === 'iso');
  useEffect(() => {
    isoUnread.forEach((n) => { if (n.ref) markRead({ ref: n.ref }); });
  }, [isoUnread.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!me) return;
    const [{ data: i, error }, { data: r }, { data: c }] = await Promise.all([
      supabase.from('iso_posts').select('*, author:profiles!iso_posts_author_id_fkey(id,first_name,last_initial,avatar_path)').eq('open', true)
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('iso_responses').select('iso_id,responder_id,listing:listings!iso_responses_listing_id_fkey(id,title),responder:profiles!iso_responses_responder_id_fkey(id,first_name,last_initial,avatar_path)'),
      supabase.from('listings').select('*').eq('owner_id', me.id).eq('status', 'active').order('created_at', { ascending: false }),
    ]);
    if (error) setError(friendlyError(error));
    setIsos((i ?? []) as unknown as Iso[]);
    setResponses((r ?? []) as unknown as IsoResponse[]);
    setCloset((c ?? []) as Listing[]);
  }, [me]);

  useEffect(() => { load(); }, [load]);

  // Requests from other people that something in your closet could answer
  const matches = useMemo(() => {
    if (!isos || !me) return [];
    return isos
      .filter((i) => i.author_id !== me.id && !dismissed.includes(i.id))
      .map((i) => ({ iso: i, item: matchFor(i.want, closet), answer: responses.find((r) => r.iso_id === i.id && r.responder_id === me.id) }))
      .filter((m) => m.item || m.answer);
  }, [isos, closet, responses, dismissed, me]);
  const openMatches = matches.filter((m) => !m.answer).length;

  const bad = bannedMatch(want) ?? bannedMatch(canOffer);

  async function post() {
    setError('');
    const problem = await screenText(want, canOffer);
    if (problem) { setError(problem); return; }
    const { error } = await supabase.from('iso_posts').insert({ want: want.trim(), can_offer: canOffer.trim() || null });
    if (error) { setError(friendlyError(error)); return; }
    setWant(''); setCanOffer(''); setComposing(false); load();
  }

  async function respond(isoId: string, listingId: string) {
    setError('');
    const { error } = await supabase.from('iso_responses').insert({ iso_id: isoId, listing_id: listingId });
    if (error && !/duplicate/i.test(error.message)) { setError(friendlyError(error)); return; }
    setPicking(null); load();
  }

  async function close(isoId: string) {
    await supabase.from('iso_posts').update({ open: false }).eq('id', isoId);
    load();
  }

  function notNow(isoId: string) {
    const next = [...dismissed, isoId];
    setDismissed(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next.slice(-200))); } catch {}
  }

  const q = query.trim().toLowerCase();
  const all = (isos ?? [])
    .filter((i) => !q || `${i.want} ${i.can_offer ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => Number(b.author_id === me?.id) - Number(a.author_id === me?.id));

  return (
    <>
      <main className="screen">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 className="title-tab">Wanted</h1>
            <p className="subtitle">What people on campus are looking for</p>
          </div>
          <button className="btn pink small" style={{ width: 'auto', padding: '0 14px', height: 40, borderRadius: 999, marginTop: 4 }}
            onClick={() => { setComposing(true); setTab('all'); }}>
            <Icon name="plus" size={16} stroke={2.6} /> Ask
          </button>
        </div>

        <div className="segmented">
          <button className={tab === 'yours' ? 'on' : ''} onClick={() => setTab('yours')}>
            Wants your stuff{openMatches ? ` (${openMatches})` : ''}
          </button>
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All requests</button>
        </div>

        {error && <div className="alert">{error}</div>}
        {(!isos || !me) && <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>}

        {isos && me && tab === 'yours' && (
          <>
            {matches.length > 0 && <p className="body" style={{ fontSize: 13 }}>These people want something already in your closet.</p>}
            {matches.length === 0 && (
              <div className="empty">
                {closet.length
                  ? 'Nobody is asking for anything in your closet right now. We\'ll show requests here when they match.'
                  : <>Add things to your closet and we&apos;ll show who wants them. <Link href="/post">Add to your closet</Link></>}
              </div>
            )}
            {matches.map(({ iso, item, answer }) => (
              <div key={iso.id} className="card big stack" style={{ gap: 10 }}>
                <div className="row" style={{ gap: 10 }}>
                  <ProfileLink id={iso.author_id}><Avatar profile={iso.author} size={36} /></ProfileLink>
                  <span className="grow" style={{ fontSize: 14, lineHeight: 1.35 }}>
                    <ProfileLink id={iso.author_id}><b>{iso.author?.first_name ?? 'Someone'}</b></ProfileLink> is looking for <b>{iso.want}</b>
                  </span>
                  <span className="meta">{ago(iso.created_at)}</span>
                </div>
                <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
                  <div className="swap-box" style={{ background: 'var(--lime)' }}>
                    <div className="k" style={{ color: 'var(--ink)' }}>You have</div>
                    <div className="v">{answer?.listing?.title ?? item?.title}</div>
                  </div>
                  <div className="swap-box" style={{ background: 'var(--bg)' }}>
                    <div className="k">They can give</div>
                    <div className="v">{iso.can_offer || 'Open to offers'}</div>
                  </div>
                </div>
                {answer ? (
                  <span className="pill green-tint" style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: 13 }}>
                    ✓ Sent to {iso.author?.first_name ?? 'them'}
                  </span>
                ) : item && (
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn small outline" style={{ width: 'auto', padding: '0 16px', border: '1px solid var(--border)' }} onClick={() => notNow(iso.id)}>Not now</button>
                    <button className="btn small pink grow" onClick={() => respond(iso.id, item.id)}>Offer my {item.title}</button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {isos && me && tab === 'all' && (
          <>
            {composing && (
              <div className="card stack" style={{ gap: 10 }}>
                <input className="input" placeholder="What are you looking for?" maxLength={80} value={want} onChange={(e) => setWant(e.target.value)} autoFocus />
                <input className="input" placeholder="What can you give for it?" maxLength={120} value={canOffer} onChange={(e) => setCanOffer(e.target.value)} />
                {bad && <p className="error-text" style={{ margin: 0 }}>&quot;{bad.term}&quot; isn&apos;t allowed on bart.</p>}
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn small outline" style={{ border: '1px solid var(--border)' }} onClick={() => setComposing(false)}>Cancel</button>
                  <button className="btn small pink" disabled={want.trim().length < 2 || !!bad} onClick={post}>Post</button>
                </div>
              </div>
            )}

            <label className="search">
              <Icon name="search" size={18} />
              <input type="search" placeholder="Search requests" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search requests" />
            </label>

            {all.length === 0 && <div className="empty">{q ? 'No requests match.' : 'Nobody has asked for anything yet.'}</div>}

            {all.map((i) => {
              const mine = i.author_id === me.id;
              const answers = responses.filter((r) => r.iso_id === i.id);
              const myAnswer = answers.find((r) => r.responder_id === me.id);
              return (
                <div key={i.id} className="card stack" style={{ gap: 8 }}>
                  <div className="spread">
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: '#C8106A' }}>{mine ? 'YOU\'RE LOOKING FOR' : 'LOOKING FOR'}</span>
                    <span className="meta">{mine ? 'You' : <ProfileLink id={i.author_id} style={{ fontWeight: 600 }}>{i.author?.first_name}</ProfileLink>} · {ago(i.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{i.want}</div>
                  {i.can_offer && <div className="meta" style={{ fontSize: 13 }}>Can give: {i.can_offer}</div>}

                  {mine ? (
                    <>
                      {answers.map((a) => (
                        <Link key={a.responder_id} href={a.listing ? `/item/${a.listing.id}` : '#'} className="spread"
                          style={{ background: 'var(--green-tint)', borderRadius: 12, padding: '10px 12px', color: 'var(--ink)', fontSize: 14 }}>
                          <span><b>{a.responder?.first_name}</b> has {a.listing?.title}</span><span>›</span>
                        </Link>
                      ))}
                      <button className="text-btn" style={{ padding: 0, alignSelf: 'flex-start', color: 'var(--muted)', fontSize: 13 }} onClick={() => close(i.id)}>
                        {answers.length ? 'Found it' : 'Remove'}
                      </button>
                    </>
                  ) : myAnswer ? (
                    <span className="pill lime" style={{ alignSelf: 'flex-start', padding: '8px 14px' }}>Sent ✓ {myAnswer.listing?.title}</span>
                  ) : picking === i.id ? (
                    <div className="stack" style={{ gap: 8 }}>
                      {closet.map((l) => (
                        <button key={l.id} className="check-row" style={{ minHeight: 44 }} onClick={() => respond(i.id, l.id)}>
                          <span className="row-title grow">{l.title}</span><span className="pill" style={{ background: 'var(--bg)' }}>{l.tier}</span>
                        </button>
                      ))}
                      <Link href="/post" className="btn small pink">Add it to your closet first</Link>
                      <button className="text-btn" style={{ padding: 0, color: 'var(--muted)' }} onClick={() => setPicking(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="btn small ink" style={{ height: 40, borderRadius: 10 }} onClick={() => setPicking(i.id)}>I have it</button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </main>
      <BottomNav />
    </>
  );
}
