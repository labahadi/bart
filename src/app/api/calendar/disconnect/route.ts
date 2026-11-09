// Unlink Google Calendar: tells Google to drop bart's access, then forgets the link.
import { NextResponse } from 'next/server';
import { admin, caller, env } from '@/lib/calendar-server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const me = await caller(req);
  if (!me) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!env().serviceKey) return NextResponse.json({ error: "Calendar linking isn't set up yet." }, { status: 501 });
  const db = admin();
  const { data: link } = await db.from('calendar_links').select('refresh_token').eq('user_id', me.id).maybeSingle();
  if (link) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(link.refresh_token)}`, { method: 'POST' }).catch(() => null);
  await db.from('calendar_links').delete().eq('user_id', me.id);
  return NextResponse.json({ ok: true });
}
