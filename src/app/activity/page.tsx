'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Icon, type IconName } from '@/components/Icon';
import { useNotifications, type Notification } from '@/components/Notifications';
import { MascotFace } from '@/components/Mascot';

// One look per kind of update: icon, tint, and the button shown while it's new
const KIND: Record<string, { icon: IconName; tint: string; action?: string }> = {
  offer:    { icon: 'swap',      tint: 'var(--blue-tint)',  action: 'View offer' },
  counter:  { icon: 'swap',      tint: 'var(--blue-tint)',  action: 'View counter' },
  status:   { icon: 'check',     tint: 'var(--green-tint)', action: 'Open trade' },
  meetup:   { icon: 'calendar',  tint: 'var(--pink-tint)',  action: 'Open meetup' },
  message:  { icon: 'chat',      tint: 'var(--blue-tint)',  action: 'Reply' },
  like:     { icon: 'heart',     tint: 'var(--pink-tint)' },
  comment:  { icon: 'chat',      tint: 'var(--pink-tint)',  action: 'See comment' },
  iso:      { icon: 'megaphone', tint: 'var(--green-tint)', action: 'Open Wanted' },
  saved:    { icon: 'heart',     tint: 'var(--pink-tint)' },
  paused:   { icon: 'warning',   tint: 'var(--pink-tint)' },
  unpaused: { icon: 'check',     tint: 'var(--green-tint)' },
};
const FALLBACK = { trades: 'swap', campus: 'people', me: 'person' } as const;
// Updates that start with the other person's name get it in bold
const STARTS_WITH_NAME = new Set(['offer', 'counter', 'meetup', 'message', 'like', 'comment', 'iso']);

const TABS: { key: 'all' | Notification['tab']; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'trades', label: 'Trades' }, { key: 'campus', label: 'Campus' }, { key: 'me', label: 'You' },
];

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

function Body({ n }: { n: Notification }) {
  const named = STARTS_WITH_NAME.has(n.kind)
    || (n.kind === 'status' && !n.body.startsWith('The ') && !n.body.startsWith('Trade done'));
  const m = named ? n.body.match(/^([^\s:]+)([\s:].*)$/s) : null;
  return m ? <><b>{m[1]}</b>{m[2]}</> : <>{n.body}</>;
}

export default function Activity() {
  const router = useRouter();
  const { unread, markRead } = useNotifications();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all');

  // Recent activity, read and unread (refreshes when new ones arrive)
  useEffect(() => {
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setItems((data ?? []) as Notification[]));
  }, [unread.length]);

  async function open(n: Notification) {
    if (!n.read_at) await markRead({ ref: n.ref ?? undefined, tab: n.ref ? undefined : n.tab });
    // Answers to "Looking for" posts were stored with a link to the old ISO board on Campus
    router.push(n.kind === 'iso' ? '/wanted' : n.link);
  }

  const shown = items?.filter((n) => tab === 'all' || n.tab === tab);
  // Unread offers and counters, for the banner. With one, name the item ("...for your mini fridge").
  const newOffers = unread.filter((n) => n.kind === 'offer' || n.kind === 'counter');
  const offerItem = newOffers.length === 1 ? newOffers[0].body.match(/for your (.+?)\.?$/)?.[1] : undefined;

  return (
    <main className="screen no-nav">
      <div className="spread">
        <button className="icon-btn" aria-label="Back" onClick={() => router.push('/')}><Icon name="back" size={20} stroke={2.2} /></button>
        {unread.length > 0 && <button className="text-btn" onClick={() => markRead()}>Mark all read</button>}
      </div>
      <h1 className="title-tab">Activity</h1>

      {/* New offers: the dog perks up */}
      {newOffers.length > 0 && (
        <button className="mascot-banner" onClick={() => setTab('trades')}>
          <span className="blob" aria-hidden="true" />
          <MascotFace face="new-alert" width={104} alt="bart dog surprised" />
          <span className="stack" style={{ gap: 4 }}>
            <b style={{ fontSize: 20, letterSpacing: -0.4, lineHeight: 1.2 }}>
              {newOffers.length} new offer{newOffers.length === 1 ? '' : 's'}!
            </b>
            <span style={{ fontSize: 14, color: '#E4E9FF', lineHeight: 1.4 }}>
              {offerItem ? `Someone wants your ${offerItem}.` : 'People want your stuff.'} Check before it&apos;s gone.
            </span>
          </span>
        </button>
      )}

      <div className="segmented">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {!items && <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>}
      {shown?.length === 0 && <div className="empty">Nothing here yet.</div>}

      <div className="stack" style={{ gap: 6 }}>
        {shown?.map((n) => {
          const isNew = unread.some((u) => u.id === n.id);
          const k = KIND[n.kind];
          return (
            <button key={n.id} onClick={() => open(n)} className={`activity-row${isNew ? ' new' : ''}`}>
              <span className="activity-icon" style={{ background: k?.tint ?? 'var(--blue-tint)' }}>
                <Icon name={k?.icon ?? FALLBACK[n.tab]} size={20} />
              </span>
              <span className="grow stack" style={{ gap: 8 }}>
                <span style={{ fontSize: 15, lineHeight: 1.4 }}>
                  <Body n={n} /> <span className="meta" style={{ fontSize: 13 }}>· {ago(n.created_at)}</span>
                </span>
                {isNew && k?.action && <span className="pill ink" style={{ alignSelf: 'flex-start', height: 34, padding: '0 14px', fontSize: 13 }}>{k.action}</span>}
              </span>
              {isNew && <span className="activity-dot" />}
            </button>
          );
        })}
      </div>
    </main>
  );
}
