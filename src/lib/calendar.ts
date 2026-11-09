// Optional Google Calendar link, from the screens' side.
import { supabase } from '@/lib/supabase';

export type FreeTimes = {
  me: { linked: boolean; busy?: { start: string; end: string }[] };
  them: { linked: boolean };
  free: { start: string; end: string; until?: string }[];
  off?: boolean;
};

async function call(path: string, body: unknown) {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(`/api/calendar/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${sess.session?.access_token ?? ''}` },
    body: JSON.stringify(body),
  }).catch(() => null);
  const json = res ? await res.json().catch(() => ({})) : {};
  return { ok: !!res?.ok, json };
}

// Send them to Google; they come back to `back` with ?calendar=linked (or a reason it didn't work)
export async function linkCalendar(back: string) {
  const { ok, json } = await call('connect', { back });
  if (ok && json.url) { window.location.href = json.url; return ''; }
  return json.error ?? "Couldn't start linking your calendar.";
}

export const unlinkCalendar = () => call('disconnect', {});

export async function myCalendar(): Promise<{ provider: string; account_email: string } | null> {
  const { data } = await supabase.rpc('my_calendar');
  return (data as { provider: string; account_email: string }[] | null)?.[0] ?? null;
}

export async function freeTimes(offerId: string, date: string): Promise<FreeTimes | null> {
  const { ok, json } = await call('busy', { offerId, date });
  return ok ? (json as FreeTimes) : null;
}

const HOUR = 60 * 60 * 1000;

// Does a 1-hour meetup starting at `at` clash with anyone's calendar? null = fine or unknown
export function clash(at: Date, t: FreeTimes | null, otherName: string): string | null {
  if (!t || (!t.me.linked && !t.them.linked)) return null;
  const s = at.getTime(), e = s + HOUR;
  if (t.free.some((w) => Date.parse(w.start) <= s && e <= Date.parse(w.end))) return null;
  if (t.me.linked && (t.me.busy ?? []).some((b) => Date.parse(b.start) < e && s < Date.parse(b.end))) return 'You have something on your calendar then.';
  if (t.them.linked) return `${otherName} has something on their calendar then.`;
  return null;
}

// What to say when they come back from Google
export function linkResult(code: string | null) {
  switch (code) {
    case 'linked': return { ok: true, text: 'Calendar linked. bart only sees when you\'re busy, never what the event is.' };
    case 'wrong-email': return { ok: false, text: 'Link the Google account for the same email you use for bart.' };
    case 'cancelled': return { ok: false, text: 'Calendar not linked.' };
    case 'no-access': return { ok: false, text: 'bart needs permission to see when you\'re busy. Try again and allow it.' };
    case 'off': return { ok: false, text: "Calendar linking isn't set up yet." };
    case null: case '': return null;
    default: return { ok: false, text: "Couldn't link your calendar. Try again." };
  }
}
