// AI check for anything posted where other students can see it (listings, ISO posts, comments,
// trade notes). Chat skips this. It refuses two things the word list can't catch reliably:
//   - a real private person's full name (first and last), e.g. a classmate or roommate
//   - nasty language in any form: slurs, harassment, threats, sexual content, disguised swearing
// If the AI is unavailable the post goes through; the word list in the database still applies.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const MODEL = 'claude-haiku-5-5';

const SYSTEM = `You screen short posts on bart, a campus barter app for Penn students. Posts are listings, "in search of" requests, comments and trade notes that other students will see.
Flag a post if it contains either:
1. "full_name": the full name (first AND last name) of a real private person, such as a student, roommate, friend, TA or ex. A first name alone, a first name with a last initial ("Jordan L."), or an @handle is fine. Names of public figures, celebrities, musicians, athletes, authors, artists, brands, products, buildings, dorms and courses are fine (for example "Taylor Swift tickets", "Calculus by James Stewart", "Jordan 1s", "Van Pelt Library").
2. "language": slurs, insults or harassment aimed at people or groups, threats, sexual content, or swearing, including disguised spellings (f*ck, sh!t, a$$hole, spaced-out letters).
Ordinary words that only look similar are fine ("Scunthorpe", "class", "cocktail dress").
Reply with JSON only: {"flag": null | "full_name" | "language", "quote": "<the exact words that caused it, or empty>"}`;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, skipped: true });

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data: user } = await supabase.auth.getUser(token);
  if (!user?.user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => null) as { texts?: string[] } | null;
  const text = (body?.texts ?? []).filter((t) => typeof t === 'string' && t.trim()).map((t) => t.slice(0, 700)).join('\n---\n');
  if (!text) return NextResponse.json({ ok: true });

  // Asked twice if the first answer can't be read
  const ask = async (): Promise<{ flag?: string | null; quote?: string } | null> => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYSTEM, messages: [{ role: 'user', content: `Post:\n${text}` }] }),
    }).catch(() => null);
    if (!res?.ok) return null;
    const raw: string = (await res.json().catch(() => null))?.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '';
    try { return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { return null; }
  };
  const out = (await ask()) ?? (await ask());
  if (!out) return NextResponse.json({ ok: true, skipped: true });

  if (out.flag === 'full_name') {
    return NextResponse.json({ ok: false, flag: 'full_name', error: `Full names aren't allowed on bart outside chat${out.quote ? ` ("${out.quote}")` : ''}. Use a first name or initials.` });
  }
  if (out.flag === 'language') {
    return NextResponse.json({ ok: false, flag: 'language', error: "That includes language that isn't allowed on bart." });
  }
  return NextResponse.json({ ok: true });
}
