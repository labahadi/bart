// Photo upload with a safety check. Phones can't upload photos directly (the database blocks it);
// every photo comes through here, gets checked by AI, and is only stored if it's allowed.
// Needs two server-only keys in .env.local / Vercel: ANTHROPIC_API_KEY and SUPABASE_SERVICE_ROLE_KEY.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const MODEL = 'claude-haiku-5-5';
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const RULES = `You check photos uploaded to bart, a campus trading app for college students, before anyone else sees them.
Block a photo only for these reasons:
- "sexual": nudity or partial nudity, sexual content, poses or gestures, sexualized photos of people in underwear or swimwear, genitals (even covered or drawn), sex toys. For this reason only, block when unsure.
- "violence": graphic violence or gore.
- "hate": hate symbols.
- LISTING photos only, "banned_item": the main subject is drugs or drug gear, a vape, alcohol, a weapon, a fake ID, or an exam/answer key.
PROFILE photos are usually a selfie or a picture of the person; that is fine. For profile photos use only "sexual", "violence" and "hate".
Everything else is allowed, including: messy rooms, a bottle or can that is not the item being traded, kitchen knives in the background, posters, clothing laid out or worn normally, fully clothed people, screenshots, blurry or dark photos. For violence, hate and banned items, block only when it is clearly there.
Reply with JSON only: {"allowed": true | false, "category": "none" | "sexual" | "violence" | "hate" | "banned_item", "what": "<3-6 words naming what you saw, only if blocked>"}`;

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

export async function POST(req: Request) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!anthropicKey || !serviceKey) {
    return NextResponse.json({ error: 'Photos are off until the safety check is set up.' }, { status: 501 });
  }

  // Who is this?
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const asUser = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data: who } = await asUser.auth.getUser(token);
  const userId = who?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { data: paused } = await asUser.rpc('is_suspended', { p_user: userId });
  if (paused === true) return NextResponse.json({ error: 'Your account is paused, so you can\'t send photos right now.' }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const rawKind = form?.get('kind');
  const kind: 'chat' | 'avatar' | 'listing' = rawKind === 'chat' ? 'chat' : rawKind === 'avatar' ? 'avatar' : 'listing';
  const offerId = String(form?.get('offerId') ?? '');
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'No photo.' }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'That photo is too big.' }, { status: 413 });
  if (!OK_TYPES.includes(file.type)) return NextResponse.json({ error: 'Use a JPG or PNG photo.' }, { status: 415 });

  // Chat photos: must be one of the two people in an open trade (checked with their own access rules)
  if (kind === 'chat') {
    const { data: offer } = await asUser.from('offers').select('id,status').eq('id', offerId).maybeSingle();
    if (!offer || !['pending', 'accepted'].includes(offer.status)) {
      return NextResponse.json({ error: "You can't send photos in this chat." }, { status: 403 });
    }
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // The check (asked twice if the first answer can't be read)
  const ask = async () => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1024, system: RULES,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: file.type, data: bytes.toString('base64') } },
          { type: 'text', text: `This is a ${kind === 'chat' ? 'CHAT' : kind === 'avatar' ? 'PROFILE' : 'LISTING'} photo. Is it allowed?` },
        ] }],
      }),
    }).catch(() => null);
    if (!res?.ok) {
      console.error('Photo check failed', res?.status, await res?.text().catch(() => ''));
      return null;
    }
    const text: string = (await res.json())?.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '';
    try {
      const v = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      return typeof v.allowed === 'boolean' ? (v as { allowed: boolean; category?: string; what?: string }) : null;
    } catch { return null; }
  };
  const verdict = (await ask()) ?? (await ask());
  if (!verdict) return NextResponse.json({ error: "Couldn't check this photo. Try again." }, { status: 502 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (!verdict.allowed) {
    // Keep a record so the team can spot repeat attempts
    await admin.from('photo_blocks').insert({
      user_id: userId, kind, category: [verdict.category, verdict.what].filter(Boolean).join(': ') || 'unclear',
      offer_id: kind === 'chat' ? offerId : null,
    });
    const why: Record<string, string> = {
      sexual: "This photo can't be shared on bart.",
      violence: 'This photo looks violent or graphic.',
      hate: 'This photo looks like it includes a hate symbol.',
      banned_item: `This looks like ${verdict.what ? verdict.what.toLowerCase() : 'a banned item'}, which can't be listed on bart.`,
    };
    return NextResponse.json({ error: `${why[verdict.category ?? ''] ?? "This photo isn't allowed on bart."} If that's wrong, try another photo.` }, { status: 422 });
  }

  // Allowed: store it
  const bucket = kind === 'chat' ? 'chat-photos' : 'listing-photos';
  const path = kind === 'chat' ? `${offerId}/${newId()}.jpg` : kind === 'avatar' ? `${userId}/avatar-${newId()}.jpg` : `${userId}/${newId()}.jpg`;
  const up = await admin.storage.from(bucket).upload(path, bytes, { contentType: file.type, upsert: false });
  if (up.error) return NextResponse.json({ error: 'Upload failed. Try again.' }, { status: 500 });

  if (kind === 'listing') return NextResponse.json({ path });

  // Profile photo: point the profile at the new photo, then remove the old one
  if (kind === 'avatar') {
    const { data: before } = await admin.from('profiles').select('avatar_path').eq('id', userId).maybeSingle();
    const { error } = await admin.from('profiles').update({ avatar_path: path }).eq('id', userId);
    if (error) {
      await admin.storage.from(bucket).remove([path]);
      return NextResponse.json({ error: 'Profile photos need one more database update (0017_profile_photos.sql).' }, { status: 500 });
    }
    const old = (before as { avatar_path?: string | null } | null)?.avatar_path;
    if (old && old !== path) await admin.storage.from(bucket).remove([old]);
    return NextResponse.json({ path });
  }

  const { data: message, error } = await admin.from('messages')
    .insert({ offer_id: offerId, sender_id: userId, image_path: path })
    .select('id,sender_id,body,image_path,created_at').single();
  if (error) return NextResponse.json({ error: 'Photo didn\'t send. Try again.' }, { status: 500 });
  return NextResponse.json({ message });
}
