'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Icon } from '@/components/Icon';
import { PushHeader } from '@/components/ui';
import { useNotifications, type Notification } from '@/components/Notifications';

const ICON = { trades: 'swap', campus: 'people', me: 'heart' } as const;
const TINT = { trades: 'var(--blue-tint)', campus: 'var(--pink-tint)', me: 'var(--green-tint)' } as const;

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

export default function Activity() {
  const router = useRouter();
  const { unread, markRead } = useNotifications();
  const [items, setItems] = useState<Notification[] | null>(null);

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

  return (
    <main className="screen no-nav">
      <PushHeader title="Activity" back="/"
        right={unread.length > 0 ? <button className="text-btn" onClick={() => markRead()}>Mark all read</button> : undefined} />

      {!items && <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>}
      {items?.length === 0 && <div className="empty">Nothing yet.</div>}

      <div className="stack" style={{ gap: 6 }}>
        {items?.map((n) => {
          const isNew = unread.some((u) => u.id === n.id);
          return (
            <button key={n.id} onClick={() => open(n)} className="row"
              style={{ textAlign: 'left', width: '100%', padding: '12px 14px', borderRadius: 16, gap: 12,
                background: isNew ? 'var(--surface)' : 'transparent', border: isNew ? '1px solid var(--border-soft)' : '1px solid transparent' }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, background: TINT[n.tab], display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name={ICON[n.tab]} size={20} />
              </span>
              <span className="grow">
                <span style={{ display: 'block', fontSize: 14, fontWeight: isNew ? 600 : 400, lineHeight: 1.35 }}>{n.body}</span>
                <span className="meta">{ago(n.created_at)}</span>
              </span>
              {isNew && <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--pink)', flexShrink: 0 }} />}
            </button>
          );
        })}
      </div>
    </main>
  );
}
