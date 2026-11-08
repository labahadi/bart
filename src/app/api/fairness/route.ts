// AI fairness check: "is this swap roughly even?"
// Runs on the server so the Anthropic API key never reaches the browser.
// Advice only: it never blocks an offer.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const MODEL = 'claude-haiku-5-5';
const SWEETENERS = ['Coffee on me', 'Help moving it', 'Class notes'];

type Item = {
  id: string; title: string; description: string | null; category: string; tier: string;
  condition: string | null; photo_paths: string[];
};

const SYSTEM = `You help college students on bart, a campus barter app with no money, judge whether a proposed swap is roughly fair.
Judge by what a typical student would think each side is worth: used resale value, condition, and how useful it is on campus.
For skills and time, think about what an hour of that help is usually worth to a student. Small extras ("sweeteners") count a little: a coffee is small, helping move something is a bit more, class notes are in between.
Be neutral and brief. This is advice only; the two students decide.
Reply with JSON only, no other text:
{"verdict": "even" | "offer_higher" | "offer_lower", "confidence": "low" | "medium" | "high", "reason": "<one plain sentence, under 25 words, no prices or dollar amounts>"}
"offer_higher" means the OFFERED side is worth clearly more than the REQUESTED item; "offer_lower" means clearly less; "even" means within reason.
Use "low" confidence when titles are vague or there are no photos.`;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'not_configured' }, { status: 501 });

  // Only signed-in students can use this (it costs money per call)
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: user } = await supabase.auth.getUser(token);
  if (!user?.user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => null) as { target?: string; items?: string[]; sweeteners?: string[] } | null;
  const ids = [body?.target, ...(body?.items ?? [])].filter(Boolean) as string[];
  if (!body?.target || !body.items?.length || ids.length > 8) {
    return NextResponse.json({ error: 'Pick at least one item.' }, { status: 400 });
  }

  // Read the listings as this user, so the database's access rules still apply
  const { data: rows, error } = await supabase.from('listings')
    .select('id,title,description,category,tier,condition,photo_paths').in('id', ids);
  if (error || !rows) return NextResponse.json({ error: 'Could not load the items.' }, { status: 400 });
  const byId = new Map((rows as Item[]).map((r) => [r.id, r]));
  const target = byId.get(body.target);
  const offered = body.items.map((i) => byId.get(i)).filter(Boolean) as Item[];
  if (!target || offered.length === 0) return NextResponse.json({ error: 'Could not load the items.' }, { status: 400 });
  const sweet = (body.sweeteners ?? []).filter((s) => SWEETENERS.includes(s));

  const photo = (it: Item) => it.photo_paths?.[0]
    ? [{ type: 'image', source: { type: 'url', url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/listing-photos/${it.photo_paths[0]}` } }]
    : [];
  const describe = (it: Item) =>
    `- ${it.title} (category: ${it.category}; size tier ${it.tier}${it.condition ? `; ${it.condition}` : ''})${it.description ? `: ${it.description.slice(0, 300)}` : ''}`;

  const content = [
    { type: 'text', text: `REQUESTED item:\n${describe(target)}` },
    ...photo(target),
    { type: 'text', text: `OFFERED in exchange:\n${offered.map(describe).join('\n')}${sweet.length ? `\nPlus: ${sweet.join(', ')}` : ''}` },
    ...offered.flatMap(photo),
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 200, system: SYSTEM, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) {
    console.error('Fairness check failed', res.status, await res.text().catch(() => ''));
    return NextResponse.json({ error: 'The AI check is unavailable right now.' }, { status: 502 });
  }
  const data = await res.json();
  const text: string = data?.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '';
  try {
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!['even', 'offer_higher', 'offer_lower'].includes(parsed.verdict)) throw new Error('bad verdict');
    return NextResponse.json({
      verdict: parsed.verdict,
      confidence: ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'low',
      reason: String(parsed.reason ?? '').slice(0, 200),
    });
  } catch {
    return NextResponse.json({ error: 'The AI check gave an unclear answer. Try again.' }, { status: 502 });
  }
}
