// Word lists, checked as you type so people see why something won't send.
// The database runs the same checks (banned_terms in supabase/migrations), so editing this
// file alone never lets anything through. Keep the two in sync.

type Term = { term: string; kind: string };

// Blocked everywhere: chat, comments, names, notes, listings
export const EVERYWHERE: Term[] = [
  'nude', 'nudes', 'naked', 'sex', 'sexy', 'sexting', 'porn', 'porno', 'onlyfans', 'hookup', 'horny', 'nsfw',
  'xxx', 'dick', 'cock', 'pussy', 'boobs', 'tits', 'titties', 'blowjob', 'handjob', 'orgasm', 'fetish', 'kinky',
  'milf', 'thot', 'send pics', 'dick pic',
].map((term) => ({ term, kind: 'adult content' })).concat([
  'fuck', 'fucking', 'fucker', 'fucked', 'motherfucker', 'fck', 'fuk', 'stfu', 'shit', 'shitty', 'bullshit',
  'bitch', 'cunt', 'asshole', 'dickhead', 'bastard', 'whore', 'slut', 'hoe',
  'retard', 'retarded', 'faggot', 'fag', 'nigger', 'nigga', 'chink', 'spic', 'kike', 'tranny', 'dyke', 'wetback', 'gook', 'raghead',
  'kys', 'kill yourself', 'kill you',
].map((term) => ({ term, kind: 'language' })));

// Words reviewers added in the app (loaded once after sign-in; the database enforces them either way)
let extraEverywhere: Term[] = [];
let extraListings: Term[] = [];
export function setExtraTerms(rows: { term: string; everywhere: boolean }[]) {
  extraEverywhere = rows.filter((r) => r.everywhere).map((r) => ({ term: r.term, kind: 'blocked' }));
  extraListings = rows.filter((r) => !r.everywhere).map((r) => ({ term: r.term, kind: 'blocked' }));
}

// Blocked on listings and the ISO board only (fine to mention in chat: "after my exam")
export const LISTINGS_ONLY: Term[] = [
  { term: 'answer key', kind: 'academic' }, { term: 'answers', kind: 'academic' },
  { term: 'exam', kind: 'academic' }, { term: 'midterm', kind: 'academic' },
  { term: 'problem set', kind: 'academic' }, { term: 'homework', kind: 'academic' },
  { term: 'essay writing', kind: 'academic' },
  { term: 'adderall', kind: 'drugs' }, { term: 'weed', kind: 'drugs' },
  { term: 'vape', kind: 'drugs' }, { term: 'edible', kind: 'drugs' },
  { term: 'alcohol', kind: 'alcohol' }, { term: 'beer', kind: 'alcohol' }, { term: 'vodka', kind: 'alcohol' },
  { term: 'fake id', kind: 'IDs' },
  { term: 'gun', kind: 'weapons' }, { term: 'knife', kind: 'weapons' },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The text as typed, plus versions with common disguises undone:
// 0→o 1→i 3→e 4→a 5→s 7→t @→a $→s !→i, and stretched letters ("nuuudes", "boooobs")
function variants(text: string): string {
  const lower = (text || '').toLowerCase();
  const swapped = lower.replace(/[013457@$!]/g, (c) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' })[c]!);
  return [lower, swapped, swapped.replace(/([a-z])\1{2,}/g, '$1'), swapped.replace(/([a-z])\1{2,}/g, '$1$1')].join(' | ');
}

// Whole words (plus a plural "s"/"es"), so "analysis" doesn't trip "anal" and "begun" doesn't trip "gun".
function match(text: string, list: Term[]): Term | null {
  const t = variants(text);
  for (const b of [...list].sort((a, c) => c.term.length - a.term.length)) {
    if (new RegExp(`\\b${escape(b.term)}(s|es)?\\b`).test(t)) return b;
  }
  return null;
}

/** Listings and ISO posts: both lists */
export const bannedMatch = (text: string) => match(text, [...EVERYWHERE, ...LISTINGS_ONLY, ...extraEverywhere, ...extraListings]);
/** Chat, comments, names, notes: the everywhere list */
export const blockedAnywhere = (text: string) => match(text, [...EVERYWHERE, ...extraEverywhere]);
