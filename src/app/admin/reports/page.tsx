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
  const [tab, setTab] = useState<'open' | 'chats' | 'all'>('open');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    if (tab === 'chats') return;
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
          Listings{rows && tab === 'open' ? ` (${rows.length})` : ''}
        </button>
        <button className={tab === 'chats' ? 'on' : ''} onClick={() => setTab('chats')}>Chats</button>
        <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All</button>
      </div>

      {tab === 'chats' && <ChatReports />}

      {done && <div className="toast">{done}</div>}
      {error && <div className="alert"><Icon name="warning" size={18} />{error}</div>}
      {tab !== 'chats' && !rows && !error && <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>}
      {tab !== 'chats' && rows && rows.length === 0 && (
        <div className="empty">{tab === 'open' ? 'All clear.' : 'No reports yet.'}</div>
      )}

      {tab !== 'chats' && rows?.map((r) => {
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
          <button className="btn small ink" onClick={() => done(r.report_id)}>Done</button>
        </div>
      ))}
    </>
  );
}
