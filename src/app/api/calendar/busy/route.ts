// When are both people in a trade free on a given day (7:30 AM to 8 PM)?
// Your own busy times come back so the screen can warn you; the other person's never leave the
// server: you only see the windows that work for both of you.
import { NextResponse } from 'next/server';
import { admin, busyFor, caller, env, type Busy } from '@/lib/calendar-server';
import { CLOSE, OPEN, nyInstant } from '@/lib/time';

export const dynamic = 'force-dynamic';

const MIN_WINDOW = 30 * 60 * 1000;

function freeWindows(from: number, to: number, busy: Busy[]) {
  const blocks = busy.map((b) => [Date.parse(b.start), Date.parse(b.end)]).sort((a, b) => a[0] - b[0]);
  const out: { start: string; end: string }[] = [];
  let cur = from;
  for (const [s, e] of blocks) {
    if (s > cur && s - cur >= MIN_WINDOW) out.push({ start: new Date(cur).toISOString(), end: new Date(Math.min(s, to)).toISOString() });
    cur = Math.max(cur, e);
    if (cur >= to) break;
  }
  if (to - cur >= MIN_WINDOW) out.push({ start: new Date(cur).toISOString(), end: new Date(to).toISOString() });
  return out;
}

export async function POST(req: Request) {
  const me = await caller(req);
  if (!me) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.date ?? ''));
  if (!body.offerId || !m) return NextResponse.json({ error: 'Pick a day.' }, { status: 400 });
  if (!env().ready) return NextResponse.json({ me: { linked: false }, them: { linked: false }, free: [], off: true });

  // Must be one of the two people in this trade
  const { data: offer } = await me.asUser.from('offers').select('id,from_user,to_user').eq('id', body.offerId).maybeSingle();
  if (!offer) return NextResponse.json({ error: 'Trade not found.' }, { status: 404 });
  const otherId = offer.from_user === me.id ? offer.to_user : offer.from_user;

  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dayStart = nyInstant(y, mo, d, OPEN.h, OPEN.m).getTime();
  const dayEnd = nyInstant(y, mo, d, CLOSE.h, CLOSE.m).getTime() + 60 * 60 * 1000; // an 8 PM meetup runs to 9
  const from = Math.max(dayStart, Math.ceil(Date.now() / (15 * 60 * 1000)) * 15 * 60 * 1000);

  const db = admin();
  const [mine, theirs] = await Promise.all([
    busyFor(db, me.id, new Date(dayStart), new Date(dayEnd)),
    busyFor(db, otherId, new Date(dayStart), new Date(dayEnd)),
  ]);
  // Last start is 8 PM, so windows are cut there (a window ending 8:30 means "start by 8")
  const free = from >= dayEnd ? [] : freeWindows(from, dayEnd, [...(mine ?? []), ...(theirs ?? [])])
    // `end` is when they stop being free; `until` is the latest start shown (never past 8 PM)
    .map((w) => ({ ...w, until: new Date(Math.min(Date.parse(w.end), dayEnd - 60 * 60 * 1000)).toISOString() }))
    .filter((w) => Date.parse(w.start) <= dayEnd - 60 * 60 * 1000);

  return NextResponse.json({
    me: { linked: mine !== null, busy: mine ?? [] },
    them: { linked: theirs !== null },
    free: mine !== null || theirs !== null ? free : [],
  });
}
