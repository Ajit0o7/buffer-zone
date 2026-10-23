import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { shutter, useCouple } from '../world/couple';

/**
 * Takes the picture. It lives inside the canvas so that it runs right after the frame is drawn (priority 2,
 * after the post-processing composer's render at priority 1): the canvas still holds that frame, so no
 * `preserveDrawingBuffer` is needed and nothing is read back on ordinary frames.
 */
const PRINT_DPR = 2.5; // the picture is taken at this pixel density, whatever the game was running at
const SETTLE_FRAMES = 3; // frames to let the render targets resize and the depth of field settle at the new size

export default function PhotoCapture() {
  const { gl } = useThree();
  const setDpr = useThree((s) => s.setDpr);
  const currentDpr = useThree((s) => s.viewport.dpr);
  const taking = useRef(null); // { restore, frames } while a picture is being taken

  // Photo mode itself looks at the screen's full density, so the viewfinder is as sharp as the print will be.
  const photoMode = useCouple((s) => s.photoMode);
  const before = useRef(null);
  useEffect(() => {
    if (photoMode) {
      before.current = currentDpr;
      setDpr(Math.max(currentDpr, Math.min(2, window.devicePixelRatio || 1)));
    } else if (before.current) {
      setDpr(before.current);
      before.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoMode]);

  useFrame(() => {
    if (shutter.requested && !taking.current) {
      shutter.requested = false;
      taking.current = { restore: before.current ?? currentDpr, frames: 0 };
      setDpr(PRINT_DPR);
      return;
    }
    const job = taking.current;
    if (!job) return;
    if (++job.frames < SETTLE_FRAMES) return;
    taking.current = null;
    const source = gl.domElement;
    // Copy now, while the frame is still there: the preview is made from this copy.
    const copy = document.createElement('canvas');
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext('2d').drawImage(source, 0, 0);
    setDpr(Math.max(job.restore, Math.min(2, window.devicePixelRatio || 1)));
    shutter.onCapture?.(copy);
  }, 2);

  // Development only: lets tests take a picture without the UI.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__shutter = () => {
      shutter.requested = true;
    };
    return () => delete window.__shutter;
  }, []);

  return null;
}
