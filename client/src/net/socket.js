import { io } from 'socket.io-client';
import { useSession } from '../state/session';
import { remote } from '../world/shared';
import { applyCurtainSnapshot, setCurtainEmitter, setCurtainOverride } from '../gallery/curtainState';
import { bindMemorySocket } from '../gallery/memoryNet';

import { SERVER_URL } from './serverUrl';

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
  // Curtain reveals: a click is mirrored to the partner, and a (re)joining player gets the room's state.
  const onCurtain = ({ id, open }) => setCurtainOverride(id, open, { broadcast: false });
  const onGalleryState = (snapshot) => applyCurtainSnapshot(snapshot);
  setCurtainEmitter((id, open) => socket.emit('gallery:curtain', { id, open }));

  // Runs on every (re)connect: if this tab already holds a seat, reclaim it.
  const onConnect = () => {
    const { roomId, token, setPeerConnected, clear } = useSession.getState();
    if (!roomId || !token) return;
    socket.emit('room:resume', { roomId, token }, (res) => {
      if (res.ok) setPeerConnected(res.peerConnected);
      else clear();
    });
  };

  const unbindMemories = bindMemorySocket(socket);

  socket.on('room:peer', onPeer);
  socket.on('world:peer', onWorld);
  socket.on('connect', onConnect);
  socket.on('gallery:curtain', onCurtain);
  socket.on('gallery:state', onGalleryState);
  return () => {
    unbindMemories();
    setCurtainEmitter(null);
    socket.off('gallery:curtain', onCurtain);
    socket.off('gallery:state', onGalleryState);
    socket.off('room:peer', onPeer);
    socket.off('world:peer', onWorld);
    socket.off('connect', onConnect);
  };
}
