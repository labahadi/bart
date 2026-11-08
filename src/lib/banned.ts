// Banned-item list, checked as you type on the Post screen.
// The database runs the same check (supabase/migrations/0001_core.sql, banned_terms),
// so editing this list alone doesn't let anything through. Keep the two in sync.

export const BANNED: { term: string; kind: string }[] = [
  { term: 'answer key', kind: 'academic' }, { term: 'answers', kind: 'academic' },
  { term: 'exam', kind: 'academic' }, { term: 'midterm', kind: 'academic' },
  { term: 'problem set', kind: 'academic' }, { term: 'homework', kind: 'academic' },
  { term: 'essay writing', kind: 'academic' },
  { term: 'adderall', kind: 'drugs' }, { term: 'weed', kind: 'drugs' },
  { term: 'vape', kind: 'drugs' }, { term: 'edible', kind: 'drugs' },
  { term: 'alcohol', kind: 'alcohol' }, { term: 'beer', kind: 'alcohol' }, { term: 'vodka', kind: 'alcohol' },
  { term: 'fake id', kind: 'IDs' },
  { term: 'gun', kind: 'weapons' }, { term: 'knife', kind: 'weapons' },
  { term: 'nude', kind: 'adult content' }, { term: 'hookup', kind: 'adult content' },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole words (plus a plural "s"/"es"), so "incredible" doesn't trip "edible"
// and "begun" doesn't trip "gun". Longest term wins ("answer key" before "answers").
export function bannedMatch(text: string): { term: string; kind: string } | null {
  const t = (text || '').toLowerCase();
  const sorted = [...BANNED].sort((a, b) => b.term.length - a.term.length);
  for (const b of sorted) {
    if (new RegExp(`\\b${escape(b.term)}(s|es)?\\b`).test(t)) return b;
  }
  return null;
}
