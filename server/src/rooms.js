import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// Look-alike characters (0/O, 1/I/L) are left out so the key is easy to read aloud.
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const KEY_LENGTH = 8;
const EMPTY_ROOM_TTL_MS = 60_000;
const MAX_CURTAINS_PER_ROOM = 500; // bounds memory if a client sends junk ids
export const MAX_MEMORIES_PER_ROOM = 12; // wall spots set aside for them (client/src/gallery/memorySlots.js)
const MAX_MEMORY_BYTES_TOTAL = 256 * 1024 * 1024; // across every room on this server

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const newToken = () => randomBytes(24).toString('base64url');
const newSlot = () => ({ token: null, socketId: null, connected: false, state: null, dirty: false });

const safeEqual = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function generateKey() {
  let key = '';
  for (let i = 0; i < KEY_LENGTH; i++) key += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
  return key;
}

/**
 * In-memory room registry. Two slots per room: 'host' (the boy) and 'guest' (the girl).
 * Only a SHA-256 hash of the key is stored; the plaintext key is returned once, to the host.
 * Swap this for Redis if you ever run more than one server process.
 */
export function createRoomStore({ ttlMs = EMPTY_ROOM_TTL_MS } = {}) {
  const rooms = new Map(); // roomId -> room
  const roomIdByKeyHash = new Map(); // keyHash -> roomId
  const linkBySocket = new Map(); // socketId -> { roomId, role }
  let memoryBytes = 0; // photos held in memory, all rooms

  function attach(room, role, socketId) {
    const slot = room.slots[role];
    slot.socketId = socketId;
    slot.connected = true;
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
    linkBySocket.set(socketId, { roomId: room.id, role });
  }

  function destroy(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    clearTimeout(room.cleanupTimer);
    roomIdByKeyHash.delete(room.keyHash);
    for (const m of room.memories.values()) memoryBytes -= m.bytes.length;
    rooms.delete(roomId);
  }

  const meta = ({ id, index, caption, date, type }) => ({ id, index, caption, date, type });
  const roleFor = (room, token) =>
    typeof token === 'string' ? ['host', 'guest'].find((r) => room.slots[r].token && safeEqual(room.slots[r].token, token)) : undefined;

  return {
    rooms,

    create(socketId) {
      const key = generateKey();
      const room = {
        id: randomBytes(12).toString('base64url'),
        keyHash: sha256(key),
        slots: { host: newSlot(), guest: newSlot() },
        curtains: new Map(), // painting id -> true (held open) | false (held closed)
        memories: new Map(), // id -> { id, index, caption, date, type, bytes: Buffer }
        uploads: [], // timestamps of recent uploads, for the rate limit
        cleanupTimer: null,
      };
      room.slots.host.token = newToken();
      rooms.set(room.id, room);
      roomIdByKeyHash.set(room.keyHash, room.id);
      attach(room, 'host', socketId);
      return { roomId: room.id, key, role: 'host', token: room.slots.host.token };
    },

    join(socketId, key) {
      const roomId = roomIdByKeyHash.get(sha256(key));
      const room = roomId && rooms.get(roomId);
      if (!room) return { error: 'invalid_key' };

      // Once the guest seat is claimed, the same person returns via resume() with their token.
      if (room.slots.guest.token) return { error: 'room_full' };

      room.slots.guest.token = newToken();
      attach(room, 'guest', socketId);
      return {
        roomId: room.id,
        role: 'guest',
        token: room.slots.guest.token,
        peerSocketId: room.slots.host.socketId,
        peerConnected: room.slots.host.connected,
      };
    },

    resume(socketId, roomId, token) {
      const room = rooms.get(roomId);
      if (!room || typeof token !== 'string') return { error: 'not_found' };

      const role = ['host', 'guest'].find((r) => room.slots[r].token && safeEqual(room.slots[r].token, token));
      if (!role) return { error: 'bad_token' };

      // A reconnect may arrive before the old socket's disconnect fires; the newest socket wins.
      linkBySocket.delete(room.slots[role].socketId);
      attach(room, role, socketId);

      const peer = room.slots[role === 'host' ? 'guest' : 'host'];
      return { roomId, role, token, peerSocketId: peer.socketId, peerConnected: peer.connected };
    },

    /** Returns the detached room info, or null if the socket wasn't seated (or was superseded). */
    detach(socketId) {
      const link = linkBySocket.get(socketId);
      if (!link) return null;
      linkBySocket.delete(socketId);

      const room = rooms.get(link.roomId);
      const slot = room.slots[link.role];
      if (slot.socketId !== socketId) return null;

      slot.connected = false;
      slot.socketId = null;
      slot.state = null;
      slot.dirty = false;

      const peerRole = link.role === 'host' ? 'guest' : 'host';
      const peer = room.slots[peerRole];
      if (!peer.connected) {
        room.cleanupTimer = setTimeout(() => destroy(room.id), ttlMs);
        room.cleanupTimer.unref();
      }
      return { roomId: room.id, role: link.role, peerSocketId: peer.socketId };
    },

    updateState(socketId, sample) {
      const link = linkBySocket.get(socketId);
      if (!link) return false;
      const slot = rooms.get(link.roomId).slots[link.role];
      slot.state = sample;
      slot.dirty = true;
      return true;
    },

    /**
     * Records a curtain override for the socket's room. open: true | false | null (null clears it).
     * Returns the partner's socket id to relay to (or null), or undefined if the socket has no seat
     * or the room is at its curtain limit.
     */
    setCurtain(socketId, id, open) {
      const link = linkBySocket.get(socketId);
      if (!link) return undefined;
      const room = rooms.get(link.roomId);
      if (open === null) room.curtains.delete(id);
      else if (room.curtains.has(id) || room.curtains.size < MAX_CURTAINS_PER_ROOM) room.curtains.set(id, open);
      else return undefined;
      const peer = room.slots[link.role === 'host' ? 'guest' : 'host'];
      return peer.connected ? peer.socketId : null;
    },

    /** The other player's socket id, if they are connected: where voice signalling goes. */
    peerSocketId(socketId) {
      const link = linkBySocket.get(socketId);
      if (!link) return null;
      const peer = rooms.get(link.roomId).slots[link.role === 'host' ? 'guest' : 'host'];
      return peer.connected ? peer.socketId : null;
    },

    /**
     * Adds a photo to a room, for whoever holds one of its two tokens. It takes the lowest free spot.
     * Returns { memory, sockets } (both players' sockets, to announce it), or { error }.
     */
    addMemory(roomId, token, { caption, date, type, bytes }, now = Date.now()) {
      const room = rooms.get(roomId);
      if (!room || !roleFor(room, token)) return { error: 'unauthorized' };
      room.uploads = room.uploads.filter((t) => now - t < 60_000);
      if (room.uploads.length >= 6) return { error: 'too_fast' };
      if (room.memories.size >= MAX_MEMORIES_PER_ROOM) return { error: 'room_full' };
      if (memoryBytes + bytes.length > MAX_MEMORY_BYTES_TOTAL) return { error: 'server_full' };

      const taken = new Set([...room.memories.values()].map((m) => m.index));
      let index = 0;
      while (taken.has(index)) index += 1;
      const memory = { id: randomBytes(16).toString('base64url'), index, caption, date, type, bytes };
      room.memories.set(memory.id, memory);
      room.uploads.push(now);
      memoryBytes += bytes.length;
      return { memory: meta(memory), sockets: ['host', 'guest'].map((r) => room.slots[r].socketId).filter(Boolean) };
    },

    /** A photo's bytes. The id is an unguessable capability, known only to the room's two players. */
    getMemory(roomId, id) {
      const memory = rooms.get(roomId)?.memories.get(id);
      return memory ? { type: memory.type, bytes: memory.bytes } : null;
    },

    /** The room's photos (without bytes), for a player joining or resuming. */
    memoryList(socketId) {
      const link = linkBySocket.get(socketId);
      if (!link) return [];
      return [...rooms.get(link.roomId).memories.values()].map(meta);
    },

    /** Removes a photo, freeing its wall spot. Returns the partner's socket id (or null), or undefined if not found. */
    removeMemory(socketId, id) {
      const link = linkBySocket.get(socketId);
      if (!link) return undefined;
      const room = rooms.get(link.roomId);
      const memory = room.memories.get(id);
      if (!memory) return undefined;
      room.memories.delete(id);
      memoryBytes -= memory.bytes.length;
      const peer = room.slots[link.role === 'host' ? 'guest' : 'host'];
      return peer.connected ? peer.socketId : null;
    },

    /** The room's curtain overrides as a plain object, for a player joining or resuming. */
    curtainSnapshot(socketId) {
      const link = linkBySocket.get(socketId);
      if (!link) return {};
      return Object.fromEntries(rooms.get(link.roomId).curtains);
    },

    /** Calls fn(peerSocketId, state) for every seat whose state changed since the last flush. */
    flushDirty(fn) {
      for (const room of rooms.values()) {
        for (const role of ['host', 'guest']) {
          const slot = room.slots[role];
          if (!slot.dirty) continue;
          slot.dirty = false;
          const peer = room.slots[role === 'host' ? 'guest' : 'host'];
          if (peer.connected && peer.socketId) fn(peer.socketId, slot.state);
        }
      }
    },
  };
}
