import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Shows up in the browser console if .env.local is missing
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. See .env.example.');
}

// The anon key is safe in the browser: row level security in the database decides what each user can do.
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const photoUrl = (path: string) =>
  supabase.storage.from('listing-photos').getPublicUrl(path).data.publicUrl;

export type SafeSpot = { id: string; name: string; short_name: string; walk_min: number };

let spotsCache: SafeSpot[] | null = null;
export async function getSafeSpots(): Promise<SafeSpot[]> {
  if (spotsCache) return spotsCache;
  const { data } = await supabase.from('safe_spots').select('id,name,short_name,walk_min').order('sort');
  spotsCache = data ?? [];
  return spotsCache;
}
