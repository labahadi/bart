'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRemembered } from '@/lib/remembered';
import { supabase } from '@/lib/supabase';
import { blockedAnywhere } from '@/lib/banned';
import { screenText } from '@/lib/screen';
import { friendlyError, type Profile } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { TradeOfWeekDog } from '@/components/Mascot';
import { Avatar, ProfileLink } from '@/components/ui';
import { useNotifications } from '@/components/Notifications';

type Post = {
  id: string; offer_id: string; author_id: string; author_first: string | null; author_initial: string | null; author_avatar?: string | null;
  gave: string; got: string; note: string | null; created_at: string;
  like_count: number; comment_count: number; liked: boolean;
};
type Comment = { id: string; author_id: string; body: string; created_at: string; author: Profile | null };

// "now", "12m", "5h" today; "Mon" earlier this week; "Nov 7" before that
const TZ = 'America/New_York';
// The Monday (Philadelphia time) of the week a moment falls in, as "YYYY-MM-DD"
const mondayOf = (d: Date) => {
  const [y, mo, day] = d.toLocaleDateString('en-CA', { timeZone: TZ }).split('-').map(Number);
  const wd = (new Date(Date.UTC(y, mo - 1, day)).getUTCDay() + 6) % 7; // Mon = 0
  return new Date(Date.UTC(y, mo - 1, day - wd)).toISOString().slice(0, 10);
};
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  if (mondayOf(new Date(iso)) === mondayOf(new Date())) return new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
  return new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
};

// "Nov 9 – 15", or "Oct 27 – Nov 2" across months (week_start is a Monday, "YYYY-MM-DD")
const weekRange = (start: string) => {
  const [y, mo, d] = start.split('-').map(Number);
  const a = new Date(Date.UTC(y, mo - 1, d)), b = new Date(Date.UTC(y, mo - 1, d + 6));
  const f = (x: Date, withMonth: boolean) => x.toLocaleDateString('en-US', { timeZone: 'UTC', month: withMonth ? 'short' : undefined, day: 'numeric' });
  return `${f(a, true)} – ${f(b, a.getUTCMonth() !== b.getUTCMonth())}`;
};

type Featured = { post_id: string; week_start: string; last_week: boolean };
// Each card alternates its two item colors
const SIDE_TINTS = [['tint-blue', 'tint-pink'], ['tint-green', 'tint-blue']] as const;
const asProfile = (p: Post): Profile => ({ id: p.author_id, first_name: p.author_first, last_initial: p.author_initial, avatar_path: p.author_avatar });

export default function Campus() {
  // Notifications stay until you tap them in Activity (or Clear all there).
  // A tap lands here as /campus?post=<id>, which clears only that post's updates.
  const { markRead } = useNotifications();
  useEffect(() => {
    const post = new URLSearchParams(window.location.search).get('post');
    if (post) markRead({ ref: post });
  }, [markRead]);
  return (
    <>
      <main className="screen">
        <div>
          <h1 className="title-tab">Campus</h1>
          <p className="subtitle">What&apos;s happening on campus</p>
        </div>
        <Feed />
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------
// Trade feed
// ---------------------------------------------------------------------------
function Feed() {
  const [posts, setPosts] = useRemembered<Post[] | null>('campus:posts', null);
  const [featured, setFeatured] = useRemembered<Featured | null>('campus:featured', null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Opened from a notification: jump to that post (and its comments, for a comment)
  const [target, setTarget] = useState<{ post: string; comments: boolean } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const post = q.get('post');
    if (post) setTarget({ post, comments: q.get('comments') === '1' });
    if (post) window.history.replaceState(null, '', '/campus');
  }, []);
  useEffect(() => {
    if (!target || !posts?.some((p) => p.id === target.post)) return;
    if (target.comments) setOpen(target.post);
    const el = document.getElementById(`post-${target.post}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.add('flash');
    setTarget(null);
  }, [target, posts]);

  const load = useCallback(async () => {
    const [{ data, error }, { data: top }] = await Promise.all([
      supabase.rpc('campus_feed', { p_limit: 50 }),
      supabase.rpc('featured_trade'),
    ]);
    if (error) setError(friendlyError(error)); else setPosts(data as Post[]);
    setFeatured((top as Featured[] | null)?.[0] ?? null);
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
    else supabase.rpc('featured_trade').then(({ data }) => setFeatured((data as Featured[] | null)?.[0] ?? null));
  }

  if (error) return <div className="alert">{error}</div>;
  if (!posts) return <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>;

  const top = featured ? posts.find((p) => p.id === featured.post_id) : undefined;

  return (
    <>
      {!top && (
        <div className="totw">
          <TradeOfWeekDog />
          <div className="spread">
            <span className="row" style={{ gap: 6, fontSize: 13, fontWeight: 800, letterSpacing: 0.4 }}>
              <Icon name="trophy" size={17} /> TRADE OF THE WEEK
            </span>
          </div>
          <div className="totw-title">No trade this week. <b>Trade something and vote!</b></div>
          <span className="totw-week">{weekRange(mondayOf(new Date()))}</span>
        </div>
      )}
      {top && (
        <div className="totw">
          <TradeOfWeekDog />
          <div className="spread">
            <span className="row" style={{ gap: 6, fontSize: 13, fontWeight: 800, letterSpacing: 0.4 }}>
              <Icon name="trophy" size={17} /> TRADE OF THE WEEK
            </span>
          </div>
          <div className="totw-title">
            <b>{top.gave}</b> for <b>{top.got}</b>
          </div>
          <span className="totw-week">{weekRange(featured!.week_start)}</span>
          <div className="spread">
            <ProfileLink id={top.author_id} style={{ color: '#fff' }}>
              <span className="row" style={{ gap: 8 }}>
                <span style={{ display: 'inline-flex', borderRadius: 999, boxShadow: '0 0 0 2px #fff' }}><Avatar profile={asProfile(top)} size={32} /></span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {top.author_first}{top.author_initial ? ` ${top.author_initial}.` : ''}
                </span>
              </span>
            </ProfileLink>
            <span className="row" style={{ gap: 6 }}>
              <button onClick={() => setOpen(open === `top-${top.id}` ? null : `top-${top.id}`)} className="totw-btn ghost" aria-label="Comments">
                <Icon name="chat" size={15} />{top.comment_count ? ` ${top.comment_count}` : ''}
              </button>
              <button onClick={() => toggleLike(top)} aria-pressed={top.liked} className="totw-btn">
                <Icon name="heart" size={15} fill={top.liked ? 'currentColor' : 'none'} /> {top.like_count}
              </button>
            </span>
          </div>
          {open === `top-${top.id}` && (
            <div style={{ background: '#fff', color: 'var(--ink)', borderRadius: 18, padding: '2px 12px 12px', position: 'relative' }}>
              <Comments postId={top.id} onCount={(n) => setPosts((ps) => ps?.map((x) => x.id === top.id ? { ...x, comment_count: n } : x) ?? null)} />
            </div>
          )}
        </div>
      )}

      {posts.length > 0 && <h2 className="section-title">Recent trades</h2>}
      {posts.length === 0 && <div className="empty">No trades shared yet.</div>}

      {posts.map((p, i) => (
        <div key={p.id} id={`post-${p.id}`} className="card stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 10 }}>
            <ProfileLink id={p.author_id}><Avatar profile={asProfile(p)} size={36} /></ProfileLink>
            <div className="grow" style={{ fontSize: 14 }}>
              <ProfileLink id={p.author_id}><b>{p.author_first}{p.author_initial ? ` ${p.author_initial}.` : ''}</b></ProfileLink> traded
            </div>
            {p.id === top?.id && <span className="pill pink-tint">Leading</span>}
            <span className="meta">{ago(p.created_at)}</span>
          </div>
          <div className="swap-pair">
            <span className={`swap-side ${SIDE_TINTS[i % 2][0]}`}>{p.gave}</span>
            <span style={{ color: 'var(--pink)', display: 'inline-flex', flexShrink: 0 }}><Icon name="swap" size={20} stroke={2.2} /></span>
            <span className={`swap-side ${SIDE_TINTS[i % 2][1]}`}>{p.got}</span>
          </div>
          {p.note && <div style={{ fontSize: 14, color: 'var(--text-2)' }}>{p.note}</div>}
          <div className="row" style={{ gap: 16 }}>
            <button onClick={() => toggleLike(p)} aria-pressed={p.liked} className={`feed-action${p.liked ? ' liked' : ''}`}>
              <Icon name="heart" size={17} fill={p.liked ? 'currentColor' : 'none'} /> {p.like_count}
            </button>
            <button onClick={() => setOpen(open === p.id ? null : p.id)} className="feed-action">
              Comment{p.comment_count ? ` · ${p.comment_count}` : ''}
            </button>
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
      .select('id,author_id,body,created_at,author:profiles!post_comments_author_id_fkey(id,first_name,last_initial,avatar_path)')
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
    const problem = await screenText(body);
    if (problem) { setError(problem); setText(body); return; }
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
          <span><ProfileLink id={c.author_id}><b>{c.author?.first_name ?? 'Student'}</b></ProfileLink> {c.body}</span>
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
