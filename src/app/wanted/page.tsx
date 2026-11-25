'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRemembered } from '@/lib/remembered';
import { supabase } from '@/lib/supabase';
import { bannedMatch } from '@/lib/banned';
import { screenText } from '@/lib/screen';
import { friendlyError, type Listing, type Profile } from '@/lib/trade';
import { addToClosetHref, takeReturnedPicks } from '@/lib/returnTo';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Avatar, ProfileLink } from '@/components/ui';
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
  const { markRead, unread } = useNotifications();
  const [tab, setTab] = useState<'yours' | 'asks' | 'all'>('yours');
  // Your own requests (open and closed), so answers are never out of sight
  const [mine, setMine] = useRemembered<Iso[]>('wanted:mine', []);
  // Requests with answers you hadn't seen yet, noted when you open Your asks (so they stay marked "New")
  const [fresh, setFresh] = useState<string[]>([]);
  const newAnswers = unread.filter((n) => n.kind === 'iso' && n.ref);
  const [isos, setIsos] = useRemembered<Iso[] | null>('wanted:isos', null);
  const [responses, setResponses] = useRemembered<IsoResponse[]>('wanted:responses', []);
  const [closet, setCloset] = useRemembered<Listing[]>('wanted:closet', []);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [composing, setComposing] = useState(false);
  const [want, setWant] = useState('');
  const [canOffer, setCanOffer] = useState('');
  const [query, setQuery] = useState('');
  // "I have it": pick one or more things from your closet, then send them together
  const [picking, setPicking] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const startPicking = (isoId: string | null, ids: string[] = []) => { setPicking(isoId); setChosen(ids); };
  const toggle = (id: string) => setChosen((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id]);
  // Back from adding something to the closet: reopen that request with the new item ticked
  useEffect(() => {
    const answering = new URLSearchParams(window.location.search).get('answering');
    if (!answering) { takeReturnedPicks(); return; }
    setTab('all');
    startPicking(answering, takeReturnedPicks() ?? []);
  }, []);
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

  // Tapping a "someone has it" notification lands here as /wanted?iso=<id> and clears only that one
  useEffect(() => {
    const iso = new URLSearchParams(window.location.search).get('iso');
    if (!iso) return;
    setTab('asks');
    setFresh((f) => (f.includes(iso) ? f : [...f, iso]));
    markRead({ ref: iso });
    window.history.replaceState(null, '', '/wanted');
    setTimeout(() => document.getElementById(`ask-${iso}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
  }, [markRead]);

  // New answers waiting: open on Your asks
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (opened || !newAnswers.length) return;
    setOpened(true);
    const params = new URLSearchParams(window.location.search);
    if (!params.get('ask') && !params.get('answering')) setTab('asks');
  }, [newAnswers.length, opened]);

  // Looking at Your asks clears the Wanted badge (the new ones stay marked until you leave)
  useEffect(() => {
    if (tab !== 'asks' || !newAnswers.length) return;
    const refs = [...new Set(newAnswers.map((n) => n.ref as string))];
    setFresh((f) => [...new Set([...f, ...refs])]);
    refs.forEach((ref) => markRead({ ref }));
  }, [tab, newAnswers, markRead]);

  const load = useCallback(async () => {
    if (!me) return;
    const [{ data: i, error }, { data: r }, { data: c }, { data: m }] = await Promise.all([
      supabase.from('iso_posts').select('*, author:profiles!iso_posts_author_id_fkey(id,first_name,last_initial,avatar_path)').eq('open', true)
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('iso_responses').select('iso_id,responder_id,listing:listings!iso_responses_listing_id_fkey(id,title),responder:profiles!iso_responses_responder_id_fkey(id,first_name,last_initial,avatar_path)'),
      supabase.from('listings').select('*').eq('owner_id', me.id).eq('status', 'active').order('created_at', { ascending: false }),
      supabase.from('iso_posts').select('*').eq('author_id', me.id).order('created_at', { ascending: false }).limit(50),
    ]);
    if (error) setError(friendlyError(error));
    setIsos((i ?? []) as unknown as Iso[]);
    setResponses((r ?? []) as unknown as IsoResponse[]);
    setCloset((c ?? []) as Listing[]);
    setMine((m ?? []) as unknown as Iso[]);
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

  async function respond(isoId: string, listingIds: string[]) {
    if (!listingIds.length) return;
    setError(''); setSending(true);
    // One at a time, so one that was already sent doesn't stop the others
    for (const listing_id of listingIds) {
      const { error } = await supabase.from('iso_responses').insert({ iso_id: isoId, listing_id });
      if (error && !/duplicate/i.test(error.message)) { setSending(false); setError(friendlyError(error)); load(); return; }
    }
    setSending(false);
    startPicking(null); load();
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
            For you{openMatches ? ` (${openMatches})` : ''}
          </button>
          <button className={tab === 'asks' ? 'on' : ''} onClick={() => setTab('asks')}>
            Your asks{newAnswers.length ? ` (${new Set(newAnswers.map((n) => n.ref)).size})` : ''}
          </button>
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All</button>
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
                  : <>Add things to your closet and we&apos;ll show who wants them. <Link href={addToClosetHref('/wanted', [])}>Add to your closet</Link></>}
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
                    <button className="btn small outline" style={{ width: 'auto', padding: '0 16px', boxShadow: 'var(--shadow)' }} onClick={() => notNow(iso.id)}>Not now</button>
                    <button className="btn small pink grow" onClick={() => {
                      // Opens the picker on that request with this item ticked, so more can be added before sending
                      setTab('all'); setQuery(''); startPicking(iso.id, [item.id]);
                      setTimeout(() => document.getElementById(`iso-${iso.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
                    }}>Offer my {item.title}</button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {isos && me && tab === 'asks' && (
          <>
            {mine.length === 0 && (
              <div className="empty">
                You haven&apos;t asked for anything yet.{' '}
                <button className="text-btn" style={{ padding: 0 }} onClick={() => { setComposing(true); setTab('all'); }}>Ask for something</button>
              </div>
            )}
            {[...mine].sort((a, b) => Number(b.open) - Number(a.open)).map((i) => {
              const answers = responses.filter((r) => r.iso_id === i.id);
              const isNew = fresh.includes(i.id);
              return (
                <div key={i.id} id={`ask-${i.id}`} className="card stack" style={{ gap: 8, opacity: i.open ? 1 : 0.75 }}>
                  <div className="spread">
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: '#C8106A' }}>
                      {i.open ? 'YOU\'RE LOOKING FOR' : 'FOUND'}
                    </span>
                    <span className="row" style={{ gap: 8 }}>
                      {isNew && <span className="pill" style={{ background: 'var(--pink)', color: '#fff', padding: '2px 8px', fontSize: 11 }}>New</span>}
                      <span className="meta">{ago(i.created_at)}</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{i.want}</div>
                  {i.can_offer && <div className="meta" style={{ fontSize: 13 }}>Can give: {i.can_offer}</div>}
                  {answers.length === 0 && <span className="meta">No one has answered yet.</span>}
                  {answers.map((a) => (
                    <Link key={`${a.responder_id}-${a.listing?.id}`} href={a.listing ? `/item/${a.listing.id}` : '#'} className="spread"
                      style={{ background: 'var(--green-tint)', borderRadius: 12, padding: '10px 12px', color: 'var(--ink)', fontSize: 14, gap: 10 }}>
                      <span className="row" style={{ gap: 10, minWidth: 0 }}>
                        <Avatar profile={a.responder} size={28} />
                        <span><b>{a.responder?.first_name}</b> has {a.listing?.title}</span>
                      </span>
                      <span>›</span>
                    </Link>
                  ))}
                  {i.open && (
                    <button className="text-btn" style={{ padding: 0, alignSelf: 'flex-start', color: 'var(--muted)', fontSize: 13 }} onClick={() => close(i.id)}>
                      {answers.length ? 'Found it' : 'Remove'}
                    </button>
                  )}
                </div>
              );
            })}
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
                  <button className="btn small outline" style={{ boxShadow: 'var(--shadow)' }} onClick={() => setComposing(false)}>Cancel</button>
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
              const myAnswers = answers.filter((r) => r.responder_id === me.id);
              return (
                <div key={i.id} id={`iso-${i.id}`} className="card stack" style={{ gap: 8 }}>
                  <div className="spread">
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: '#C8106A' }}>{mine ? 'YOU\'RE LOOKING FOR' : 'LOOKING FOR'}</span>
                    <span className="meta">{mine ? 'You' : <ProfileLink id={i.author_id} style={{ fontWeight: 600 }}>{i.author?.first_name}</ProfileLink>} · {ago(i.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{i.want}</div>
                  {i.can_offer && <div className="meta" style={{ fontSize: 13 }}>Can give: {i.can_offer}</div>}

                  {mine ? (
                    <>
                      {answers.map((a) => (
                        <Link key={`${a.responder_id}-${a.listing?.id}`} href={a.listing ? `/item/${a.listing.id}` : '#'} className="spread"
                          style={{ background: 'var(--green-tint)', borderRadius: 12, padding: '10px 12px', color: 'var(--ink)', fontSize: 14 }}>
                          <span><b>{a.responder?.first_name}</b> has {a.listing?.title}</span><span>›</span>
                        </Link>
                      ))}
                      <button className="text-btn" style={{ padding: 0, alignSelf: 'flex-start', color: 'var(--muted)', fontSize: 13 }} onClick={() => close(i.id)}>
                        {answers.length ? 'Found it' : 'Remove'}
                      </button>
                    </>
                  ) : picking === i.id ? (
                    <div className="stack" style={{ gap: 8 }}>
                      <span className="meta">Pick everything you could give. You can choose more than one.</span>
                      {closet.filter((l) => !myAnswers.some((a) => a.listing?.id === l.id)).map((l) => {
                        const on = chosen.includes(l.id);
                        return (
                          <button key={l.id} className={`check-row${on ? ' on' : ''}`} style={{ minHeight: 48 }} onClick={() => toggle(l.id)} aria-pressed={on}>
                            <span className="box">{on && <Icon name="check" size={14} stroke={3} />}</span>
                            <span className="row-title grow">{l.title}</span><span className="pill" style={{ background: 'var(--bg)' }}>{l.tier}</span>
                          </button>
                        );
                      })}
                      <Link href={addToClosetHref(`/wanted?answering=${i.id}`, chosen)} className="check-row add-row">
                        <span className="add-plus"><Icon name="plus" size={16} stroke={2.8} /></span>
                        <span className="row-title grow">Add something to your closet</span>
                      </Link>
                      <div className="row" style={{ gap: 8 }}>
                        <button className="btn small outline" style={{ width: 'auto', padding: '0 16px', boxShadow: 'var(--shadow)' }} onClick={() => startPicking(null)}>Cancel</button>
                        <button className="btn small pink grow" disabled={!chosen.length || sending} onClick={() => respond(i.id, chosen)}>
                          {sending ? 'Sending…' : chosen.length > 1 ? `Send ${chosen.length} items` : chosen.length ? 'Send it' : 'Pick something'}
                        </button>
                      </div>
                    </div>
                  ) : myAnswers.length ? (
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span className="pill lime" style={{ padding: '8px 14px' }}>Sent ✓ {myAnswers.map((a) => a.listing?.title).join(', ')}</span>
                      <button className="text-btn" style={{ padding: 0, fontSize: 13 }} onClick={() => startPicking(i.id)}>Offer more</button>
                    </div>
                  ) : (
                    <button className="btn small ink" style={{ height: 40, borderRadius: 10 }} onClick={() => startPicking(i.id)}>I have it</button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </main>
    </>
  );
}
