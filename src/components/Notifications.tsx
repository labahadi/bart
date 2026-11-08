'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type Notification = {
  id: string; tab: 'trades' | 'campus' | 'me'; kind: string; body: string; link: string;
  ref: string | null; count: number; read_at: string | null; created_at: string;
};

type State = {
  unread: Notification[];
  counts: { trades: number; campus: number; me: number; all: number };
  unreadRefs: Set<string>;
  markRead: (opts?: { tab?: Notification['tab']; ref?: string }) => Promise<void>;
};

const Ctx = createContext<State>({
  unread: [], counts: { trades: 0, campus: 0, me: 0, all: 0 }, unreadRefs: new Set(), markRead: async () => {},
});
export const useNotifications = () => useContext(Ctx);

// Keeps the unread notifications for the signed-in student, live
export function NotificationsProvider({ userId, children }: { userId: string | null; children: React.ReactNode }) {
  const [unread, setUnread] = useState<Notification[]>([]);

  const load = useCallback(async () => {
    if (!userId) { setUnread([]); return; }
    const { data } = await supabase.from('notifications').select('*').is('read_at', null)
      .order('created_at', { ascending: false }).limit(200);
    setUnread((data ?? []) as Notification[]);
  }, [userId]);

  useEffect(() => {
    load();
    if (!userId) return;
    const ch = supabase.channel(`notifications-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, load]);

  const markRead = useCallback(async (opts: { tab?: Notification['tab']; ref?: string } = {}) => {
    const match = (n: Notification) => (!opts.tab || n.tab === opts.tab) && (!opts.ref || n.ref === opts.ref);
    if (!unread.some(match)) return;
    setUnread((u) => u.filter((n) => !match(n)));
    await supabase.rpc('mark_read', { p_tab: opts.tab ?? null, p_ref: opts.ref ?? null });
  }, [unread]);

  const value = useMemo<State>(() => {
    const c = { trades: 0, campus: 0, me: 0, all: unread.length };
    unread.forEach((n) => { c[n.tab] += 1; });
    return { unread, counts: c, unreadRefs: new Set(unread.map((n) => n.ref).filter(Boolean) as string[]), markRead };
  }, [unread, markRead]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span style={{
      position: 'absolute', top: -7, left: 14, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999,
      background: 'var(--pink)', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
      border: '2px solid var(--surface)', boxSizing: 'content-box',
    }}>{n > 9 ? '9+' : n}</span>
  );
}
