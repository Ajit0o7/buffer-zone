import http from 'node:http';
import { Server } from 'socket.io';
import { createRoomStore } from './rooms.js';
import { createMemoryRoutes } from './memories.js';
import { createOriginCheck, parseOrigins } from './origins.js';
import { GAME_KINDS, HUNT, QUIZ, TOD, huntCollect, promptCategory, promptNext, promptPick, quizAnswer, quizNext, startGame, todAdd, todDone, todPick, todReroll, todWild, viewFor } from './games.js';
import { normalizeKey, sanitizeCurtain, sanitizeCardText, sanitizeEmote, sanitizeGameStart, sanitizeIndex, sanitizeState, sanitizeTogether, sanitizeVoiceSignal } from './validate.js';

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGINS = parseOrigins(process.env.CLIENT_ORIGIN); // null: development default (see origins.js)
const originAllowed = createOriginCheck(CLIENT_ORIGINS);

const FANOUT_HZ = 20; // server -> partner snapshot rate
const MIN_UPDATE_MS = 15; // inbound cap per socket (~66 Hz); excess packets are dropped
const MAX_FAILED_JOINS = 8; // per socket, before further join attempts are refused
// Curtain clicks are human-paced: a token bucket allows short bursts (opening several at once)
// but caps the sustained rate at 10 per second per socket.
const CURTAIN_BURST = 20;
const CURTAIN_REFILL_PER_MS = 10 / 1000;

// Voice signalling is a few messages per call: offer, answer, a dozen ICE candidates. Generous bursts, tight sustained rate.
const VOICE_BURST = 40;
const VOICE_REFILL_PER_MS = 20 / 1000;

const store = createRoomStore();

const memoryRoutes = createMemoryRoutes({
  store,
  originAllowed,
  announce: (sockets, memory) => {
    for (const id of sockets) io.to(id).emit('gallery:memory', memory);
  },
});

const httpServer = http.createServer(async (req, res) => {
  if (req.url === '/health') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
  if (await memoryRoutes(req, res)) return undefined;
  res.writeHead(404).end();
  return undefined;
});

const io = new Server(httpServer, {
  cors: { origin: (origin, callback) => callback(null, !origin || originAllowed(origin)) },
  // CORS only binds browsers' polling requests, and WebSockets ignore it, so check the page's origin here too: other
  // websites' pages can't open a connection to this server. (Tools that send no Origin header, like tests, pass.)
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    callback(null, !origin || originAllowed(origin));
  },
  maxHttpBufferSize: 16 * 1024,
  // Heartbeat. A very slow machine (software rendering) can stall a tab for seconds; raise PING_TIMEOUT_MS if players drop out.
  pingInterval: 10_000,
  pingTimeout: Number(process.env.PING_TIMEOUT_MS) || 5_000,
});

const failedJoins = new Map();
const lastUpdateAt = new Map();
const curtainBuckets = new Map(); // socket.id -> { tokens, at }
const voiceBuckets = new Map();
const coupleBuckets = new Map(); // emotes and walk-together messages share a small budget per socket
const gameBuckets = new Map(); // game moves: human-paced, a few a second

function takeToken(buckets, burst, refillPerMs, socketId, now) {
  const bucket = buckets.get(socketId) ?? { tokens: burst, at: now };
  bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.at) * refillPerMs);
  bucket.at = now;
  buckets.set(socketId, bucket);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
const takeCurtainToken = (socketId, now) => takeToken(curtainBuckets, CURTAIN_BURST, CURTAIN_REFILL_PER_MS, socketId, now);
const takeVoiceToken = (socketId, now) => takeToken(voiceBuckets, VOICE_BURST, VOICE_REFILL_PER_MS, socketId, now);
// A person can trigger an emote about twice a second, in short bursts: more is spam.
const takeCoupleToken = (socketId, now) => takeToken(coupleBuckets, 6, 2 / 1000, socketId, now);

/** A player who joins or resumes gets the room's held-open and held-closed curtains, and its added photos. */
const sendGalleryState = (socket) => {
  socket.emit('gallery:state', store.curtainSnapshot(socket.id));
  socket.emit('gallery:memories', store.memoryList(socket.id));
  const ctx = store.gameContext(socket.id);
  socket.emit('game:state', ctx ? viewFor(ctx.room.game, ctx.role) : null);
};

/** Sends each connected player their own view of the room's game (the quiz hides the partner's pick). */
const broadcastGame = (ctx) => {
  for (const { role, socketId } of ctx.players) io.to(socketId).emit('game:state', viewFor(ctx.room.game, role));
};

io.on('connection', (socket) => {
  // Host: create a room and receive the secret key (shown once, only to the host).
  socket.on('room:create', (ack) => {
    ack?.({ ok: true, ...store.create(socket.id) });
  });

  // Guest: redeem the key. Wrong keys are counted so the key can't be brute-forced.
  socket.on('room:join', (payload, ack) => {
    const failures = failedJoins.get(socket.id) ?? 0;
    if (failures >= MAX_FAILED_JOINS) return ack?.({ ok: false, error: 'too_many_attempts' });

    const key = normalizeKey(payload?.key);
    if (!key) return ack?.({ ok: false, error: 'invalid_key' });

    const result = store.join(socket.id, key);
    if (result.error) {
      if (result.error === 'invalid_key') failedJoins.set(socket.id, failures + 1);
      return ack?.({ ok: false, error: result.error });
    }

    if (result.peerSocketId) io.to(result.peerSocketId).emit('room:peer', { connected: true });
    ack?.({ ok: true, ...result });
    sendGalleryState(socket);
  });

  // Anyone: re-attach to a seat after a refresh or network drop, using the token they were given.
  socket.on('room:resume', (payload, ack) => {
    const result = store.resume(socket.id, payload?.roomId, payload?.token);
    if (result.error) return ack?.({ ok: false, error: result.error });

    if (result.peerSocketId) io.to(result.peerSocketId).emit('room:peer', { connected: true });
    ack?.({ ok: true, ...result });
    sendGalleryState(socket);
  });

  // A curtain was clicked open or closed: remember it for the room and mirror it to the partner.
  socket.on('gallery:curtain', (payload) => {
    if (!takeCurtainToken(socket.id, Date.now())) return;

    const event = sanitizeCurtain(payload);
    if (!event) return;
    const peerSocketId = store.setCurtain(socket.id, event.id, event.open);
    if (peerSocketId) io.to(peerSocketId).emit('gallery:curtain', event);
  });

  // A photo was taken down: free its wall spot for both players. (Adding goes through HTTP: see memories.js.)
  socket.on('gallery:memory-remove', (payload) => {
    const id = payload?.id;
    if (typeof id !== 'string' || id.length > 64) return;
    const peerSocketId = store.removeMemory(socket.id, id);
    if (peerSocketId === undefined) return;
    socket.emit('gallery:memory-removed', { id });
    if (peerSocketId) io.to(peerSocketId).emit('gallery:memory-removed', { id });
  });

  // Voice chat: pass WebRTC setup messages to the partner. The audio itself never touches the server.
  socket.on('voice:signal', (payload) => {
    if (!takeVoiceToken(socket.id, Date.now())) return;
    const signal = sanitizeVoiceSignal(payload);
    if (!signal) return;
    const peerSocketId = store.peerSocketId(socket.id);
    if (peerSocketId) io.to(peerSocketId).emit('voice:signal', signal);
  });

  // An emote (wave, kiss, ...): the partner's copy of this player's avatar plays it too.
  socket.on('emote', (payload) => {
    if (!takeCoupleToken(socket.id, Date.now())) return;
    const emote = sanitizeEmote(payload);
    const peerSocketId = emote && store.peerSocketId(socket.id);
    if (peerSocketId) io.to(peerSocketId).emit('emote', emote);
  });

  // Walk together: request (from either player), accept, end. The partner's client decides what to do with it.
  socket.on('together', (payload) => {
    if (!takeCoupleToken(socket.id, Date.now())) return;
    const message = sanitizeTogether(payload);
    const peerSocketId = message && store.peerSocketId(socket.id);
    if (peerSocketId) io.to(peerSocketId).emit('together', message);
  });

  // Games (games.js): start one, play it, end it. The server keeps the state and tells both players.
  const gameMove = (handler) => (payload) => {
    if (!takeToken(gameBuckets, 10, 4 / 1000, socket.id, Date.now())) return;
    const ctx = store.gameContext(socket.id);
    if (ctx && handler(ctx, payload)) broadcastGame(ctx);
  };
  socket.on('game:start', gameMove((ctx, payload) => {
    const start = sanitizeGameStart(payload, GAME_KINDS);
    if (!start) return false;
    ctx.room.game = startGame(start.kind);
    return true;
  }));
  socket.on('game:end', gameMove((ctx) => {
    if (!ctx.room.game) return false;
    ctx.room.game = null;
    return true;
  }));
  socket.on('game:hunt-collect', gameMove((ctx, payload) => {
    const spot = sanitizeIndex(payload?.spot, HUNT.spots);
    return spot !== null && huntCollect(ctx.room.game, ctx.role, spot);
  }));
  socket.on('game:quiz-answer', gameMove((ctx, payload) => {
    const choice = sanitizeIndex(payload?.choice, QUIZ.choices);
    return choice !== null && quizAnswer(ctx.room.game, ctx.role, choice);
  }));
  socket.on('game:quiz-next', gameMove((ctx) => quizNext(ctx.room.game)));
  socket.on('game:prompt-pick', gameMove((ctx, payload) => {
    const choice = sanitizeIndex(payload?.choice, 2);
    return choice !== null && promptPick(ctx.room.game, ctx.role, choice);
  }));
  socket.on('game:prompt-next', gameMove((ctx) => promptNext(ctx.room.game)));
  socket.on('game:prompt-category', gameMove((ctx, payload) => promptCategory(ctx.room.game, payload?.category)));
  socket.on('game:tod-pick', gameMove((ctx, payload) => todPick(ctx.room.game, ctx.role, payload?.type)));
  socket.on('game:tod-reroll', gameMove((ctx) => todReroll(ctx.room.game, ctx.role)));
  socket.on('game:tod-done', gameMove((ctx) => todDone(ctx.room.game)));
  socket.on('game:tod-wild', gameMove((ctx, payload) => {
    const text = sanitizeCardText(payload?.text);
    return text !== null && todWild(ctx.room.game, ctx.role, text);
  }));
  socket.on('game:tod-add', gameMove((ctx, payload) => {
    const text = sanitizeCardText(payload?.text);
    return text !== null && TOD.types.has(payload?.type) && todAdd(ctx.room.game, ctx.role, payload.type, text);
  }));

  // High-frequency path: fire-and-forget, no ack, volatile so stale packets are never queued.
  socket.on('player:update', (payload) => {
    const now = Date.now();
    if (now - (lastUpdateAt.get(socket.id) ?? 0) < MIN_UPDATE_MS) return;
    lastUpdateAt.set(socket.id, now);

    const sample = sanitizeState(payload, now);
    if (sample) store.updateState(socket.id, sample);
  });

  socket.on('disconnect', () => {
    failedJoins.delete(socket.id);
    lastUpdateAt.delete(socket.id);
    curtainBuckets.delete(socket.id);
    voiceBuckets.delete(socket.id);
    coupleBuckets.delete(socket.id);
    gameBuckets.delete(socket.id);
    const detached = store.detach(socket.id);
    if (detached?.peerSocketId) io.to(detached.peerSocketId).emit('room:peer', { connected: false });
  });
});

// Fan-out loop: each seat's latest state goes to its partner at a fixed rate, and only when it changed.
const fanout = setInterval(() => {
  store.flushDirty((peerSocketId, state) => {
    io.to(peerSocketId).volatile.emit('world:peer', state);
  });
}, 1000 / FANOUT_HZ);

httpServer.listen(PORT, () => {
  console.log(`[server] listening on :${PORT} (origins: ${CLIENT_ORIGINS ? CLIENT_ORIGINS.join(', ') : 'localhost and private network addresses'})`);
});

// Stop cleanly on deploy: close sockets so clients reconnect and resume their seats.
function shutdown(signal) {
  console.log(`[server] ${signal} received, closing`);
  clearInterval(fanout);
  io.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
