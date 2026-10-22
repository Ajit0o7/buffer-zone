import { useSession } from '../state/session';
import { PHOTOS } from '../gallery/photos';

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

export default function Hud() {
  const role = useSession((s) => s.role);
  const roomKey = useSession((s) => s.key);
  const peerConnected = useSession((s) => s.peerConnected);
  const activePhoto = useSession((s) => s.activePhoto);
  const photo = PHOTOS.find((p) => p.id === activePhoto);

  return (
    <div className="hud" aria-live="polite">
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
