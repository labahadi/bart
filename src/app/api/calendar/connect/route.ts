// Start linking Google Calendar: returns the Google sign-in URL for the signed-in student.
import { NextResponse } from 'next/server';
import { SCOPES, caller, env, makeState, redirectUri, safeBack } from '@/lib/calendar-server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!env().ready) return NextResponse.json({ error: "Calendar linking isn't set up yet." }, { status: 501 });
  const me = await caller(req);
  if (!me) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const p = new URLSearchParams({
    client_id: env().clientId!, redirect_uri: redirectUri(req), response_type: 'code', scope: SCOPES,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    login_hint: me.email, state: makeState(me.id, safeBack(body.back)),
  });
  return NextResponse.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${p}` });
}
