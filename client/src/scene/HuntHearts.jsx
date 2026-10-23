import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Euler, ExtrudeGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Shape, Vector3 } from 'three';
import { useGames } from '../state/games';
import { useSession } from '../state/session';
import { HUNT_SPOTS, COLLECT_RADIUS } from '../games/hunt';
import { collectHeart } from '../net/gameNet';
import { localMotion } from '../world/shared';
import { partner } from '../gallery/curtainState';
import { burstHearts } from '../world/reactions';
import { playChime, playFanfare } from '../audio/chime';
import { CAPSULE } from '../world/config';

// The Heart Hunt's hearts: golden-pink, glowing, turning slowly and bobbing at chest height wherever the server hid
// them. Walk into one and it's yours (the server decides, so two of you reaching it at once can't both score it):
// it pops in a shower of little hearts with a chime, for both of you. One instanced draw call.

const MAX = 16;
const POP_SECONDS = 0.45;
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

function heartGeometry() {
  const s = new Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(-0.1, -0.4, -0.5, -0.15, -0.5, 0.15);
  s.bezierCurveTo(-0.5, 0.42, -0.25, 0.52, 0, 0.3);
  s.bezierCurveTo(0.25, 0.52, 0.5, 0.42, 0.5, 0.15);
  s.bezierCurveTo(0.5, -0.15, 0.1, -0.4, 0, -0.5);
  const g = new ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 4, curveSegments: 16 });
  g.center();
  return g.scale(0.34, 0.34, 0.34);
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpP = new Vector3();
const tmpS = new Vector3();

export default function HuntHearts() {
  const game = useGames((s) => (s.game?.kind === 'hunt' ? s.game : null));
  const role = useSession((s) => s.role);
  const { camera } = useThree();
  const state = useRef({ pending: new Set(), pops: new Map(), found: {}, finished: false, primed: false }).current;

  const mesh = useMemo(() => {
    const material = new MeshStandardMaterial({ color: '#ffd27a', metalness: 0.65, roughness: 0.22, emissive: '#ff4f7b', emissiveIntensity: 1.5 });
    const m = new InstancedMesh(heartGeometry(), material, MAX);
    for (let i = 0; i < MAX; i++) m.setMatrixAt(i, HIDDEN);
    m.frustumCulled = false;
    return m;
  }, []);

  useEffect(() => () => {
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh.dispose();
  }, [mesh]);

  // React to the server's view: pops and chimes for hearts newly found, a fanfare for the last.
  useEffect(() => {
    const context = camera.children.find((c) => c.type === 'AudioListener')?.context;
    const found = game?.found ?? {};
    if (!state.primed) {
      // The first view after joining or resuming: whatever is already found just isn't there.
      state.primed = true;
    } else {
      let n = Object.keys(state.found).length;
      for (const [spot, who] of Object.entries(found)) {
        if (state.found[spot]) continue;
        n += 1;
        const h = HUNT_SPOTS[spot];
        state.pops.set(Number(spot), performance.now());
        burstHearts(h.x, h.y, h.z, who === role ? 8 : 5);
        playChime(context, { pitch: 1 + n * 0.06, volume: who === role ? 0.24 : 0.14 });
      }
      if (game?.finished && !state.finished) {
        playFanfare(context);
        for (let k = 0; k < 4; k++) {
          setTimeout(() => {
            burstHearts(localMotion.position.x, localMotion.position.y + 1.1, localMotion.position.z, 10);
            if (partner.known) burstHearts(partner.position.x, partner.position.y + 1.1, partner.position.z, 10);
          }, k * 350);
        }
      }
    }
    state.found = { ...found };
    state.finished = !!game?.finished;
    state.pending.clear();
    if (!game) state.primed = false;
  }, [game, role, camera, state]);

  useFrame((frame) => {
    const t = frame.clock.elapsedTime;
    const spots = game?.spots ?? [];
    const me = localMotion.position;
    for (let i = 0; i < MAX; i++) {
      const spot = spots[i];
      if (spot === undefined) {
        mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      const h = HUNT_SPOTS[spot];
      const popAt = state.pops.get(spot);
      if (state.found[spot] && popAt === undefined) {
        mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      let scale = 1;
      if (popAt !== undefined) {
        const k = (performance.now() - popAt) / 1000 / POP_SECONDS;
        if (k >= 1) {
          state.pops.delete(spot);
          mesh.setMatrixAt(i, HIDDEN);
          continue;
        }
        scale = 1 + k * 0.8; // swells as it goes...
        scale *= 1 - k * k; // ...and shrinks away
      } else if (!state.pending.has(spot) && !game.finished) {
        // Walked into it? (Along the floor, and on the same floor.)
        const near = Math.hypot(me.x - h.x, me.z - h.z) < COLLECT_RADIUS && Math.abs(me.y - CAPSULE.center - h.floor) < 1.2;
        if (near) {
          state.pending.add(spot);
          collectHeart(spot);
        }
      }
      tmpQ.setFromEuler(tmpE.set(0, t * 1.4 + spot, 0));
      mesh.setMatrixAt(i, tmpM.compose(tmpP.set(h.x, h.y + Math.sin(t * 2 + spot) * 0.08, h.z), tmpQ, tmpS.setScalar(scale)));
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
