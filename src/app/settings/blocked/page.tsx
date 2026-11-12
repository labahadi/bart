'use client';

// People you've blocked, with Unblock
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { displayName, friendlyError } from '@/lib/trade';
import { Icon } from '@/components/Icon';
import { Avatar, PushHeader } from '@/components/ui';

type Blocked = { user_id: string; first_name: string | null; last_initial: string | null; blocked_at: string };

export default function BlockedPeople() {
  const [rows, setRows] = useState<Blocked[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_blocks');
    if (error) setError(friendlyError(error)); else setRows((data ?? []) as Blocked[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function unblock(id: string) {
    const { error } = await supabase.rpc('unblock_user', { p_user: id });
    if (error) setError(friendlyError(error)); else load();
  }

  return (
    <main className="screen no-nav">
      <PushHeader title="Blocked people" back="/settings" />
      {error && <div className="alert"><Icon name="warning" size={18} />{error}</div>}
      {!rows && !error && <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>}
      {rows?.length === 0 && <div className="empty">Nobody blocked.</div>}
      {rows?.map((r) => {
        const p = { id: r.user_id, first_name: r.first_name, last_initial: r.last_initial };
        return (
          <div key={r.user_id} className="card spread" style={{ padding: '10px 14px' }}>
            <span className="row" style={{ gap: 12 }}>
              <Avatar profile={p} size={40} />
              <span style={{ fontSize: 15, fontWeight: 600 }}>{displayName(p)}</span>
            </span>
            <button className="chip" onClick={() => unblock(r.user_id)}>Unblock</button>
          </div>
        );
      })}
    </main>
  );
}
