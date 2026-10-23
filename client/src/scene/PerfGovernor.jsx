import { useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { usePerf } from '../state/perf';

const TARGET_FPS = 90;
// Sharp on a high-density screen (a retina laptop is 2): never drop below 1.25, and go up to the screen's own density, 2 at most.
const MIN_DPR = Math.min(1.25, window.devicePixelRatio || 1);
const MAX_DPR = Math.min(2, Math.max(1.5, window.devicePixelRatio || 1));

/**
 * Holds the frame rate at the target by trading resolution first, then post-processing.
 *
 * drei's PerformanceMonitor averages frame times and moves a `factor` between 0 and 1: down when we
 * run below the lower bound, up when we're comfortably above the upper one. The pixel ratio follows
 * the factor continuously; below 0.6 the marble floor stops mirroring the room (medium), and below 0.35 the
 * cheap post tier takes over, which drops bloom and the colour grade. If it keeps flip-flopping, it settles on the safe setting for the session.
 * On a 60 Hz display the target becomes 60, since no display can show more than its refresh rate.
 */
export default function PerfGovernor() {
  const setDpr = useThree((s) => s.setDpr);
  const setTier = usePerf((s) => s.setTier);

  return (
    <PerformanceMonitor
      bounds={(refreshRate) => {
        // At 90 Hz: steps down below 85 fps, back up above 88. Scaled to slower displays.
        const target = Math.min(refreshRate, TARGET_FPS);
        return [target * (85 / 90), target * (88 / 90)];
      }}
      flipflops={4}
      onChange={({ factor }) => {
        setDpr(MIN_DPR + (MAX_DPR - MIN_DPR) * factor);
        // Resolution goes first, then the floor's mirror, and only then bloom and the rest.
        setTier(factor < 0.35 ? 'low' : factor < 0.6 ? 'medium' : 'high');
      }}
      onFallback={() => {
        setDpr(MIN_DPR);
        setTier('low');
      }}
    />
  );
}
