// Custom meetup place: AI checks it's a public spot on (or right next to) Penn's campus,
// then the server saves it. Students can't save a custom place any other way.
// Uses the same server-only keys as the photo check: ANTHROPIC_API_KEY and SUPABASE_SERVICE_ROLE_KEY.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const MODEL = 'claude-haiku-5-5';

const RULES = `You check meetup places for bart, an app where University of Pennsylvania students meet in person to swap items.
A place is OK only if BOTH are true:
1. It is on Penn's campus in University City, Philadelphia, or right next to it (roughly 30th St to 40th St, and Market St to Baltimore Ave). Examples: Penn buildings, libraries, dining halls, college house lobbies, Locust Walk, Penn Bookstore, nearby cafes and shops on Walnut, Chestnut, Spruce or Sansom.
2. It is a public, indoor or busy place. Not OK: someone's room or apartment, a dorm room, a stairwell, a parking lot or garage, an alley, anywhere off campus, or anything too vague to find ("my place", "outside").
Reply with JSON only: {"ok": true | false, "name": "<the place written clearly, max 60 characters>", "why": "<if not ok: under 12 words>"}`;

export async function POST(req: Request) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!anthropicKey || !serviceKey) {
    return NextResponse.json({ error: 'Custom places are off until the AI check is set up. Pick a spot from the list.' }, { status: 501 });
  }

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const asUser = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data: who } = await asUser.auth.getUser(token);
  const userId = who?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => null) as { offerId?: string; place?: string; at?: string } | null;
  const place = (body?.place ?? '').trim();
  if (!body?.offerId || !body.at || place.length < 2 || place.length > 80) {
    return NextResponse.json({ error: 'Type the place you want to meet.' }, { status: 400 });
  }

  // Must be in this trade (checked with the student's own access rules)
  const { data: offer } = await asUser.from('offers').select('id,status').eq('id', body.offerId).maybeSingle();
  if (!offer || offer.status !== 'accepted') return NextResponse.json({ error: 'Set a meetup after the offer is accepted.' }, { status: 403 });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 100, system: RULES, messages: [{ role: 'user', content: `Place: ${place}` }] }),
  }).catch(() => null);
  if (!res?.ok) return NextResponse.json({ error: "Couldn't check that place. Try again, or pick a spot from the list." }, { status: 502 });
  const text: string = (await res.json())?.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '';
  let v: { ok?: boolean; name?: string; why?: string } = {};
  try { v = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { /* handled below */ }
  if (v.ok !== true) {
    return NextResponse.json({ error: `${v.why ? `${v.why.replace(/\.$/, '')}. ` : ''}Pick a public place on Penn's campus.` }, { status: 422 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const name = (v.name || place).slice(0, 80);
  const { error } = await admin.rpc('set_meetup_custom', { p_offer: body.offerId, p_user: userId, p_place: name, p_at: body.at });
  if (error) return NextResponse.json({ error: error.message.replace(/^ERROR:\s*/, '') }, { status: 400 });
  return NextResponse.json({ name });
}
