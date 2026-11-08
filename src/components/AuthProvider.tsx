'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Loading } from './ui';
import { NotificationsProvider } from './Notifications';

type Me = { id: string; first_name: string | null; last_initial: string | null; rules_accepted_at: string | null };
type AuthState = { session: Session | null; me: Me | null; ready: boolean; refresh: () => Promise<void> };

const AuthContext = createContext<AuthState>({ session: null, me: null, ready: false, refresh: async () => {} });
export const useAuth = () => useContext(AuthContext);

// Screens anyone can open without being signed in
const PUBLIC = ['/login'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [pausedUntil, setPausedUntil] = useState<string | null | undefined>(undefined); // undefined = not paused
  const router = useRouter();
  const path = usePathname();

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setMe(null); return; }
    const { data } = await supabase.from('profiles')
      .select('id,first_name,last_initial,rules_accepted_at').eq('id', s.user.id).single();
    setMe(data ?? null);
    // Is this account paused right now?
    const { data: pauses } = await supabase.from('suspensions').select('until,lifted_at')
      .is('lifted_at', null).order('created_at', { ascending: false }).limit(5);
    const active = ((pauses ?? []) as { until: string | null }[]).find((x) => !x.until || new Date(x.until) > new Date());
    setPausedUntil(active ? (active.until ?? null) : undefined);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Defer the query so it doesn't run inside Supabase's auth callback
      setTimeout(() => loadProfile(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  // Signed out, or hasn't agreed to the house rules yet -> sign-up flow
  const needsLogin = ready && !PUBLIC.includes(path) && (!session || !me?.rules_accepted_at);
  // Keep any #error=... from an email link so the sign-up screen can explain it
  useEffect(() => {
    if (!needsLogin) return;
    // Remember where they were going (e.g. a scanned QR code) so sign-in can bring them back
    try { if (path !== '/') sessionStorage.setItem('bart-next', path + window.location.search); } catch {}
    router.replace('/login' + (window.location.hash.includes('error') ? window.location.hash : ''));
  }, [needsLogin, router, path]);

  const refresh = useCallback(async () => { await loadProfile(session); }, [loadProfile, session]);

  if (!ready || needsLogin) return <Loading />;
  return (
    <AuthContext.Provider value={{ session, me, ready, refresh }}>
      <NotificationsProvider userId={me?.rules_accepted_at ? me.id : null}>
        {pausedUntil !== undefined && session && (
          <div style={{ position: 'sticky', top: 0, zIndex: 30, background: 'var(--ink)', color: '#fff', padding: '10px 20px', fontSize: 13, fontWeight: 600 }}>
            Your account is paused {pausedUntil
              ? `until ${new Date(pausedUntil).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
              : 'until further notice'}. You can still read your chats.
          </div>
        )}
        {children}
      </NotificationsProvider>
    </AuthContext.Provider>
  );
}
