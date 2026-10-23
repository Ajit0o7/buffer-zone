import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { shutter } from '../world/couple';

/**
 * Takes the picture. It lives inside the canvas so that it runs right after the frame is drawn (priority 2,
 * after the post-processing composer's render at priority 1): the canvas still holds that frame, so no
 * `preserveDrawingBuffer` is needed and nothing is read back on ordinary frames.
 */
export default function PhotoCapture() {
  const { gl } = useThree();

  useFrame(() => {
    if (!shutter.requested) return;
    shutter.requested = false;
    const source = gl.domElement;
    // Copy now, while the frame is still there: the preview is made from this copy.
    const copy = document.createElement('canvas');
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext('2d').drawImage(source, 0, 0);
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
