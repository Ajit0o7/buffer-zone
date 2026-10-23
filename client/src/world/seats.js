import { FLIGHT, stepTop } from '../scene/GrandStair';
import { LOUNGE_SEATS } from '../scene/Lounge';

// Places to sit, in world metres: the grand stair's steps, and benches around the house. A seat names where the
// avatar's pelvis goes (`point`, on the seat surface), the way it faces (`yaw`), and where it stands up to (`exit`,
// on the floor). Walk up to one and press E.
//
// Seats come in side-by-side pairs, a metre apart, so two people can sit together.

const PAIR_GAP = 0.9;

function pair(idPrefix, label, base, yaw, exitOffset) {
  // Seat positions are spread across the line at right angles to the way they face.
  const sx = Math.cos(yaw); // sideways axis
  const sz = -Math.sin(yaw);
  return [-1, 1].map((side) => {
    const x = base.x + sx * side * (PAIR_GAP / 2);
    const z = base.z + sz * side * (PAIR_GAP / 2);
    return {
      id: `${idPrefix}-${side < 0 ? 'a' : 'b'}`,
      label,
      point: { x, y: base.y, z },
      yaw,
      exit: { x: x + Math.sin(yaw) * exitOffset.forward, y: base.y - exitOffset.down, z: z + Math.cos(yaw) * exitOffset.forward },
    };
  });
}

// On the grand stair, facing down the flight toward the nave (west).
const DOWN_FLIGHT = -Math.PI / 2;
const stairSeats = [6, 14, 24].flatMap((k) => {
  const { x, y } = stepTop(k);
  // Stand up onto the step three lower: far enough that the knees clear the one above.
  return pair(`stair-${k}`, 'on the grand staircase', { x, y, z: 0 }, DOWN_FLIGHT, { forward: 3 * FLIGHT.run, down: 3 * FLIGHT.rise });
});

export const BENCH = { length: 1.9, depth: 0.55, height: 0.46, slab: 0.12 };

// Benches: [x, floor y, z, facing yaw]. One on the courtyard's south edge by the fountain, facing the piano (clear of
// the colonnade, whose hanging banners are solid), and two on the east bridge looking out over the nave.
export const BENCHES = [
  { id: 'nave-south', x: -9.4, y: 0, z: -2.45, yaw: 0 },
  { id: 'bridge-south', x: 13.9, y: 4.99, z: -3.9, yaw: -Math.PI / 2 },
  { id: 'bridge-north', x: 13.9, y: 4.99, z: 3.9, yaw: -Math.PI / 2 },
];
const benchSeats = BENCHES.flatMap((b) =>
  pair(`bench-${b.id}`, 'on the bench', { x: b.x, y: b.y + BENCH.height, z: b.z }, b.yaw, { forward: 0.75, down: BENCH.height }),
);

export const SEATS = [...stairSeats, ...benchSeats, ...LOUNGE_SEATS]; // the lounge's sofa, armchairs and piano bench

const SIT_RADIUS = 1.7; // metres from the seat's point, along the floor
const MAX_HEIGHT_GAP = 1.6; // not from another floor

/** The closest seat within reach of a standing player at `position` (a capsule centre), skipping taken ones. */
export function nearestSeat(position, isTaken) {
  let best = null;
  let bestDistance = SIT_RADIUS;
  for (const seat of SEATS) {
    if (Math.abs(seat.exit.y - (position.y - 0.9)) > MAX_HEIGHT_GAP) continue;
    // Measure to the standing spot in front of the seat, which is where a person walks up to it.
    const d = Math.hypot(seat.exit.x - position.x, seat.exit.z - position.z);
    if (d < bestDistance && !isTaken(seat)) {
      best = seat;
      bestDistance = d;
    }
  }
  return best;
}
