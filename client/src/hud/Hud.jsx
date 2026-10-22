import { useEffect, useState } from 'react';
import { useSession } from '../state/session';
import { PHOTOS } from '../gallery/photos';

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

      {/* Stays in the DOM while fading out, so the text doesn't vanish mid-transition */}
      <figure className={`caption${photo ? ' visible' : ''}`}>
        {photo && (
          <>
            <figcaption>{photo.caption}</figcaption>
            <time dateTime={photo.date}>{formatDate(photo.date)}</time>
          </>
        )}
      </figure>
    </div>
  );
}
