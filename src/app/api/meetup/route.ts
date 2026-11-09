// Saving a meetup at a place picked from Google Maps.
// The server looks the place up itself (it never trusts a location sent by the phone), checks it's
// on campus, works out the walking time from Locust Walk at 37th, and marks street addresses as pickups.
// Needs GOOGLE_MAPS_API_KEY and SUPABASE_SERVICE_ROLE_KEY.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { CAMPUS, onCampus } from '@/lib/campus';

export const dynamic = 'force-dynamic';

// Google place types that mean "someone's address" rather than a business, building or landmark
const ADDRESS_TYPES = ['street_address', 'premise', 'subpremise', 'route', 'street_number'];
const PLACE_TYPES = ['establishment', 'point_of_interest', 'university', 'library', 'cafe', 'restaurant', 'store'];

export async function POST(req: Request) {
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!googleKey || !serviceKey) {
    return NextResponse.json({ error: 'Custom places are off until Google Maps is set up. Pick a spot from the list.' }, { status: 501 });
  }

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const asUser = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data: who } = await asUser.auth.getUser(token);
  const userId = who?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => null) as
    { offerId?: string; placeId?: string; name?: string; at?: string; session?: string; check?: boolean } | null;
  if (!body?.offerId || !body.placeId || !body.name) return NextResponse.json({ error: 'Pick a place from the list.' }, { status: 400 });

  // Must be one of the two people in an accepted trade
  const { data: offer } = await asUser.from('offers').select('id,status').eq('id', body.offerId).maybeSingle();
  if (!offer || offer.status !== 'accepted') return NextResponse.json({ error: 'Set a meetup after the offer is accepted.' }, { status: 403 });

  // Look the place up
  const placeRes = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(body.placeId)}${body.session ? `?sessionToken=${encodeURIComponent(body.session)}` : ''}`,
    { headers: { 'X-Goog-Api-Key': googleKey, 'X-Goog-FieldMask': 'formattedAddress,location,types' } },
  ).catch(() => null);
  if (!placeRes?.ok) {
    console.error('Place lookup failed', placeRes?.status, await placeRes?.text().catch(() => ''));
    return NextResponse.json({ error: "Couldn't find that place. Try another." }, { status: 502 });
  }
  const place = await placeRes.json() as { formattedAddress?: string; location?: { latitude: number; longitude: number }; types?: string[] };
  const lat = place.location?.latitude, lng = place.location?.longitude;
  if (lat == null || lng == null) return NextResponse.json({ error: "Couldn't find that place. Try another." }, { status: 422 });
  if (!onCampus(lat, lng)) return NextResponse.json({ error: "That's off campus. Pick somewhere between 30th and 40th St, Market St and Baltimore Ave." }, { status: 422 });

  const types = place.types ?? [];
  const pickup = types.some((t) => ADDRESS_TYPES.includes(t)) || !types.some((t) => PLACE_TYPES.includes(t));

  // Walking time from the middle of campus
  let walkMin: number | null = null;
  const routeRes = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleKey, 'X-Goog-FieldMask': 'routes.duration' },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: CAMPUS.center.lat, longitude: CAMPUS.center.lng } } },
      destination: { location: { latLng: { latitude: lat, longitude: lng } } },
      travelMode: 'WALK',
    }),
  }).catch(() => null);
  if (routeRes?.ok) {
    const r = await routeRes.json() as { routes?: { duration?: string }[] };
    const secs = parseInt(r.routes?.[0]?.duration ?? '', 10);
    if (!Number.isNaN(secs)) walkMin = Math.max(1, Math.round(secs / 60));
  } else {
    console.error('Walking time failed', routeRes?.status, await routeRes?.text().catch(() => ''));
  }

  const name = body.name.trim().slice(0, 80);
  const result = { name, address: place.formattedAddress ?? '', walkMin, pickup };
  if (body.check) return NextResponse.json(result); // just showing the details before saving

  if (!body.at) return NextResponse.json({ error: 'Pick a time.' }, { status: 400 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.rpc('set_meetup_place', {
    p_offer: body.offerId, p_user: userId, p_name: name, p_address: result.address,
    p_lat: lat, p_lng: lng, p_walk_min: walkMin, p_pickup: pickup, p_at: body.at,
  });
  if (error) return NextResponse.json({ error: error.message.replace(/^ERROR:\s*/, '') }, { status: 400 });
  return NextResponse.json(result);
}
