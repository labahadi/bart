'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { displayName, type Listing } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Avatar, BottomNav } from '@/components/ui';
import { useNotifications } from '@/components/Notifications';
import { linkCalendar, linkResult, myCalendar, unlinkCalendar } from '@/lib/calendar';

const STATUS_LABEL: Record<Listing['status'], string> = {
  active: 'Live', in_trade: 'In a trade', traded: 'Traded', removed: 'Taken down',
};

export default function Me() {
  const { me } = useAuth();
  const { counts, markRead } = useNotifications();
  useEffect(() => { if (counts.me) markRead({ tab: 'me' }); }, [counts.me, markRead]);
  const router = useRouter();
  const [tab, setTab] = useState<'closet' | 'saved'>('closet');
  const [closet, setCloset] = useState<Listing[]>([]);
  const [saved, setSaved] = useState<Listing[]>([]);
  const [stats, setStats] = useState<{ rating: number | null; trades: number } | null>(null);
  const [reviewer, setReviewer] = useState(false);
  const [calendar, setCalendar] = useState<{ account_email: string } | null | undefined>(undefined);
  const [calBusy, setCalBusy] = useState(false);
  const [calNote, setCalNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Coming back from Google: say how it went, then tidy the address bar
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('calendar');
    if (!code) return;
    setCalNote(linkResult(code));
    window.history.replaceState(null, '', '/me');
  }, []);

  useEffect(() => {
    if (!me) return;
    supabase.from('listings').select('*').eq('owner_id', me.id).order('created_at', { ascending: false })
      .then(({ data }) => setCloset((data ?? []) as Listing[]));
    supabase.from('saves').select('listing:listings(*)').order('created_at', { ascending: false })
      .then(({ data }) => setSaved(((data ?? []) as unknown as { listing: Listing | null }[]).map((s) => s.listing).filter(Boolean) as Listing[]));
    supabase.rpc('trader_stats', { p_user: me.id }).then(({ data }) => setStats(data?.[0] ?? null));
    supabase.rpc('is_reviewer').then(({ data }) => setReviewer(data === true));
    myCalendar().then(setCalendar);
  }, [me]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (!me) return null;
  const traded = closet.filter((l) => l.status === 'traded').length;
  const rows = tab === 'closet' ? closet : saved;

  return (
    <>
      <main className="screen">
        <div className="row" style={{ gap: 14, marginTop: 8 }}>
          <Avatar profile={me} size={72} solid="pink" />
          <div>
            <div className="display" style={{ fontSize: 22 }}>{displayName(me)}</div>
            <span className="pill blue-tint" style={{ marginTop: 6 }}><Icon name="shield" size={14} /> Verified student</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[[String(stats?.trades ?? 0), 'Trades'], [stats?.rating ? String(stats.rating) : '–', 'Rating'], [String(closet.filter((l) => l.status === 'active').length), 'Live listings']]
            .map(([n, label]) => (
              <div key={label} className="card" style={{ borderRadius: 14, textAlign: 'center', padding: 12 }}>
                <div className="display" style={{ fontSize: 22 }}>{n}</div>
                <div className="meta">{label}</div>
              </div>
            ))}
        </div>

        {traded > 0 && (
          <div className="row" style={{ background: 'var(--green-tint)', borderRadius: 14, padding: '12px 14px', fontSize: 14, gap: 10 }}>
            <Icon name="check" size={20} />
            <span><b>{traded} item{traded === 1 ? '' : 's'}</b> kept out of the trash</span>
          </div>
        )}

        <div className="segmented">
          <button className={tab === 'closet' ? 'on' : ''} onClick={() => setTab('closet')}>My closet</button>
          <button className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>Saved</button>
        </div>

        {rows.length === 0 && (
          <div className="empty">
            {tab === 'closet' ? <Link href="/post">Post your first item</Link> : 'Nothing saved yet.'}
          </div>
        )}
        <div className="stack" style={{ gap: 8 }}>
          {rows.map((l) => (
            <Link key={l.id} href={`/item/${l.id}`} className="spread"
              style={{ background: 'var(--surface)', borderRadius: 12, padding: '12px 14px', color: 'var(--ink)', border: '1px solid var(--border-soft)' }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{l.title}</span>
              <span className="meta">{l.tier} · {STATUS_LABEL[l.status]}</span>
            </Link>
          ))}
        </div>

        <div className="card stack" style={{ gap: 8 }}>
          <div className="spread">
            <span className="row" style={{ gap: 10, fontWeight: 600, fontSize: 14 }}><Icon name="calendar" size={20} /> Google Calendar</span>
            {calendar === undefined ? null : calendar ? (
              <button className="text-btn" style={{ padding: 0, color: 'var(--muted)' }} disabled={calBusy}
                onClick={async () => { setCalBusy(true); await unlinkCalendar(); setCalendar(null); setCalBusy(false); setCalNote(null); }}>
                Unlink
              </button>
            ) : (
              <button className="text-btn" style={{ padding: 0 }} disabled={calBusy}
                onClick={async () => { setCalBusy(true); const err = await linkCalendar('/me'); if (err) { setCalNote({ ok: false, text: err }); setCalBusy(false); } }}>
                Link
              </button>
            )}
          </div>
          <p className="meta" style={{ margin: 0 }}>
            {calendar ? `Linked to ${calendar.account_email}. bart only sees when you're busy.` : 'Optional. Shows when you and the other person are both free.'}
          </p>
          {calNote && <p className="meta" style={{ margin: 0, color: calNote.ok ? 'var(--ink)' : 'var(--error)', fontWeight: 600 }}>{calNote.text}</p>}
        </div>

        {reviewer && (
          <Link href="/admin/reports" className="spread card" style={{ color: 'var(--ink)' }}>
            <span className="row" style={{ gap: 10, fontWeight: 600, fontSize: 14 }}><Icon name="flag" size={20} /> Review reports</span>
            <span className="meta">›</span>
          </Link>
        )}

        <button className="text-btn" style={{ color: 'var(--muted)', alignSelf: 'center', display: 'flex', gap: 6, alignItems: 'center' }} onClick={signOut}>
          <Icon name="logout" size={18} /> Sign out
        </button>
      </main>
      <BottomNav />
    </>
  );
}
