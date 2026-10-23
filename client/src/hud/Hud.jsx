import { useEffect, useState } from 'react';
import { useSession } from '../state/session';
import { CATEGORIES, PHOTOS } from '../gallery/photos';
import { ROOM_BY_ID } from '../world/rooms';

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

export default function Hud() {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const onChange = () => setLocked(document.pointerLockElement !== null);
    document.addEventListener('pointerlockchange', onChange);
    return () => document.removeEventListener('pointerlockchange', onChange);
  }, []);

  const role = useSession((s) => s.role);
  const roomKey = useSession((s) => s.key);
  const peerConnected = useSession((s) => s.peerConnected);
  const activePhoto = useSession((s) => s.activePhoto);
  const photo = PHOTOS.find((p) => p.id === activePhoto);

  // The room's name fades in for a few seconds whenever the player walks into a different room.
  const room = useSession((s) => s.room);
  const [showRoom, setShowRoom] = useState(false);
  useEffect(() => {
    if (!room) return undefined;
    setShowRoom(true);
    const timer = setTimeout(() => setShowRoom(false), 3500);
    return () => clearTimeout(timer);
  }, [room]);

  return (
    <div className="hud" aria-live="polite">
      {locked && <div className="crosshair" aria-hidden="true" />}

      {!locked && (
        <div className="hint">Click to look around · WASD to walk · Shift to run · Click a curtain to open it · Esc to free the mouse</div>
      )}

      {role === 'host' && roomKey && !peerConnected && (
        <div className="key-card">
          Share this key with your partner
          <strong>{roomKey}</strong>
        </div>
      )}

      <p className={`room-name${showRoom ? ' visible' : ''}`}>{ROOM_BY_ID[room]?.name}</p>

      {/* Stays in the DOM while fading out, so the text doesn't vanish mid-transition */}
      <figure className={`caption${photo ? ' visible' : ''}`}>
        {photo && (
          <>
            <span className="category">{CATEGORIES[photo.category]} · {ROOM_BY_ID[photo.room]?.name}</span>
            <figcaption>{photo.caption}</figcaption>
            <time dateTime={photo.date}>{formatDate(photo.date)}</time>
          </>
        )}
      </figure>
    </div>
  );
}
