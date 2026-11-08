// Quick checks for the banned-word matcher: npm run test:banned
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Load the TypeScript file without a build step by stripping its type annotations
const src = readFileSync(new URL('./banned.ts', import.meta.url), 'utf8')
  .replace(/export const BANNED: [^=]+=/, 'export const BANNED =')
  .replace(/\(s: string\)/g, '(s)')
  .replace(/\(text: string\): \{ term: string; kind: string \} \| null/, '(text)');
const mod = await import('data:text/javascript,' + encodeURIComponent(src));

test('blocks banned items', () => {
  assert.equal(mod.bannedMatch('Midterm answer key')?.term, 'answer key');
  assert.equal(mod.bannedMatch('Two VAPES')?.term, 'vape');
  assert.equal(mod.bannedMatch('fake ID, barely used')?.kind, 'IDs');
});

test('allows look-alike words', () => {
  for (const ok of ['In incredible condition', 'Example problems book', 'Begun knitting kit', 'Beerhall poster? no', 'Calculus textbook']) {
    // "Beerhall" is one word, so it passes; "beer" alone would not
    assert.equal(mod.bannedMatch(ok), null, ok);
  }
});
