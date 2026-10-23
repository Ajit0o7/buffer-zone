import { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';

/**
 * DOM loading overlay driven by three's loading manager, for the house's first load only. Once everything has
 * arrived it never comes back: photos and anything else that streams in later load behind the scene, while you
 * play (a photo behind its curtain simply appears when ready).
 */
export default function Loading() {
  const { active, progress } = useProgress();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!active && progress >= 100) setLoaded(true);
  }, [active, progress]);
  if (loaded || !active) return null;
  return (
    <div className="loading" role="status">
      <div className="loader">Lighting the fireplace… {Math.round(progress)}%</div>
    </div>
  );
}
