import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRoomStore } from '../src/rooms.js';
import { createMemoryRoutes } from '../src/memories.js';
import { sanitizeMemoryMeta, sanitizeVoiceSignal, sniffImage } from '../src/validate.js';

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

test('sniffImage trusts the bytes, not the name: WebP, JPEG and PNG only', () => {
  assert.equal(sniffImage(WEBP), 'image/webp');
  assert.equal(sniffImage(JPEG), 'image/jpeg');
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImage(Buffer.from('GIF89a......................')), null);
  assert.equal(sniffImage(Buffer.alloc(4)), null);
});

test('memory metadata: control characters out, length capped, bad dates dropped', () => {
  const meta = sanitizeMemoryMeta({ caption: encodeURIComponent('  Our\n first\t trip \u0007 '.padEnd(300, '!')), date: '2019-06-14' });
  assert.equal(meta.date, '2019-06-14');
  assert.ok(meta.caption.length <= 140);
  assert.ok(!/[\u0000-\u001f]/.test(meta.caption));
  assert.ok(meta.caption.startsWith('Our first trip'));
  assert.equal(sanitizeMemoryMeta({ caption: '%E0%A4%A', date: '2019-13-45' }).date, '');
  assert.deepEqual(sanitizeMemoryMeta({}), { caption: '', date: '' });
});

test('voice signals are rebuilt from validated fields only', () => {
  assert.deepEqual(sanitizeVoiceSignal({ sid: 'abc-1', kind: 'offer', data: { sdp: 'v=0', evil: 1 }, extra: 1 }), { sid: 'abc-1', kind: 'offer', data: { sdp: 'v=0' } });
  assert.deepEqual(
    sanitizeVoiceSignal({ sid: 'abc', kind: 'candidate', data: { candidate: 'candidate:1 1 udp', sdpMid: '0', sdpMLineIndex: 0 } }),
    { sid: 'abc', kind: 'candidate', data: { candidate: 'candidate:1 1 udp', sdpMid: '0', sdpMLineIndex: 0 } },
  );
  assert.deepEqual(sanitizeVoiceSignal({ sid: 'abc', kind: 'bye' }), { sid: 'abc', kind: 'bye', data: null });
  assert.deepEqual(sanitizeVoiceSignal({ sid: 'hello', kind: 'hello', data: { x: 1 } }), { sid: 'hello', kind: 'hello', data: null });
  assert.equal(sanitizeVoiceSignal({ sid: 'abc', kind: 'offer', data: { sdp: 'x'.repeat(30_000) } }), null);
  assert.equal(sanitizeVoiceSignal({ sid: 'a b', kind: 'bye' }), null);
  assert.equal(sanitizeVoiceSignal({ sid: 'abc', kind: 'rpc', data: {} }), null);
  assert.equal(sanitizeVoiceSignal({ sid: 'abc', kind: 'candidate', data: { candidate: 1 } }), null);
  assert.equal(sanitizeVoiceSignal({ sid: 'abc', kind: 'candidate', data: { candidate: '', sdpMLineIndex: 99 } }), null);
  assert.equal(sanitizeVoiceSignal(null), null);
});

test('voice signalling goes to the partner only while they are connected', () => {
  const store = createRoomStore();
  const host = store.create('s-host');
  assert.equal(store.peerSocketId('s-host'), null);
  store.join('s-guest', host.key);
  assert.equal(store.peerSocketId('s-host'), 's-guest');
  assert.equal(store.peerSocketId('s-guest'), 's-host');
  assert.equal(store.peerSocketId('s-stranger'), null);
  store.detach('s-guest');
  assert.equal(store.peerSocketId('s-host'), null);
});

test('memories: need a token, take the lowest free spot, free it when removed, and stop at the room limit', () => {
  const store = createRoomStore();
  const host = store.create('s-host');
  const guest = store.join('s-guest', host.key);
  const photo = { caption: 'c', date: '', type: 'image/webp', bytes: WEBP };

  assert.equal(store.addMemory(host.roomId, 'wrong', photo).error, 'unauthorized');
  assert.equal(store.addMemory('nope', host.token, photo).error, 'unauthorized');

  const a = store.addMemory(host.roomId, host.token, photo);
  const b = store.addMemory(host.roomId, guest.token, photo);
  assert.deepEqual([a.memory.index, b.memory.index], [0, 1]);
  assert.deepEqual(a.sockets.sort(), ['s-guest', 's-host']);
  assert.ok(a.memory.id.length >= 22);
  assert.equal(store.memoryList('s-host').length, 2);
  assert.equal(store.getMemory(host.roomId, a.memory.id).bytes, WEBP);

  assert.equal(store.removeMemory('s-guest', a.memory.id), 's-host');
  assert.equal(store.removeMemory('s-guest', a.memory.id), undefined);
  assert.equal(store.addMemory(host.roomId, host.token, photo).memory.index, 0); // the freed spot

  const roomless = createRoomStore();
  const h = roomless.create('x');
  const now = Date.now();
  let last;
  for (let i = 0; i < 12; i++) last = roomless.addMemory(h.roomId, h.token, photo, now + i * 60_000);
  assert.ok(last.memory);
  assert.equal(roomless.addMemory(h.roomId, h.token, photo, now + 13 * 60_000).error, 'room_full');
});

test('memories: at most six uploads a minute', () => {
  const store = createRoomStore();
  const host = store.create('s-host');
  const photo = { caption: '', date: '', type: 'image/png', bytes: PNG };
  const now = Date.now();
  for (let i = 0; i < 6; i++) assert.ok(store.addMemory(host.roomId, host.token, photo, now + i).memory);
  assert.equal(store.addMemory(host.roomId, host.token, photo, now + 10).error, 'too_fast');
  assert.ok(store.addMemory(host.roomId, host.token, photo, now + 61_000).memory);
});

// ---- HTTP round trip ---------------------------------------------------------------------------

async function withServer(fn) {
  const store = createRoomStore();
  const announced = [];
  const handle = createMemoryRoutes({ store, origins: ['http://localhost:5173'], announce: (sockets, memory) => announced.push({ sockets, memory }) });
  const server = http.createServer(async (req, res) => {
    if (!(await handle(req, res))) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ store, base, announced });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, roomId, token, body, headers = {}) =>
  fetch(`${base}/api/rooms/${roomId}/memories`, { method: 'POST', body, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } });

test('HTTP: upload, announce, download, and the checks that refuse bad requests', () =>
  withServer(async ({ store, base, announced }) => {
    const host = store.create('s-host');
    const guest = store.join('s-guest', host.key);

    const res = await post(base, host.roomId, host.token, WEBP, { 'X-Caption': encodeURIComponent('First snow'), 'X-Date': '2021-12-12', Origin: 'http://localhost:5173' });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const { memory } = await res.json();
    assert.equal(memory.caption, 'First snow');
    assert.equal(memory.date, '2021-12-12');
    assert.equal(announced.length, 1);
    assert.deepEqual(announced[0].sockets.sort(), ['s-guest', 's-host']);

    const got = await fetch(`${base}/api/rooms/${host.roomId}/memories/${memory.id}`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-type'), 'image/webp');
    assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), WEBP);
    assert.equal((await fetch(`${base}/api/rooms/${host.roomId}/memories/unknown`)).status, 404);

    assert.equal((await post(base, host.roomId, null, WEBP)).status, 401);
    assert.equal((await post(base, host.roomId, 'not-the-token', WEBP)).status, 401);
    assert.equal((await post(base, host.roomId, guest.token, Buffer.from('<svg/>'.padEnd(64, ' ')))).status, 415);
    assert.equal((await post(base, host.roomId, guest.token, Buffer.alloc(1_600_000, 1))).status, 413);
    assert.equal(announced.length, 1); // nothing refused was announced

    const preflight = await fetch(`${base}/api/rooms/${host.roomId}/memories`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
    const stranger = await fetch(`${base}/api/rooms/${host.roomId}/memories/${memory.id}`, { headers: { Origin: 'http://evil.example' } });
    assert.equal(stranger.headers.get('access-control-allow-origin'), null); // another site's scripts can't read it

    assert.equal((await fetch(`${base}/elsewhere`)).status, 404);
  }));
