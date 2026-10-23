import { couple, playRemoteEmote, useCouple } from '../world/couple';
import { useSession } from '../state/session';
import { EMOTES } from '../avatar/emotes';

// The wire side of everything two players do together (docs/COUPLE.md): emotes, and the walk-together handshake.
// The server only relays; each side keeps its own state and reaches the same answer from the same messages.

let io = null; // the socket, set by bindCoupleSocket (this file can't import it: socket.js imports this one)

const emit = (event, payload) => io?.emit(event, payload);

/** Plays an emote on my avatar and tells my partner's copy of it to play too. */
export function sendEmote(id) {
  if (!EMOTES[id]) return;
  couple.emoteId = id;
  couple.emoteToken += 1;
  emit('emote', { id });
}

/**
 * The H key. Off: ask my partner to walk together. Invited: say yes. Asked or on: stop.
 * The host always leads; the guest follows (LocalPlayer.jsx).
 */
export function toggleTogether() {
  const store = useCouple.getState();
  if (!useSession.getState().peerConnected) return;
  switch (store.together) {
    case 'off':
      emit('together', { kind: 'request' });
      store.setTogether('asked');
      break;
    case 'invited':
      emit('together', { kind: 'accept' });
      store.setTogether('on');
      break;
    default:
      emit('together', { kind: 'end' });
      store.setTogether('off');
  }
}

/** Ends walking together from either side (used when someone sits down or leaves). */
export function endTogether({ notify = true } = {}) {
  const store = useCouple.getState();
  if (store.together === 'off') return;
  if (notify) emit('together', { kind: 'end' });
  store.setTogether('off');
}

export function bindCoupleSocket(socket) {
  io = socket;

  const onEmote = ({ id }) => {
    if (EMOTES[id]) playRemoteEmote(id);
  };

  const onTogether = ({ kind }) => {
    const store = useCouple.getState();
    if (kind === 'request') {
      // We asked each other at the same moment: that's a yes.
      if (store.together === 'asked') {
        emit('together', { kind: 'accept' });
        store.setTogether('on');
      } else if (store.together !== 'on') {
        store.setTogether('invited');
      }
    } else if (kind === 'accept') {
      if (store.together === 'asked') store.setTogether('on');
    } else if (kind === 'end') {
      store.setTogether('off');
    }
  };

  // When the partner leaves, nothing shared carries on.
  let wasConnected = useSession.getState().peerConnected;
  const unsubscribe = useSession.subscribe((s) => {
    if (wasConnected && !s.peerConnected) useCouple.getState().setTogether('off');
    wasConnected = s.peerConnected;
  });

  socket.on('emote', onEmote);
  socket.on('together', onTogether);
  return () => {
    socket.off('emote', onEmote);
    socket.off('together', onTogether);
    unsubscribe();
    useCouple.getState().setTogether('off');
    io = null;
  };
}
