// Google sends people back here after they allow access. The Google account must be the same
// email they use for bart; otherwise nothing is saved.
import { NextResponse } from 'next/server';
import { admin, env, readState, redirectUri } from '@/lib/calendar-server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  const state = readState(u.searchParams.get('state'));
  const back = (result: string) => {
    const to = new URL(state?.b ?? '/me', u.origin);
    to.searchParams.set('calendar', result);
    return NextResponse.redirect(to);
  };
  if (!state) return back('expired');
  if (u.searchParams.get('error') || !u.searchParams.get('code')) return back('cancelled');
  if (!env().ready) return back('off');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: u.searchParams.get('code')!, client_id: env().clientId!, client_secret: env().clientSecret!,
      redirect_uri: redirectUri(req), grant_type: 'authorization_code',
    }),
  }).catch(() => null);
  const tok = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok || !tok.id_token) return back('failed');
  if (!String(tok.scope ?? '').includes('calendar.freebusy')) return back('no-access');

  // The id_token came straight from Google over HTTPS, so reading its email is safe
  const claims = JSON.parse(Buffer.from(String(tok.id_token).split('.')[1], 'base64url').toString());
  const googleEmail = String(claims.email ?? '').toLowerCase();

  const db = admin();
  const { data: user } = await db.auth.admin.getUserById(state.u);
  const bartEmail = (user?.user?.email ?? '').toLowerCase();
  if (!googleEmail || !claims.email_verified || googleEmail !== bartEmail) {
    // Don't keep access to the wrong account
    if (tok.access_token) await fetch(`https://oauth2.googleapis.com/revoke?token=${tok.access_token}`, { method: 'POST' }).catch(() => null);
    return back('wrong-email');
  }
  if (!tok.refresh_token) return back('failed');

  const { error } = await db.from('calendar_links').upsert({
    user_id: state.u, provider: 'google', account_email: googleEmail, refresh_token: tok.refresh_token, created_at: new Date().toISOString(),
  });
  return back(error ? 'failed' : 'linked');
}
