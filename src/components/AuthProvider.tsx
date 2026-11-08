'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Loading } from './ui';

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
  const router = useRouter();
  const path = usePathname();

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setMe(null); return; }
    const { data } = await supabase.from('profiles')
      .select('id,first_name,last_initial,rules_accepted_at').eq('id', s.user.id).single();
    setMe(data ?? null);
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
  useEffect(() => { if (needsLogin) router.replace('/login'); }, [needsLogin, router]);

  const refresh = useCallback(async () => { await loadProfile(session); }, [loadProfile, session]);

  if (!ready || needsLogin) return <Loading />;
  return <AuthContext.Provider value={{ session, me, ready, refresh }}>{children}</AuthContext.Provider>;
}
