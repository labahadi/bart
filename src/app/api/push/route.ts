// Sends a phone notification whenever bart creates one (Activity notifications).
// Called by a Supabase Database Webhook on the notifications table (insert + update),
// with the header  x-push-secret: <PUSH_WEBHOOK_SECRET>.
// Skips quiet hours (11 PM to 8 AM Philadelphia time) for people who have them on.
import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

type Row = { id: string; user_id: string; kind: string; body: string; link: string; ref: string | null; count: number; read_at: string | null };

const quietNow = () => {
  const h = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  return h >= 23 || h < 8;
};

export async function POST(req: Request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET;
  if (!secret || req.headers.get('x-push-secret') !== secret) return NextResponse.json({ error: 'Not allowed' }, { status: 401 });
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!pub || !priv || !serviceKey) return NextResponse.json({ skipped: 'not set up' });

  const payload = await req.json().catch(() => null) as { type?: string; record?: Row; old_record?: Row } | null;
  const row = payload?.record;
  if (!row || row.read_at) return NextResponse.json({ skipped: 'nothing to send' });
  // Updates: only when a collapsed notification got a new event (not when it's marked read)
  if (payload?.type === 'UPDATE' && !(payload.old_record && row.count > payload.old_record.count)) {
    return NextResponse.json({ skipped: 'not new' });
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await db.from('profiles').select('quiet_hours').eq('id', row.user_id).maybeSingle();
  if ((person?.quiet_hours ?? true) && quietNow()) return NextResponse.json({ skipped: 'quiet hours' });

  const { data: subs } = await db.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', row.user_id);
  if (!subs?.length) return NextResponse.json({ skipped: 'no devices' });

  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:hello@bart.app', pub, priv);
  const message = JSON.stringify({ title: 'bart', body: row.body, url: row.link, tag: `${row.kind}-${row.ref ?? row.id}` });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message, { TTL: 60 * 60 * 12 });
      sent++;
    } catch (e) {
      // The phone unsubscribed or the app was deleted: forget that device
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    }
  }));
  return NextResponse.json({ sent });
}
