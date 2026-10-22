import { useProgress } from '@react-three/drei';

/** DOM loading overlay driven by three's loading manager. It hides once every asset has arrived. */
export default function Loading() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div className="loading" role="status">
      <div className="loader">Lighting the fireplace… {Math.round(progress)}%</div>
    </div>
  );
}
