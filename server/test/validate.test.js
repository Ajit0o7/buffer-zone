import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKey, sanitizeCurtain, sanitizeState, WORLD_BOUND, MAX_SPEED } from '../src/validate.js';

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

test('sanitizeCurtain accepts open, closed and cleared', () => {
  assert.deepEqual(sanitizeCurtain({ id: 'the-yes', open: true }), { id: 'the-yes', open: true });
  assert.deepEqual(sanitizeCurtain({ id: 'a_1', open: false }), { id: 'a_1', open: false });
  assert.deepEqual(sanitizeCurtain({ id: 'a', open: null }), { id: 'a', open: null });
});

test('sanitizeCurtain rejects bad ids and values', () => {
  assert.equal(sanitizeCurtain({ id: '', open: true }), null);
  assert.equal(sanitizeCurtain({ id: 'x'.repeat(65), open: true }), null);
  assert.equal(sanitizeCurtain({ id: '../etc', open: true }), null);
  assert.equal(sanitizeCurtain({ id: 'a', open: 'yes' }), null);
  assert.equal(sanitizeCurtain({ id: 'a' }), null);
  assert.equal(sanitizeCurtain(null), null);
});
