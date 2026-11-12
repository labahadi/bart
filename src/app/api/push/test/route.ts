// "Send a test" in Settings: sends a notification straight to your own devices, skipping
// the Supabase webhook and quiet hours, and says what happened.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { pushConfig, sendToUser } from '@/lib/push-server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const asUser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data } = token ? await asUser.auth.getUser(token) : { data: null };
  if (!data?.user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const cfg = pushConfig();
  if (cfg.missing.length) return NextResponse.json({ error: `Missing in Vercel: ${cfg.missing.join(', ')}` }, { status: 500 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, cfg.serviceKey!, { auth: { persistSession: false } });
  const result = await sendToUser(db, data.user.id, { title: 'Test notification', body: 'You’re all set.', url: '/settings', tag: 'test' });
  return NextResponse.json(result);
}
