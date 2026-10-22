import { io } from 'socket.io-client';
import { useSession } from '../state/session';
import { remote } from '../world/shared';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

// autoConnect is off so React decides when the connection opens (see App.jsx).
export const socket = io(SERVER_URL, {
  autoConnect: false,
  transports: ['websocket'],
  reconnectionDelayMax: 4000,
});

/** Wires socket events into the stores. Returns a cleanup function. */
export function bindSocket() {
  const onPeer = ({ connected }) => useSession.getState().setPeerConnected(connected);
  const onWorld = (sample) => remote.pushSnapshot(sample);

  // Runs on every (re)connect: if this tab already holds a seat, reclaim it.
  const onConnect = () => {
    const { roomId, token, setPeerConnected, clear } = useSession.getState();
    if (!roomId || !token) return;
    socket.emit('room:resume', { roomId, token }, (res) => {
      if (res.ok) setPeerConnected(res.peerConnected);
      else clear();
    });
  };

  socket.on('room:peer', onPeer);
  socket.on('world:peer', onWorld);
  socket.on('connect', onConnect);
  return () => {
    socket.off('room:peer', onPeer);
    socket.off('world:peer', onWorld);
    socket.off('connect', onConnect);
  };
}
