import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../state/session';
import { CATEGORIES, PHOTOS } from '../gallery/photos';
import { memoryAsPhoto } from '../gallery/memorySlots';
import { useMemories } from '../state/memories';
import MemoryModal from './MemoryModal';
import Toolbar from './Toolbar';
import CoupleControls from './CoupleControls';
import PhotoMode from './PhotoMode';
import GamesHud from './GamesHud';
import { useCouple } from '../world/couple';
import { useGames } from '../state/games';
import { ROOM_BY_ID } from '../world/rooms';
import { inviteLink } from '../lobby/invite';

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/** The host's invitation: the key to read out, and a link that joins in one click. */
function KeyCard({ roomKey }) {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(roomKey);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (plain http, or no permission): the link is selectable in the box below.
    }
  };
  return (
    <div className="key-card">
      Share this key with your partner
      <strong>{roomKey}</strong>
      <div className="invite">
        <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
        <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy invite link'}</button>
      </div>
    </div>
  );
}

export default function Hud() {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const onChange = () => setLocked(document.pointerLockElement !== null);
    document.addEventListener('pointerlockchange', onChange);
    return () => document.removeEventListener('pointerlockchange', onChange);
  }, []);

  const photoMode = useCouple((s) => s.photoMode);
  const quizOn = useGames((s) => s.game?.kind === 'quiz' || s.game?.kind === 'tod'); // their panels take the middle of the screen
  const role = useSession((s) => s.role);
  const roomKey = useSession((s) => s.key);
  const peerConnected = useSession((s) => s.peerConnected);
  const activePhoto = useSession((s) => s.activePhoto);
  const memories = useMemories((s) => s.list);
  const photo =
    PHOTOS.find((p) => p.id === activePhoto) ??
    memories.map((m) => memoryAsPhoto(m, '')).find((p) => p.id === activePhoto);

  // The Add memory form, and a toast when a new photo is hung (by either of you).
  const [adding, setAdding] = useState(false);
  const openForm = useCallback(() => setAdding(true), []);
  const notice = useMemories((s) => s.notice);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => useMemories.getState().setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // The room's name fades in for a few seconds whenever the player walks into a different room.
  const room = useSession((s) => s.room);
  const [showRoom, setShowRoom] = useState(false);
  useEffect(() => {
    if (!room) return undefined;
    setShowRoom(true);
    const timer = setTimeout(() => setShowRoom(false), 3500);
    return () => clearTimeout(timer);
  }, [room]);

  // Photo mode hides everything but its own viewfinder.
  if (photoMode) {
    return (
      <div className="hud photo" aria-live="polite">
        <PhotoMode />
      </div>
    );
  }

  return (
    <div className="hud" aria-live="polite">
      {locked && <div className="crosshair" aria-hidden="true" />}

      {!locked && (
        <div className="hint">Click to look around · WASD walk · Shift run · E sit · Click a curtain to open it · Esc frees the mouse</div>
      )}

      {role === 'host' && roomKey && !peerConnected && <KeyCard roomKey={roomKey} />}

      <Toolbar onAddMemory={openForm} />
      <CoupleControls disabled={adding} />
      <GamesHud />
      {notice && <p className="toast" role="status">{notice.text}</p>}
      {adding && <MemoryModal onClose={() => setAdding(false)} />}

      <p className={`room-name${showRoom ? ' visible' : ''}`}>{ROOM_BY_ID[room]?.name}</p>

      {/* Stays in the DOM while fading out, so the text doesn't vanish mid-transition */}
      <figure className={`caption${photo && !quizOn ? ' visible' : ''}`}>
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
