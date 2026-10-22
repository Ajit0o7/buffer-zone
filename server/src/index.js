import http from 'node:http';
import { Server } from 'socket.io';
import { createRoomStore } from './rooms.js';
import { normalizeKey, sanitizeState } from './validate.js';

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map((o) => o.trim());

const FANOUT_HZ = 20; // server -> partner snapshot rate
const MIN_UPDATE_MS = 15; // inbound cap per socket (~66 Hz); excess packets are dropped
const MAX_FAILED_JOINS = 8; // per socket, before further join attempts are refused

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
  res.writeHead(404).end();
});

const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGINS },
  maxHttpBufferSize: 16 * 1024,
  pingInterval: 10_000,
  pingTimeout: 5_000,
});

const store = createRoomStore();
const failedJoins = new Map();
const lastUpdateAt = new Map();

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
  });

  // Anyone: re-attach to a seat after a refresh or network drop, using the token they were given.
  socket.on('room:resume', (payload, ack) => {
    const result = store.resume(socket.id, payload?.roomId, payload?.token);
    if (result.error) return ack?.({ ok: false, error: result.error });

    if (result.peerSocketId) io.to(result.peerSocketId).emit('room:peer', { connected: true });
    ack?.({ ok: true, ...result });
  });

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
  console.log(`[server] listening on :${PORT} (origins: ${CLIENT_ORIGINS.join(', ')})`);
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
