// Quick checks for the word lists: npm run test:banned (Node 22+)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bannedMatch, blockedAnywhere } from './banned.ts';

test('listings: banned items and sexual words', () => {
  assert.equal(bannedMatch('Midterm answer key')?.term, 'answer key');
  assert.equal(bannedMatch('Two VAPES')?.term, 'vape');
  assert.equal(bannedMatch('p0rn dvd')?.term, 'porn');
});

test('chat: sexual words and disguises blocked', () => {
  for (const bad of ['send nudes', 'ur s3xy', 'nuuuudes?', 'nice boooobs', 'nsfw pic']) {
    assert.ok(blockedAnywhere(bad), bad);
  }
});

test('chat: ordinary words allowed', () => {
  for (const ok of ['see you after my exam', 'summa cum laude', 'Essex', 'analysis', 'peacock', 'I will weed the garden', 'In incredible condition']) {
    assert.equal(blockedAnywhere(ok), null, ok);
  }
});
