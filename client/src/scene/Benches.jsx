import { useLayoutEffect, useMemo, useRef } from 'react';
import { BoxGeometry, Color, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { BENCH, BENCHES } from '../world/seats';
import { stoneMaterial } from './stone';

const SLAB = new Color('#cbc3b2'); // pale limestone, like the colonnade
const PLINTH = new Color('#b3aa97');
const LEG_WIDTH = 0.22;

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpP = new Vector3();
const tmpS = new Vector3();

/** Every box of every bench: a seat slab on two plinths, in world space. */
function buildParts() {
  const parts = [];
  for (const b of BENCHES) {
    // Local axes: x along the bench, z the way a sitter faces.
    const toWorld = (lx, ly, lz) => ({
      x: b.x + lx * Math.cos(b.yaw) + lz * Math.sin(b.yaw),
      y: b.y + ly,
      z: b.z - lx * Math.sin(b.yaw) + lz * Math.cos(b.yaw),
    });
    const seat = toWorld(0, BENCH.height - BENCH.slab / 2, 0);
    parts.push({ ...seat, sx: BENCH.length, sy: BENCH.slab, sz: BENCH.depth, rotY: b.yaw, color: SLAB });
    const legHeight = BENCH.height - BENCH.slab;
    for (const side of [-1, 1]) {
      const leg = toWorld(side * (BENCH.length / 2 - LEG_WIDTH / 2 - 0.08), legHeight / 2, 0);
      parts.push({ ...leg, sx: LEG_WIDTH, sy: legHeight, sz: BENCH.depth - 0.1, rotY: b.yaw, color: PLINTH });
    }
  }
  return parts;
}

/**
 * The benches to sit on (world/seats.js): stone slabs on plinths, one instanced draw call for all of them, plus
 * one solid block each so nobody walks through. Pass the house's floor texture as `stoneMap` to match the stone.
 */
export default function Benches({ stoneMap = null }) {
  const mesh = useRef();
  const parts = useMemo(buildParts, []);
  const assets = useMemo(() => ({ geometry: new BoxGeometry(1, 1, 1), material: stoneMaterial(stoneMap, { roughness: 0.9, metalness: 0 }) }), [stoneMap]);

  useLayoutEffect(() => {
    const m = mesh.current;
    parts.forEach((p, i) => {
      tmpQ.setFromEuler(tmpE.set(0, p.rotY, 0));
      m.setMatrixAt(i, tmpM.compose(tmpP.set(p.x, p.y, p.z), tmpQ, tmpS.set(p.sx, p.sy, p.sz)));
      m.setColorAt(i, p.color);
    });
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    return () => {
      assets.geometry.dispose();
      assets.material.dispose();
    };
  }, [parts, assets]);

  return (
    <>
      <RigidBody type="fixed" colliders={false} friction={0.8}>
        {BENCHES.map((b) => (
          <CuboidCollider
            key={b.id}
            args={[BENCH.length / 2, BENCH.height / 2, BENCH.depth / 2]}
            position={[b.x, b.y + BENCH.height / 2, b.z]}
            rotation={[0, b.yaw, 0]}
          />
        ))}
      </RigidBody>
      <instancedMesh ref={mesh} args={[assets.geometry, assets.material, parts.length]} receiveShadow castShadow />
    </>
  );
}
