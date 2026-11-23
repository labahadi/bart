'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { friendlyError } from './trade';

// The listings you've saved, shared by every card's heart button. Loaded once per session.
let cache: Set<string> | null = null;
let loading = false;
const listeners = new Set<(s: Set<string>) => void>();
const emit = () => { const s = new Set(cache ?? []); listeners.forEach((f) => f(s)); };

// Called when someone signs in or out, so one person never sees another's saves
export function forgetSaved() { cache = null; loading = false; emit(); }

export function useSaved() {
  const [ids, setIds] = useState<Set<string>>(() => new Set(cache ?? []));
  useEffect(() => {
    listeners.add(setIds);
    if (!cache && !loading) {
      loading = true;
      supabase.from('saves').select('listing_id').then(({ data }) => {
        cache = new Set((data ?? []).map((r: { listing_id: string }) => r.listing_id));
        loading = false;
        emit();
      });
    }
    return () => { listeners.delete(setIds); };
  }, []);

  // Optimistic: the heart fills right away and flips back if saving fails
  async function toggle(id: string): Promise<string | null> {
    cache = cache ?? new Set();
    const was = cache.has(id);
    if (was) cache.delete(id); else cache.add(id);
    emit();
    const res = was
      ? await supabase.from('saves').delete().eq('listing_id', id)
      : await supabase.from('saves').insert({ listing_id: id });
    if (res.error) {
      if (was) cache.add(id); else cache.delete(id);
      emit();
      return friendlyError(res.error);
    }
    return null;
  }

  return { ids, toggle };
}
