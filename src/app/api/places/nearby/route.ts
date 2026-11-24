// "Pick on map": turns a dropped pin into the nearest real place (a building, cafe, landmark).
// Runs on the server so the Google key stays private. Off-campus pins are refused here too,
// and the place picked is checked again when the meetup is saved.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { onCampus } from '@/lib/campus';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ error: 'The map is off until Google Maps is set up.' }, { status: 501 });

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data } = token ? await supabase.auth.getUser(token) : { data: null };
  if (!data?.user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const lat = Number(params.get('lat')), lng = Number(params.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: 'Drop a pin on the map.' }, { status: 400 });
  if (!onCampus(lat, lng)) return NextResponse.json({ error: "That's off campus.", offCampus: true }, { status: 422 });

  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.shortFormattedAddress,places.location',
    },
    body: JSON.stringify({
      maxResultCount: 5, rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 80 } },
    }),
  }).catch(() => null);
  if (!res?.ok) {
    console.error('Nearby search failed', res?.status, await res?.text().catch(() => ''));
    return NextResponse.json({ error: "Couldn't look up that spot right now." }, { status: 502 });
  }
  type P = { id: string; displayName?: { text?: string }; shortFormattedAddress?: string; location?: { latitude: number; longitude: number } };
  const places = ((await res.json()) as { places?: P[] }).places ?? [];
  const p = places.find((x) => x.location && onCampus(x.location.latitude, x.location.longitude) && x.displayName?.text);
  if (!p) return NextResponse.json({ error: 'Nothing right there. Try tapping a building or landmark.' }, { status: 404 });
  return NextResponse.json({
    placeId: p.id, name: p.displayName!.text!, detail: p.shortFormattedAddress ?? '',
    lat: p.location!.latitude, lng: p.location!.longitude,
  });
}
