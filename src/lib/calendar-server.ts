// Google Calendar, server side only. bart asks Google for busy/free times and nothing else
// (scope: calendar.freebusy), so it never sees event names, people or notes.
import { createHmac, timingSafeEqual } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.freebusy';

export function env() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return { clientId, clientSecret, serviceKey, url, ready: !!(clientId && clientSecret && serviceKey) };
}

export const admin = () => createClient(env().url, env().serviceKey!, { auth: { persistSession: false } });

// Who is calling (from the Supabase sign-in token the app sends)
export async function caller(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const asUser = createClient(env().url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data } = await asUser.auth.getUser(token);
  return data?.user ? { id: data.user.id, email: (data.user.email ?? '').toLowerCase(), asUser } : null;
}

// Signed "state" so the Google callback knows who started linking (and can't be forged)
const sign = (s: string) => createHmac('sha256', env().serviceKey!).update(s).digest('base64url');
export function makeState(userId: string, back: string) {
  const body = Buffer.from(JSON.stringify({ u: userId, b: back, e: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}
export function readState(state: string | null): { u: string; b: string } | null {
  if (!state) return null;
  const [body, mac] = state.split('.');
  if (!body || !mac) return null;
  const a = Buffer.from(sign(body)), b = Buffer.from(mac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const s = JSON.parse(Buffer.from(body, 'base64url').toString());
  return s.e > Date.now() ? s : null;
}

// Only paths inside bart
export const safeBack = (b: unknown) => (typeof b === 'string' && b.startsWith('/') && !b.startsWith('//') ? b : '/me');

export const redirectUri = (req: Request) => `${new URL(req.url).origin}/api/calendar/callback`;

async function accessToken(refresh: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env().clientId!, client_secret: env().clientSecret!, refresh_token: refresh, grant_type: 'refresh_token' }),
  }).catch(() => null);
  if (!res) return { error: 'network' as const };
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { error: j.error === 'invalid_grant' ? ('revoked' as const) : ('google' as const) };
  return { token: j.access_token as string };
}

export type Busy = { start: string; end: string };

// Busy blocks for one person between two instants, or null if they haven't linked (or unlinked in Google)
export async function busyFor(db: SupabaseClient, userId: string, from: Date, to: Date): Promise<Busy[] | null> {
  const { data: link } = await db.from('calendar_links').select('refresh_token').eq('user_id', userId).maybeSingle();
  if (!link) return null;
  const t = await accessToken(link.refresh_token);
  if ('error' in t) {
    if (t.error === 'revoked') await db.from('calendar_links').delete().eq('user_id', userId);
    return null;
  }
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST', headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: 'primary' }] }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const j = await res.json().catch(() => ({}));
  return (j.calendars?.primary?.busy ?? []) as Busy[];
}
