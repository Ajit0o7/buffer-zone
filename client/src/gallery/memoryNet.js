import { SERVER_URL } from '../net/serverUrl';
import { useMemories } from '../state/memories';
import { useSession } from '../state/session';
import { ROOM_BY_ID } from '../world/rooms';
import { SPOTS, spotsNearest } from './memorySlots';
import { localMotion } from '../world/shared';
import { PHOTOS } from './photos';

// "Add memory": the player picks a photo; the browser shrinks and re-encodes it (which also drops
// location and camera data); it is POSTed to the server with the room token; the server tells both
// players, who hang it on the same wall spot. See docs/MEMORIES.md.

const MAX_SIDE = 1600; // pixels on the longer edge: sharp at the painting's size, ~300 KB
const MAX_BYTES = 1_400_000; // the server's limit is 1.5 MB

export const memoryUrl = (roomId, id) => `${SERVER_URL}/api/rooms/${roomId}/memories/${id}`;

const ERRORS = {
  not_image: 'That file is not a picture.',
  unreadable: 'That picture could not be opened. Try a JPEG or PNG.',
  unauthorized: 'Your seat in the house has expired. Refresh and rejoin.',
  too_fast: 'Slow down: six photos a minute at most.',
  room_full: 'Every curtain already has one of your photos. Remove one first.',
  server_full: 'The house has no space left for photos right now.',
  too_large: 'That picture is too large even after shrinking.',
  unsupported_type: 'That picture format is not supported.',
  network: 'Could not reach the house. Check your connection, and that the game server is running (restart it after updating).',
};
export const errorText = (code) => ERRORS[code] ?? 'Something went wrong. Try again.';

/** Shrinks a picture to at most MAX_SIDE and encodes it as WebP (JPEG where the browser can't), under MAX_BYTES. */
export async function prepareImage(file) {
  if (!file?.type?.startsWith('image/')) throw Object.assign(new Error('not an image'), { code: 'not_image' });
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); // honours the camera's rotation
  } catch {
    throw Object.assign(new Error('cannot decode'), { code: 'unreadable' });
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const toBlob = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  for (const type of ['image/webp', 'image/jpeg']) {
    for (let quality = 0.86; quality >= 0.5; quality -= 0.12) {
      const blob = await toBlob(type, quality);
      if (!blob || blob.type !== type) break; // this browser can't encode that type
      if (blob.size <= MAX_BYTES) return { blob, width: canvas.width, height: canvas.height };
    }
  }
  throw Object.assign(new Error('too large'), { code: 'too_large' });
}

/** Uploads a prepared picture. Resolves with the memory the server made; rejects with { code }. */
export async function uploadMemory({ blob, caption, date }) {
  const { roomId, token, activePhoto } = useSession.getState();
  // Hang it on the curtain I'm standing at: the free spots, nearest first (the server takes the first still free).
  const taken = new Set(useMemories.getState().list.map((m) => m.spot));
  const facing = PHOTOS.some((p) => p.id === activePhoto) ? activePhoto : null;
  const spots = spotsNearest(localMotion.position, taken, facing).slice(0, 64);
  let res;
  try {
    res = await fetch(`${SERVER_URL}/api/rooms/${roomId}/memories`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': blob.type,
        'X-Caption': encodeURIComponent(caption.trim().slice(0, 140)),
        'X-Date': date,
        'X-Spots': spots.join(','),
      },
      body: blob,
    });
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { code: body.error ?? 'failed' });
  return body.memory;
}

/** Takes a photo down; the server frees its spot for both players. */
export function removeMemory(socket, id) {
  socket.emit('gallery:memory-remove', { id });
}

/** Wires the server's memory events into the store. Returns the cleanup. */
export function bindMemorySocket(socket) {
  const { setList, add, remove, setNotice } = useMemories.getState();
  if (import.meta.env.DEV) {
    // Development only: for tests and the console.
    window.__memories = useMemories;
    window.__memoryEvents = [];
  }
  const record = (type, detail) => import.meta.env.DEV && window.__memoryEvents.push({ type, detail, at: Math.round(performance.now()) });
  const onList = (list) => {
    record('list', list.length);
    setList(list);
  };
  const onAdded = (memory) => {
    record('added', memory.spot);
    add(memory);
    const room = ROOM_BY_ID[SPOTS[memory.spot]?.room];
    setNotice(`A new memory was hung in the ${room?.name ?? 'house'}`);
  };
  const onRemoved = ({ id }) => {
    record('removed', id);
    remove(id);
  };
  socket.on('gallery:memories', onList);
  socket.on('gallery:memory', onAdded);
  socket.on('gallery:memory-removed', onRemoved);
  return () => {
    socket.off('gallery:memories', onList);
    socket.off('gallery:memory', onAdded);
    socket.off('gallery:memory-removed', onRemoved);
    useMemories.getState().reset();
  };
}
