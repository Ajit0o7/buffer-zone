import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, LinearFilter, MeshBasicMaterial, PlaneGeometry } from 'three';
import { partner } from '../gallery/curtainState';
import { localMotion } from '../world/shared';
import { CAPSULE } from '../world/config';

const SIZE = 1.15; // metres across: a little wider than the shoulders, so it reads as the body's shadow
const LIFT = 0.02; // above the floor, so the floor never cuts through it
const MAX_OPACITY = 0.6;

/** A soft dark disc: opaque in the middle, fading smoothly to nothing at the edge. */
function discTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [stop, alpha] of [[0, 1], [0.25, 0.8], [0.55, 0.38], [0.8, 0.1], [1, 0]]) g.addColorStop(stop, `rgba(0,0,0,${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  return texture;
}

/**
 * Contact shadows: a soft blob on the floor under each avatar's feet, so they sit on the stone instead
 * of floating above it. The sun's shadow (Lighting.jsx) shows where they stand relative to the light;
 * this shows that they touch the ground, which the sun's hard, offset shadow can't. Two quads for the
 * whole scene. (drei's <ContactShadows> re-renders the scene from below: far too costly for the house.)
 */
export default function FootShadows() {
  const meshes = useRef([]);
  const geometry = useMemo(() => new PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2), []);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        map: discTexture(),
        transparent: true,
        opacity: MAX_OPACITY,
        depthWrite: false,
        polygonOffset: true, // wins against the floor and the stair's treads it overlaps
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        toneMapped: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      material.map.dispose();
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );

  useFrame(() => {
    const [local, other] = meshes.current;
    // Capsule centre -> the ground under it.
    local.position.set(localMotion.position.x, localMotion.position.y - CAPSULE.center + LIFT, localMotion.position.z);
    other.visible = partner.known;
    if (partner.known) other.position.set(partner.position.x, partner.position.y - CAPSULE.center + LIFT, partner.position.z);
  });

  return (
    <>
      {[0, 1].map((i) => (
        <mesh key={i} ref={(el) => (meshes.current[i] = el)} geometry={geometry} material={material} renderOrder={1} frustumCulled={false} />
      ))}
    </>
  );
}
