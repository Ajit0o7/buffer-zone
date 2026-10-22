import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKey, sanitizeState, WORLD_BOUND, MAX_SPEED } from '../src/validate.js';

test('normalizeKey accepts dashes, spaces and lowercase', () => {
  assert.equal(normalizeKey('abcd-efgh'), 'ABCDEFGH');
  assert.equal(normalizeKey(' ab cd '), 'ABCD');
});

test('normalizeKey rejects malformed input', () => {
  assert.equal(normalizeKey(''), '');
  assert.equal(normalizeKey('abc'), '');
  assert.equal(normalizeKey('a'.repeat(17)), '');
  assert.equal(normalizeKey(undefined), '');
  assert.equal(normalizeKey(12345), '');
});

test('sanitizeState clamps positions and speed', () => {
  const s = sanitizeState({ p: [9999, 0, -9999], r: 1, a: 'walk', v: 99 }, 5);
  assert.deepEqual(s.p, [WORLD_BOUND, 0, -WORLD_BOUND]);
  assert.equal(s.v, MAX_SPEED);
  assert.equal(s.t, 5);
});

test('sanitizeState whitelists animation names and fixes bad rotation', () => {
  const s = sanitizeState({ p: [0, 0, 0], r: 'x', a: 'fly', v: 1 });
  assert.equal(s.a, 'idle');
  assert.equal(s.r, 0);
});

test('sanitizeState rejects non-numeric or wrong-length positions', () => {
  assert.equal(sanitizeState({ p: [0, 0] }), null);
  assert.equal(sanitizeState({ p: [0, NaN, 0] }), null);
  assert.equal(sanitizeState({ p: ['1', 0, 0] }), null);
  assert.equal(sanitizeState(null), null);
});
