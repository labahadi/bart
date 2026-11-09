// Ask the server's AI check before posting something public. Returns '' if it's fine,
// or the reason it isn't. Chat doesn't use this (full names are fine in chat).
import { supabase } from '@/lib/supabase';

export async function screenText(...texts: (string | null | undefined)[]) {
  const list = texts.filter((t): t is string => !!t && !!t.trim());
  if (!list.length) return '';
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch('/api/screen', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${sess.session?.access_token ?? ''}` },
    body: JSON.stringify({ texts: list }),
  }).catch(() => null);
  if (!res?.ok) return '';
  const json = await res.json().catch(() => ({}));
  return json.ok === false ? (json.error as string) : '';
}
