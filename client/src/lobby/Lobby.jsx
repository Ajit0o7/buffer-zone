import { useEffect, useState } from 'react';
import { AudioContext } from 'three';
import { socket } from '../net/socket';
import { useSession } from '../state/session';

const ERROR_TEXT = {
  invalid_key: 'That key does not match a room.',
  room_full: 'This room already has two people in it.',
  too_many_attempts: 'Too many wrong keys. Refresh and try again.',
};

export default function Lobby() {
  const setSession = useSession((s) => s.setSession);
  const setPeerConnected = useSession((s) => s.setPeerConnected);
  const [joinKey, setJoinKey] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Tell the guest when the server is unreachable, instead of letting Join hang silently.
  useEffect(() => {
    const onError = () => setError('Cannot reach the house right now. Check your connection and try again.');
    const onConnect = () => setError((msg) => (msg?.startsWith('Cannot reach') ? null : msg));
    socket.on('connect_error', onError);
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect_error', onError);
      socket.off('connect', onConnect);
    };
  }, []);

  // Browsers only allow audio after a user gesture; the click that enters the house counts.
  const unlockAudio = () => AudioContext.getContext().resume();

  const createRoom = () => {
    setBusy(true);
    setError(null);
    unlockAudio();
    socket.emit('room:create', (res) => {
      setBusy(false);
      if (!res.ok) return setError('Could not create a room. Try again.');
      setSession({ roomId: res.roomId, role: 'host', token: res.token, key: res.key });
    });
  };

  const joinRoom = (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    unlockAudio();
    socket.emit('room:join', { key: joinKey }, (res) => {
      setBusy(false);
      if (!res.ok) return setError(ERROR_TEXT[res.error] ?? 'Something went wrong.');
      setSession({ roomId: res.roomId, role: 'guest', token: res.token });
      setPeerConnected(res.peerConnected);
    });
  };

  return (
    <main className="lobby">
      <h1>Our little house</h1>
      <p className="lede">A private place for two.</p>

      <section className="card">
        <h2>Host</h2>
        <p>Create a room and share the key with your partner.</p>
        <button onClick={createRoom} disabled={busy}>Create room</button>
      </section>

      <section className="card">
        <h2>Guest</h2>
        <form onSubmit={joinRoom}>
          <label htmlFor="room-key">Enter the key</label>
          <input
            id="room-key"
            value={joinKey}
            onChange={(e) => setJoinKey(e.target.value.toUpperCase())}
            inputMode="text"
            maxLength={16}
            autoComplete="off"
            spellCheck={false}
            placeholder="XXXX-XXXX"
          />
          <button type="submit" disabled={busy || joinKey.replace(/[^A-Z0-9]/g, '').length < 4}>Join</button>
        </form>
      </section>

      {error && <p role="alert" className="error">{error}</p>}
    </main>
  );
}
