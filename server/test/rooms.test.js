import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomStore } from '../src/rooms.js';
import { normalizeKey } from '../src/validate.js';

test('host creates a room and receives a key', () => {
  const store = createRoomStore();
  const r = store.create('s-host');
  assert.equal(r.role, 'host');
  assert.equal(r.key.length, 8);
  assert.ok(r.token.length >= 32);
});

test('guest joins with the key, and a third person is refused', () => {
  const store = createRoomStore();
  const { key } = store.create('s-host');
  const guest = store.join('s-guest', normalizeKey(key.toLowerCase()));
  assert.equal(guest.role, 'guest');
  assert.equal(guest.peerConnected, true);
  assert.deepEqual(store.join('s-third', key), { error: 'room_full' });
});

test('an unknown key is rejected', () => {
  const store = createRoomStore();
  store.create('s-host');
  assert.deepEqual(store.join('s-x', 'ZZZZZZZZ'), { error: 'invalid_key' });
});

test('resume reclaims a seat with the right token only', () => {
  const store = createRoomStore();
  const host = store.create('s-host');
  const { key } = { key: host.key };
  const g = store.join('s-guest', key);
  store.detach('s-guest');
  assert.equal(store.resume('s-guest-2', host.roomId, 'wrong').error, 'bad_token');
  const back = store.resume('s-guest-2', host.roomId, g.token);
  assert.equal(back.role, 'guest');
});

test('the newest socket wins when a seat reconnects before the old disconnect', () => {
  const store = createRoomStore();
  const host = store.create('s-host');
  store.join('s-guest', host.key);
  store.resume('s-guest-new', host.roomId, store.rooms.get(host.roomId).slots.guest.token);
  assert.equal(store.detach('s-guest'), null); // stale disconnect must not evict the new socket
  assert.ok(store.updateState('s-guest-new', { p: [0, 0, 0] }));
});

test('flushDirty only forwards changed state, to the partner', () => {
  const store = createRoomStore();
  const host = store.create('s-host');
  store.join('s-guest', host.key);
  const sent = [];
  store.flushDirty((to, state) => sent.push([to, state]));
  assert.deepEqual(sent, []);
  store.updateState('s-host', { p: [1, 2, 3] });
  store.flushDirty((to, state) => sent.push([to, state]));
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 's-guest');
  store.flushDirty((to, state) => sent.push([to, state]));
  assert.equal(sent.length, 1); // already flushed
});

test('an empty room is destroyed after the TTL', async () => {
  const store = createRoomStore({ ttlMs: 20 });
  const host = store.create('s-host');
  store.detach('s-host');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(store.rooms.has(host.roomId), false);
});

test('curtain overrides are relayed to the partner and kept for the room', () => {
  const store = createRoomStore();
  const host = store.create('s-host');
  assert.equal(store.setCurtain('s-host', 'the-yes', true), null); // partner not here yet: nothing to relay
  store.join('s-guest', host.key);
  assert.deepEqual(store.curtainSnapshot('s-guest'), { 'the-yes': true });
  assert.equal(store.setCurtain('s-guest', 'first-trip', false), 's-host');
  assert.equal(store.setCurtain('s-host', 'the-yes', null), 's-guest');
  assert.deepEqual(store.curtainSnapshot('s-host'), { 'first-trip': false });
});

test('curtain events from a socket without a seat are ignored', () => {
  const store = createRoomStore();
  assert.equal(store.setCurtain('nobody', 'a', true), undefined);
  assert.deepEqual(store.curtainSnapshot('nobody'), {});
});

test('a room holds at most 500 curtain overrides', () => {
  const store = createRoomStore();
  store.create('s-host');
  for (let i = 0; i < 500; i++) store.setCurtain('s-host', 'p' + i, true);
  assert.equal(store.setCurtain('s-host', 'one-more', true), undefined);
  assert.equal(store.setCurtain('s-host', 'p0', false), null); // updating an existing one still works
});
