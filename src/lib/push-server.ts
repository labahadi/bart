// Server side of push notifications: send one notification to every device a person turned on.
import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';

export function pushConfig() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  // The subject must be "mailto:..." or an https link; accept a plain email too
  let subject = (process.env.VAPID_SUBJECT ?? '').trim() || 'mailto:hello@bart.app';
  if (!/^(mailto:|https:)/.test(subject)) subject = `mailto:${subject}`;
  const missing = [!pub && 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', !priv && 'VAPID_PRIVATE_KEY', !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean) as string[];
  return { pub, priv, subject, serviceKey, missing };
}

export type SendResult = { devices: number; sent: number; errors: string[] };

export async function sendToUser(db: SupabaseClient, userId: string, msg: { title: string; body: string; url: string; tag?: string }): Promise<SendResult> {
  const { pub, priv, subject } = pushConfig();
  webpush.setVapidDetails(subject, pub!, priv!);
  const { data: subs } = await db.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', userId);
  const result: SendResult = { devices: subs?.length ?? 0, sent: 0, errors: [] };
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 60 * 60 * 12, urgency: 'high' });
      result.sent++;
    } catch (e) {
      const err = e as { statusCode?: number; body?: string; message?: string };
      result.errors.push(`${new URL(s.endpoint).host}: ${err.statusCode ?? ''} ${err.body ?? err.message ?? ''}`.trim());
      // The phone unsubscribed, the app was deleted, or the device was saved with different keys: forget it
      if (err.statusCode === 404 || err.statusCode === 410 || err.statusCode === 403) {
        await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      }
    }
  }));
  return result;
}
