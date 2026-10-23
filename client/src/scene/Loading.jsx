import { useEffect } from 'react';
import { useProgress } from '@react-three/drei';
import { useLoading } from '../state/loading';

/**
 * DOM loading overlay for the house's first load only, showing three's loading progress. It goes for good once the
 * scene has appeared (SceneReady below): photos and anything else that loads later stream in behind the scene while
 * you play, and never bring it back.
 */
export default function Loading() {
  const { active, progress } = useProgress();
  const sceneReady = useLoading((s) => s.sceneReady);
  if (sceneReady || !active) return null;
  return (
    <div className="loading" role="status">
      <div className="loader">Lighting the fireplace… {Math.round(progress)}%</div>
    </div>
  );
}

/** Mounted last inside the scene's Suspense boundary: its effect runs once everything above it has loaded. */
export function SceneReady() {
  const setSceneReady = useLoading((s) => s.setSceneReady);
  useEffect(() => {
    setSceneReady();
  }, [setSceneReady]);
  return null;
}
