// Place search for "Somewhere else on campus": suggestions from Google Maps, limited to campus.
// Runs on the server so the Google key stays private. Needs GOOGLE_MAPS_API_KEY.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { CAMPUS } from '@/lib/campus';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ error: 'Place search is off until Google Maps is set up.' }, { status: 501 });

  // Signed-in students only (each search counts toward the Google allowance)
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data } = token ? await supabase.auth.getUser(token) : { data: null };
  if (!data?.user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const q = (params.get('q') ?? '').trim().slice(0, 80);
  const session = (params.get('session') ?? '').slice(0, 64);
  if (q.length < 2) return NextResponse.json({ results: [] });

  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify({
      input: q,
      sessionToken: session || undefined,
      includedRegionCodes: ['us'],
      locationRestriction: { rectangle: {
        low: { latitude: CAMPUS.south, longitude: CAMPUS.west },
        high: { latitude: CAMPUS.north, longitude: CAMPUS.east },
      } },
    }),
  }).catch(() => null);
  if (!res?.ok) {
    console.error('Place search failed', res?.status, await res?.text().catch(() => ''));
    return NextResponse.json({ error: "Couldn't search places right now." }, { status: 502 });
  }
  type Suggestion = { placePrediction?: { placeId: string; text?: { text: string };
    structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } };
  const json = (await res.json()) as { suggestions?: Suggestion[] };
  const results = (json.suggestions ?? []).map((s) => s.placePrediction).filter(Boolean).slice(0, 6).map((p) => ({
    placeId: p!.placeId,
    name: p!.structuredFormat?.mainText?.text ?? p!.text?.text ?? '',
    detail: p!.structuredFormat?.secondaryText?.text ?? '',
  }));
  return NextResponse.json({ results });
}
