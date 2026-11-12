// Sends a phone notification whenever bart creates one (Activity notifications).
// Called by a Supabase Database Webhook on the notifications table (insert + update),
// with the header  x-push-secret: <PUSH_WEBHOOK_SECRET>.
// Skips quiet hours (11 PM to 8 AM Philadelphia time) for people who have them on.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { pushConfig, sendToUser } from '@/lib/push-server';

export const dynamic = 'force-dynamic';

type Row = { id: string; user_id: string; kind: string; body: string; link: string; ref: string | null; count: number; read_at: string | null };

const quietNow = () => {
  const h = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  return h >= 23 || h < 8;
};

export async function POST(req: Request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: 'PUSH_WEBHOOK_SECRET is not set in Vercel' }, { status: 500 });
  if (req.headers.get('x-push-secret')?.trim() !== secret) return NextResponse.json({ error: 'x-push-secret header does not match PUSH_WEBHOOK_SECRET' }, { status: 401 });
  const cfg = pushConfig();
  if (cfg.missing.length) return NextResponse.json({ error: `Missing in Vercel: ${cfg.missing.join(', ')}` }, { status: 500 });

  const payload = await req.json().catch(() => null) as { type?: string; record?: Row; old_record?: Row } | null;
  const row = payload?.record;
  if (!row || row.read_at) return NextResponse.json({ skipped: 'nothing to send' });
  // Updates: only when a collapsed notification got a new event (not when it's marked read)
  if (payload?.type === 'UPDATE' && !(payload.old_record && row.count > payload.old_record.count)) {
    return NextResponse.json({ skipped: 'not new' });
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, cfg.serviceKey!, { auth: { persistSession: false } });
  const { data: person } = await db.from('profiles').select('quiet_hours').eq('id', row.user_id).maybeSingle();
  if ((person?.quiet_hours ?? true) && quietNow()) return NextResponse.json({ skipped: 'quiet hours' });

  // and the body says what happened: "Jordan" / "from bart" / "Is the fridge still available?"
  const i = row.body.indexOf(': ');
  const [title, body] = i > 0 && i < 40 ? [row.body.slice(0, i), row.body.slice(i + 2)] : [row.body, ''];
  const result = await sendToUser(db, row.user_id, { title, body, url: row.link, tag: `${row.kind}-${row.ref ?? row.id}` });
  return NextResponse.json(result);
}
