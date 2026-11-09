'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase, photoUrl } from '@/lib/supabase';
import { CATEGORY_ICON, CATEGORY_TINT, categoryLabel, friendlyError, type Category, type Tier } from '@/lib/trade';
import { Icon } from '@/components/Icon';
import { PushHeader } from '@/components/ui';

type Row = {
  listing_id: string; title: string; description: string | null; wants: string | null;
  category: Category; tier: Tier; photo_paths: string[]; listing_status: 'active' | 'in_trade' | 'traded' | 'removed';
  owner_name: string; owner_reported: number; report_count: number; open_count: number;
  reasons: string[]; details: string[]; first_reported: string; last_reported: string;
};

const REASON_LABEL: Record<string, string> = {
  banned_item: 'Banned item', scam: 'Scam or fake', unsafe_meetup: 'Unsafe meetup',
  harassment: 'Harassment', other: 'Something else',
};

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} hr ago`;
  return `${Math.round(mins / 1440)} days ago`;
};

export default function ReportQueue() {
  const [tab, setTab] = useState<'open' | 'chats' | 'paused' | 'words' | 'all'>('open');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    if (tab === 'chats' || tab === 'paused') return;
    const { data, error } = await supabase.rpc('report_queue', { p_include_reviewed: tab === 'all' });
    if (error) setError(friendlyError(error)); else { setError(''); setRows(data as Row[]); }
  }, [tab]);

  useEffect(() => { setRows(null); load(); }, [load]);

  async function resolve(r: Row, action: 'keep' | 'remove') {
    setBusy(r.listing_id); setDone('');
    const { error } = await supabase.rpc('resolve_report', { p_listing: r.listing_id, p_action: action });
    setBusy(null);
    if (error) { setError(friendlyError(error)); return; }
    setDone(action === 'keep' ? 'Kept' : 'Removed');
    load();
  }

  return (
    <main className="screen no-nav">
      <PushHeader title="Reports" back="/me" />

      <div className="segmented">
        <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>
          Listings
        </button>
        <button className={tab === 'chats' ? 'on' : ''} onClick={() => setTab('chats')}>Chats</button>
        <button className={tab === 'paused' ? 'on' : ''} onClick={() => setTab('paused')}>Paused</button>
        <button className={tab === 'words' ? 'on' : ''} onClick={() => setTab('words')}>Words</button>
        <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All</button>
      </div>

      {tab === 'chats' && <ChatReports />}
      {tab === 'paused' && <PausedAccounts />}
      {tab === 'words' && <BlockedWords />}

      {done && <div className="toast">{done}</div>}
      {error && <div className="alert"><Icon name="warning" size={18} />{error}</div>}
      {(tab === 'open' || tab === 'all') && !rows && !error && <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>}
      {(tab === 'open' || tab === 'all') && rows && rows.length === 0 && (
        <div className="empty">{tab === 'open' ? 'All clear.' : 'No reports yet.'}</div>
      )}

      {(tab === 'open' || tab === 'all') && rows?.map((r) => {
        const hidden = r.listing_status === 'removed';
        return (
          <div key={r.listing_id} className="card big stack" style={{ gap: 12 }}>
            {/* Status line */}
            <div className="spread">
              <span className={`pill ${r.open_count >= 3 ? 'pink' : r.open_count > 0 ? 'pink-tint' : 'soft'}`}>
                {r.open_count > 0 ? `${r.open_count} report${r.open_count > 1 ? 's' : ''}` : 'Reviewed'}
              </span>
              <span className="meta">{hidden ? 'Hidden' : 'Live'} · {ago(r.last_reported)}</span>
            </div>

            {/* The listing */}
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className={CATEGORY_TINT[r.category]} style={{ width: 72, height: 72, borderRadius: 12, overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {r.photo_paths?.length
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={photoUrl(r.photo_paths[0])} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Icon name={CATEGORY_ICON[r.category]} size={30} stroke={1.6} />}
              </div>
              <div className="grow">
                <div style={{ fontSize: 16, fontWeight: 700 }}>{r.title}</div>
                <div className="meta">{r.owner_name} · {categoryLabel(r.category)} · {r.tier}</div>
                {r.description && <p className="body" style={{ fontSize: 13, marginTop: 4 }}>{r.description}</p>}
                {r.wants && <div className="meta" style={{ marginTop: 2 }}>Wants: {r.wants}</div>}
              </div>
            </div>
            {r.photo_paths?.length > 1 && (
              <div className="row" style={{ gap: 6 }}>
                {r.photo_paths.slice(1).map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p} src={photoUrl(p)} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8 }} />
                ))}
              </div>
            )}

            {/* Why it was reported */}
            <div style={{ background: 'var(--bg)', borderRadius: 12, padding: '10px 12px' }} className="stack">
              <div className="chips wrap" style={{ gap: 6 }}>
                {r.reasons.map((x) => <span key={x} className="pill pink-tint">{REASON_LABEL[x] ?? x}</span>)}
              </div>
              {r.details.length > 0 ? r.details.map((d, i) => (
                <p key={i} className="body" style={{ fontSize: 13 }}>&ldquo;{d}&rdquo;</p>
              )) : null}
              {r.owner_reported > 1 && (
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--error)' }}>{r.owner_reported} of their listings reported</span>
              )}
            </div>

            {/* Decision */}
            {r.open_count > 0 ? (
              <div className="row" style={{ gap: 8 }}>
                <button className="btn small" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                  disabled={busy === r.listing_id} onClick={() => resolve(r, 'keep')}>Keep</button>
                <button className="btn small pink" disabled={busy === r.listing_id} onClick={() => resolve(r, 'remove')}>Remove</button>
              </div>
            ) : (
              <div className="spread">
                <span className="meta">{hidden ? 'Removed' : 'Kept'}</span>
                <button className="text-btn" style={{ padding: 0 }} disabled={busy === r.listing_id}
                  onClick={() => resolve(r, hidden ? 'keep' : 'remove')}>{hidden ? 'Restore' : 'Remove'}</button>
              </div>
            )}
            {!hidden && <Link href={`/item/${r.listing_id}`} className="meta-blue">Open listing ›</Link>}
            <PauseControl name={r.owner_name}
              loadCount={() => supabase.rpc('listing_owner_pauses', { p_listing: r.listing_id }).then(({ data }) => (data as number) ?? 0)}
              pause={(days, reason) => supabase.rpc('pause_listing_owner', { p_listing: r.listing_id, p_days: days, p_reason: reason })} />
          </div>
        );
      })}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Reported chats: read the conversation, delete messages, mark done
// ---------------------------------------------------------------------------
type ChatMsg = { id: string; sender: string; body: string | null; image_path: string | null; at: string };
type ChatReport = {
  report_id: string; offer_id: string; reason: string; details: string | null; reviewed: boolean; created_at: string;
  reporter_name: string; other_name: string; other_id: string; other_blocked_photos: number; messages: ChatMsg[];
};
const CHAT_REASON: Record<string, string> = {
  sexual: 'Sexual', harassment: 'Harassment', scam: 'Scam', unsafe_meetup: 'Unsafe meetup', other: 'Other',
};

function ChatReports() {
  const [rows, setRows] = useState<ChatReport[] | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('chat_report_queue', { p_include_reviewed: false });
    if (error) { setError(friendlyError(error)); return; }
    const list = (data ?? []) as ChatReport[];
    setRows(list);
    const paths = list.flatMap((r) => r.messages.map((m) => m.image_path)).filter(Boolean) as string[];
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('chat-photos').createSignedUrls(paths, 600);
      setPhotos(Object.fromEntries((signed ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl])));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function del(messageId: string) {
    const { error } = await supabase.rpc('reviewer_delete_message', { p_message: messageId });
    if (error) setError(friendlyError(error)); else load();
  }
  async function done(reportId: string) {
    const { error } = await supabase.rpc('resolve_chat_report', { p_report: reportId });
    if (error) setError(friendlyError(error)); else load();
  }

  if (error) return <div className="alert">{error}</div>;
  if (!rows) return <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  if (rows.length === 0) return <div className="empty">All clear.</div>;

  return (
    <>
      {rows.map((r) => (
        <div key={r.report_id} className="card big stack" style={{ gap: 10 }}>
          <div className="spread">
            <span className={`pill ${r.reason === 'sexual' ? 'pink' : 'pink-tint'}`}>{CHAT_REASON[r.reason] ?? r.reason}</span>
            <span className="meta">{ago(r.created_at)}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>About {r.other_name}</div>
          {r.details && <p className="body" style={{ fontSize: 13 }}>&ldquo;{r.details}&rdquo;</p>}
          {r.other_blocked_photos > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--error)' }}>
              {r.other_blocked_photos} blocked photo{r.other_blocked_photos > 1 ? 's' : ''} from {r.other_name}
            </span>
          )}
          <div className="stack" style={{ gap: 6, background: 'var(--bg)', borderRadius: 12, padding: 10, maxHeight: 320, overflowY: 'auto' }}>
            {r.messages.length === 0 && <span className="meta">No messages.</span>}
            {r.messages.map((m) => (
              <div key={m.id} className="spread" style={{ alignItems: 'flex-start', fontSize: 13 }}>
                <span className="grow">
                  <b>{m.sender}</b>{' '}
                  {m.body}
                  {m.image_path && (photos[m.image_path]
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={photos[m.image_path]} alt="" style={{ width: 120, borderRadius: 8, marginTop: 4 }} />
                    : <span className="meta"> [photo]</span>)}
                </span>
                <button className="text-btn" style={{ padding: 0, fontSize: 12, color: 'var(--error)' }} onClick={() => del(m.id)}>Delete</button>
              </div>
            ))}
          </div>
          <PauseControl name={r.other_name}
            loadCount={() => supabase.rpc('pause_count', { p_user: r.other_id }).then(({ data }) => (data as number) ?? 0)}
            pause={(days, reason) => supabase.rpc('pause_account', { p_user: r.other_id, p_days: days, p_reason: reason })} />
          <button className="btn small ink" onClick={() => done(r.report_id)}>Done</button>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pausing accounts
// ---------------------------------------------------------------------------
const LENGTHS: { days: number | null; label: string }[] = [
  { days: 1, label: '1 day' }, { days: 3, label: '3 days' }, { days: 7, label: '7 days' }, { days: null, label: 'Until further notice' },
];

function PauseControl({ name, loadCount, pause }: {
  name: string;
  loadCount: () => PromiseLike<number>;
  pause: (days: number | null, reason: string) => PromiseLike<{ error: unknown }>;
}) {
  const [open, setOpen] = useState(false);
  const [past, setPast] = useState<number | null>(null);
  const [days, setDays] = useState<number | null | undefined>(undefined);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { loadCount().then(setPast); }, [loadCount]);

  async function confirm() {
    setBusy(true); setMsg('');
    const { error } = await pause(days ?? null, reason.trim());
    setBusy(false);
    if (error) setMsg(friendlyError(error));
    else { setMsg(`${name} is paused`); setOpen(false); setPast((p) => (p ?? 0) + 1); }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="spread">
        <span className="meta">{past ? `Paused ${past} time${past > 1 ? 's' : ''} before` : 'Never paused'}</span>
        {!open && <button className="text-btn" style={{ padding: 0, color: 'var(--error)' }} onClick={() => setOpen(true)}>Pause {name}</button>}
      </div>
      {open && (
        <div className="stack" style={{ gap: 8, background: 'var(--bg)', borderRadius: 12, padding: 10 }}>
          <div className="chips wrap">
            {LENGTHS.map((l) => (
              <button key={l.label} className={`chip ${days === l.days ? 'on' : ''}`} onClick={() => setDays(l.days)}>{l.label}</button>
            ))}
          </div>
          <input className="input" style={{ height: 44 }} placeholder="Reason (they'll see this)" maxLength={300}
            value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn small" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }} onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn small pink" disabled={days === undefined || reason.trim().length < 3 || busy} onClick={confirm}>Pause</button>
          </div>
        </div>
      )}
      {msg && <span className="meta" style={{ fontWeight: 600 }}>{msg}</span>}
    </div>
  );
}

type Paused = { user_id: string; name: string; until: string | null; reason: string; past_pauses: number };

function PausedAccounts() {
  const [rows, setRows] = useState<Paused[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('paused_accounts');
    if (error) setError(friendlyError(error)); else setRows((data ?? []) as Paused[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function lift(userId: string) {
    const { error } = await supabase.rpc('lift_pause', { p_user: userId });
    if (error) setError(friendlyError(error)); else load();
  }

  if (error) return <div className="alert">{error}</div>;
  if (!rows) return <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  if (rows.length === 0) return <div className="empty">Nobody is paused.</div>;
  return (
    <>
      {rows.map((p) => (
        <div key={p.user_id + (p.until ?? '')} className="card stack" style={{ gap: 6 }}>
          <div className="spread">
            <span style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</span>
            <span className="meta">
              {p.until ? `Until ${new Date(p.until).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' })}` : 'Until further notice'}
            </span>
          </div>
          <p className="body" style={{ fontSize: 13 }}>{p.reason}</p>
          <div className="spread">
            <span className="meta">{p.past_pauses} pause{p.past_pauses > 1 ? 's' : ''} total</span>
            <button className="text-btn" style={{ padding: 0 }} onClick={() => lift(p.user_id)}>Lift pause</button>
          </div>
        </div>
      ))}
    </>
  );
}

// Words reviewers block on top of the built-in list. They work right away, everywhere the list applies.
function BlockedWords() {
  const [rows, setRows] = useState<{ term: string; everywhere: boolean; custom: boolean }[] | null>(null);
  const [word, setWord] = useState('');
  const [everywhere, setEverywhere] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('banned_term_list');
    if (error) setError(friendlyError(error)); else setRows(data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!word.trim()) return;
    setBusy(true); setError('');
    const { error } = await supabase.rpc('add_banned_term', { p_term: word, p_everywhere: everywhere });
    setBusy(false);
    if (error) { setError(friendlyError(error)); return; }
    setWord(''); load();
  }

  async function remove(term: string) {
    const { error } = await supabase.rpc('remove_banned_term', { p_term: term });
    if (error) setError(friendlyError(error)); else load();
  }

  const custom = (rows ?? []).filter((r) => r.custom);
  const builtIn = (rows ?? []).filter((r) => !r.custom).length;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card stack" style={{ gap: 10 }}>
        <input className="input" placeholder="Word or phrase to block" maxLength={40} value={word}
          onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <div className="segmented">
          <button className={everywhere ? 'on' : ''} onClick={() => setEverywhere(true)}>Everywhere</button>
          <button className={!everywhere ? 'on' : ''} onClick={() => setEverywhere(false)}>Listings and ISO only</button>
        </div>
        <button className="btn" disabled={!word.trim() || busy} onClick={add}>{busy ? 'Adding…' : 'Block it'}</button>
        <p className="meta" style={{ margin: 0 }}>
          Everywhere covers chat, comments, names, notes, listings and ISO posts. Plurals and spellings like 0 for o are caught too.
        </p>
      </div>

      {error && <div className="alert"><Icon name="warning" size={18} />{error}</div>}

      {rows && custom.length === 0 && <div className="empty">No words added yet.</div>}
      {custom.map((r) => (
        <div key={r.term} className="spread card" style={{ padding: '10px 14px' }}>
          <span className="stack" style={{ gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{r.term}</span>
            <span className="meta">{r.everywhere ? 'Everywhere' : 'Listings and ISO only'}</span>
          </span>
          <button className="text-btn" style={{ padding: 0, color: 'var(--muted)' }} onClick={() => remove(r.term)}>Remove</button>
        </div>
      ))}
      {rows && <p className="meta" style={{ textAlign: 'center' }}>Plus {builtIn} built-in words that can&apos;t be removed here.</p>}
    </div>
  );
}
