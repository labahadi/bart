'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { bannedMatch, blockedAnywhere } from '@/lib/banned';
import { friendlyError, type Listing, type Profile } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Avatar, BottomNav } from '@/components/ui';
import { useNotifications } from '@/components/Notifications';

type Post = {
  id: string; offer_id: string; author_id: string; author_first: string | null; author_initial: string | null;
  gave: string; got: string; note: string | null; created_at: string;
  like_count: number; comment_count: number; liked: boolean;
};
type Comment = { id: string; author_id: string; body: string; created_at: string; author: Profile | null };
type Iso = { id: string; author_id: string; want: string; can_offer: string | null; open: boolean; created_at: string; author: Profile | null };
type IsoResponse = { iso_id: string; responder_id: string; listing: { id: string; title: string } | null; responder: Profile | null };

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};
const asProfile = (p: Post): Profile => ({ id: p.author_id, first_name: p.author_first, last_initial: p.author_initial });

export default function Campus() {
  const [tab, setTab] = useState<'feed' | 'iso'>('feed');
  // Opening Campus clears its badge (and keeps it clear while you're here)
  const { counts, markRead } = useNotifications();
  useEffect(() => { if (counts.campus) markRead({ tab: 'campus' }); }, [counts.campus, markRead]);
  return (
    <>
      <main className="screen">
        <h1 className="title-tab">Campus</h1>
        <div className="segmented">
          <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>Trade feed</button>
          <button className={tab === 'iso' ? 'on' : ''} onClick={() => setTab('iso')}>ISO board</button>
        </div>
        {tab === 'feed' ? <Feed /> : <IsoBoard />}
      </main>
      <BottomNav />
    </>
  );
}

// ---------------------------------------------------------------------------
// Trade feed
// ---------------------------------------------------------------------------
function Feed() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [leader, setLeader] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [{ data, error }, { data: top }] = await Promise.all([
      supabase.rpc('campus_feed', { p_limit: 50 }),
      supabase.rpc('trade_of_the_week'),
    ]);
    if (error) setError(friendlyError(error)); else setPosts(data as Post[]);
    setLeader((top as string | null) ?? null);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel('campus-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_posts' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_likes' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  async function toggleLike(p: Post) {
    // Update right away, then save
    setPosts((ps) => ps?.map((x) => x.id === p.id ? { ...x, liked: !p.liked, like_count: x.like_count + (p.liked ? -1 : 1) } : x) ?? null);
    const res = p.liked
      ? await supabase.from('post_likes').delete().eq('post_id', p.id)
      : await supabase.from('post_likes').insert({ post_id: p.id });
    if (res.error) { setError(friendlyError(res.error)); load(); }
    else supabase.rpc('trade_of_the_week').then(({ data }) => setLeader((data as string | null) ?? null));
  }

  if (error) return <div className="alert">{error}</div>;
  if (!posts) return <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>;

  const top = posts.find((p) => p.id === leader && p.like_count > 0);

  return (
    <>
      {top && (
        <div style={{ background: 'var(--pink)', color: '#fff', borderRadius: 18, padding: '14px 16px' }} className="stack">
          <div className="spread">
            <span className="row" style={{ gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>
              <span style={{ color: 'var(--lime)' }}><Icon name="trophy" size={16} /></span> TRADE OF THE WEEK
            </span>
            <span style={{ fontSize: 12, opacity: 0.85 }}>Ends Sun</span>
          </div>
          <div className="row">
            <Avatar profile={asProfile(top)} size={44} />
            <div style={{ fontSize: 15, lineHeight: 1.35 }}>
              <b>{top.author_first}</b> swapped {top.gave} for {top.got}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={() => toggleLike(top)} aria-pressed={top.liked} className="chip"
              style={{ height: 36, background: top.liked ? '#fff' : 'transparent', color: top.liked ? 'var(--pink)' : '#fff', borderColor: 'rgba(255,255,255,0.6)' }}>
              ♥ {top.like_count}
            </button>
            <button onClick={() => setOpen(open === `top-${top.id}` ? null : `top-${top.id}`)} className="chip"
              style={{ height: 36, background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,0.6)' }}>
              Comment{top.comment_count ? ` ${top.comment_count}` : ''}
            </button>
          </div>
          {open === `top-${top.id}` && (
            <div style={{ background: '#fff', color: 'var(--ink)', borderRadius: 14, padding: '2px 12px 12px' }}>
              <Comments postId={top.id} onCount={(n) => setPosts((ps) => ps?.map((x) => x.id === top.id ? { ...x, comment_count: n } : x) ?? null)} />
            </div>
          )}
        </div>
      )}

      {posts.length === 0 && <div className="empty">No trades shared yet.</div>}

      {posts.map((p) => (
        <div key={p.id} className="card stack" style={{ gap: 10 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <Avatar profile={asProfile(p)} size={36} />
            <div className="grow" style={{ fontSize: 14, lineHeight: 1.4 }}>
              <b>{p.author_first}{p.author_initial ? ` ${p.author_initial}.` : ''}</b> swapped {p.gave} for {p.got}
              {p.note && <div style={{ color: 'var(--text-2)', marginTop: 4 }}>{p.note}</div>}
            </div>
            <span className="meta">{ago(p.created_at)}</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={() => toggleLike(p)} aria-pressed={p.liked}
              className={`chip ${p.liked ? 'pink-on' : ''}`} style={{ height: 36 }}>♥ {p.like_count}</button>
            <button onClick={() => setOpen(open === p.id ? null : p.id)} className="chip" style={{ height: 36 }}>
              Comment{p.comment_count ? ` ${p.comment_count}` : ''}
            </button>
            {p.id === top?.id && <span className="pill pink-tint" style={{ marginLeft: 'auto' }}>Leading</span>}
          </div>
          {open === p.id && <Comments postId={p.id} onCount={(n) => setPosts((ps) => ps?.map((x) => x.id === p.id ? { ...x, comment_count: n } : x) ?? null)} />}
        </div>
      ))}
    </>
  );
}

function Comments({ postId, onCount }: { postId: string; onCount: (n: number) => void }) {
  const { me } = useAuth();
  const [list, setList] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  // Keep the latest callback without re-running the effect on every render
  const countRef = useRef(onCount);
  countRef.current = onCount;

  const load = useCallback(async () => {
    const { data } = await supabase.from('post_comments')
      .select('id,author_id,body,created_at,author:profiles!post_comments_author_id_fkey(id,first_name,last_initial)')
      .eq('post_id', postId).order('created_at');
    const rows = (data ?? []) as unknown as Comment[];
    setList(rows); countRef.current(rows.length);
  }, [postId]);

  useEffect(() => { load(); }, [load]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    if (blockedAnywhere(body)) { setError("That includes words that aren't allowed on bart."); return; }
    setError(''); setText('');
    const { error } = await supabase.from('post_comments').insert({ post_id: postId, body });
    if (error) { setError(friendlyError(error)); setText(body); return; }
    load();
  }

  async function remove(id: string) {
    await supabase.from('post_comments').delete().eq('id', id);
    load();
  }

  return (
    <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
      {list?.map((c) => (
        <div key={c.id} className="spread" style={{ alignItems: 'flex-start', fontSize: 13 }}>
          <span><b>{c.author?.first_name ?? 'Student'}</b> {c.body}</span>
          {c.author_id === me?.id && (
            <button className="text-btn" style={{ padding: 0, fontSize: 12, color: 'var(--muted)' }} onClick={() => remove(c.id)}>Delete</button>
          )}
        </div>
      ))}
      <div className="row" style={{ gap: 8 }}>
        <input className="chat-input" style={{ height: 40 }} placeholder="Add a comment" maxLength={300} value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button className="round-send" style={{ width: 40, height: 40 }} aria-label="Post comment" disabled={!text.trim()} onClick={send}>
          <Icon name="send" size={18} />
        </button>
      </div>
      {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ISO board
// ---------------------------------------------------------------------------
function IsoBoard() {
  const { me } = useAuth();
  const [isos, setIsos] = useState<Iso[] | null>(null);
  const [responses, setResponses] = useState<IsoResponse[]>([]);
  const [closet, setCloset] = useState<Listing[]>([]);
  const [composing, setComposing] = useState(false);
  const [want, setWant] = useState('');
  const [canOffer, setCanOffer] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!me) return;
    const [{ data: i, error }, { data: r }, { data: c }] = await Promise.all([
      supabase.from('iso_posts').select('*, author:profiles!iso_posts_author_id_fkey(id,first_name,last_initial)').eq('open', true)
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('iso_responses').select('iso_id,responder_id,listing:listings!iso_responses_listing_id_fkey(id,title),responder:profiles!iso_responses_responder_id_fkey(id,first_name,last_initial)'),
      supabase.from('listings').select('*').eq('owner_id', me.id).eq('status', 'active').order('created_at', { ascending: false }),
    ]);
    if (error) setError(friendlyError(error));
    setIsos((i ?? []) as unknown as Iso[]);
    setResponses((r ?? []) as unknown as IsoResponse[]);
    setCloset((c ?? []) as Listing[]);
  }, [me]);

  useEffect(() => { load(); }, [load]);

  const bad = bannedMatch(want) ?? bannedMatch(canOffer);

  async function post() {
    setError('');
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

  if (!isos || !me) return <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>;

  return (
    <>
      {composing ? (
        <div className="card stack" style={{ gap: 10 }}>
          <input className="input" placeholder="What are you looking for?" maxLength={80} value={want} onChange={(e) => setWant(e.target.value)} />
          <input className="input" placeholder="What can you offer?" maxLength={120} value={canOffer} onChange={(e) => setCanOffer(e.target.value)} />
          {bad && <p className="error-text" style={{ margin: 0 }}>&quot;{bad.term}&quot; isn&apos;t allowed on bart.</p>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn small outline" style={{ border: '1px solid var(--border)' }} onClick={() => setComposing(false)}>Cancel</button>
            <button className="btn small pink" disabled={want.trim().length < 2 || !!bad} onClick={post}>Post</button>
          </div>
        </div>
      ) : (
        <button className="btn ink small" onClick={() => setComposing(true)}>Post what you&apos;re looking for</button>
      )}

      {error && <div className="alert">{error}</div>}
      {isos.length === 0 && <div className="empty">Nothing yet.</div>}

      {isos.map((i) => {
        const mine = i.author_id === me.id;
        const answers = responses.filter((r) => r.iso_id === i.id);
        const myAnswer = answers.find((r) => r.responder_id === me.id);
        return (
          <div key={i.id} className="card stack" style={{ gap: 8 }}>
            <div className="spread">
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: 'var(--pink-link, #C8106A)' }}>IN SEARCH OF</span>
              <span className="meta">{mine ? 'You' : i.author?.first_name} · {ago(i.created_at)}</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{i.want}</div>
            {i.can_offer && <div className="meta" style={{ fontSize: 13 }}>Can offer: {i.can_offer}</div>}

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
                <Link href={`/post?title=${encodeURIComponent(i.want)}`} className="btn small pink">List it</Link>
                <button className="text-btn" style={{ padding: 0, color: 'var(--muted)' }} onClick={() => setPicking(null)}>Cancel</button>
              </div>
            ) : (
              <button className="btn small ink" style={{ height: 40, borderRadius: 10 }} onClick={() => setPicking(i.id)}>I have this</button>
            )}
          </div>
        );
      })}
    </>
  );
}
