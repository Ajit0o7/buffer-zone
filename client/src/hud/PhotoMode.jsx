import { useCallback, useEffect, useState } from 'react';
import { couple, shutter, togglePhotoMode, useCouple } from '../world/couple';
import { useSession } from '../state/session';
import { ROOM_BY_ID } from '../world/rooms';
import { makePolaroid } from '../photo/polaroid';

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/**
 * Photo mode's screen: a square viewfinder, the shutter, and the developed print to download. Everything else on
 * the HUD is hidden (Hud.jsx). Space or Enter is the shutter, C leaves.
 */
export default function PhotoMode() {
  const room = useSession((s) => s.room);
  const [print, setPrint] = useState(null); // { url } of the developed polaroid
  const [flash, setFlash] = useState(false);

  const snap = useCallback(() => {
    shutter.onCapture = (canvas) => {
      const card = makePolaroid(canvas, {
        title: ROOM_BY_ID[room]?.name ?? 'Our house',
        subtitle: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
      });
      card.toBlob((blob) => {
        if (blob) setPrint({ url: URL.createObjectURL(blob) });
      }, 'image/png');
      setFlash(true);
      setTimeout(() => setFlash(false), 220);
    };
    shutter.requested = true;
    if (document.pointerLockElement) document.exitPointerLock(); // the preview needs the mouse
  }, [room]);

  const closePrint = useCallback(() => {
    setPrint((p) => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (!print) snap();
      } else if (e.code === 'KeyC') {
        if (print) closePrint();
        else togglePhotoMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snap, print, closePrint]);

  useEffect(() => () => {
    shutter.onCapture = null;
  }, []);

  // Development only: lets tests read the developed print.
  useEffect(() => {
    if (import.meta.env.DEV) window.__print = print;
  }, [print]);

  return (
    <div className="photo-mode">
      <div className="viewfinder" aria-hidden="true">
        <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
      </div>
      <p className="photo-hint">Move the mouse to circle around · scroll to zoom · 1–6 to pose · Space to take the photo · C to go back</p>
      <div className="photo-buttons">
        <button type="button" className="shutter" onClick={snap} aria-label="Take the photo" />
        <button type="button" className="tool" onClick={togglePhotoMode}>Back to the house <kbd>C</kbd></button>
      </div>
      {flash && <div className="flash" aria-hidden="true" />}
      {print && (
        <div className="print-backdrop" role="dialog" aria-label="Your photo">
          <figure className="print">
            <img src={print.url} alt="Your polaroid" />
            <figcaption>
              <a className="primary" href={print.url} download={`our-house-${stamp()}.png`}>Download</a>
              <button type="button" className="tool" onClick={closePrint}>Take another</button>
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}

export const usePhotoMode = () => useCouple((s) => s.photoMode);
