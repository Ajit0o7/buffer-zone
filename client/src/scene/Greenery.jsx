import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import { InstancedMesh, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { stoneMaterial } from './stone';
import { LANDING, STAIR_START } from './GrandStair';
import { foliageMaterial, windTime } from './greenery/foliageMaterial';
import { crossGeometry, InstanceList, leafGeometry, mergeParts, seeded } from './greenery/geometry';
import { blossomTexture, figTexture, ivyTexture, lanceTexture, racemeTexture } from './greenery/textures';
import { figTree, flowerStand, ivyCurtain, ivyDrape, oliveTree, stoneUrn, terracottaPot, wisteriaCurtain } from './greenery/plants';

// Where everything grows, in world metres. The numbers come from physics-ray probes of the house:
// the coping of each upper balustrade (its top, and the front edge facing the courtyard), the faces
// of the upper columns, and free floor beside the ground-floor columns and along the aisle walls.

const RAILS = {
  north: { topY: 6.15, lipZ: 1.93, out: -1 }, // out: the way the courtyard lies in z
  south: { topY: 6.15, lipZ: -2.8, out: 1 },
};

// Hanging plants along each balustrade, [kind, x0, x1], with bare stone between some of them.
const CURTAINS = {
  north: [['ivy', -11.4, -9.8], ['wisteria', -9.5, -7.5], ['ivy', -6.9, -4.6], ['wisteria', -4.1, -1.9], ['ivy', -1.5, 0.3], ['wisteria', 0.7, 2.6], ['ivy', 3.0, 5.0], ['ivy', 6.2, 7.6]],
  south: [['wisteria', -11.2, -9.4], ['ivy', -9.0, -6.8], ['wisteria', -6.2, -4.0], ['ivy', -3.6, -1.2], ['wisteria', -0.6, 1.6], ['ivy', 2.0, 4.2], ['wisteria', 4.6, 6.2], ['ivy', 6.6, 8.2]],
};

// Ivy fallen from the tops of a few upper arches down the faces of their piers: [x, face z, out].
const DRAPES = [[-7.4, 2.12, -1], [1.45, 2.12, -1], [-3.0, -2.98, 1], [5.9, -2.98, 1]];

// Potted trees in the aisles, tucked behind ground-floor columns (the aisle stays 3 m wide beside them).
const TREES = [
  { kind: 'olive', pot: 'terracotta', x: -7.0, z: 3.42, height: 2.55 },
  { kind: 'fig', pot: 'urn', x: -3.1, z: 3.42, height: 1.25 },
  { kind: 'olive', pot: 'urn', x: 1.1, z: 3.42, height: 2.4 },
  { kind: 'fig', pot: 'terracotta', x: 5.4, z: 3.42, height: 1.3 },
  { kind: 'fig', pot: 'terracotta', x: -7.0, z: -4.2, height: 1.3 },
  { kind: 'olive', pot: 'terracotta', x: -3.1, z: -4.2, height: 2.5 },
  { kind: 'fig', pot: 'urn', x: 1.1, z: -4.2, height: 1.2 },
  { kind: 'olive', pot: 'urn', x: 5.4, z: -4.2, height: 2.45 },
];

// Flowers on pedestals against the aisle walls, between the paintings (each over 1 m clear of a curtain).
const STANDS = [
  { kind: 'hydrangeas', x: -3.25, z: 6.55 },
  { kind: 'roses', x: 5.9, z: 6.55 },
  { kind: 'roses', x: -2.4, z: -7.4 },
  { kind: 'hydrangeas', x: 1.0, z: -7.4 },
  { kind: 'hydrangeas', x: 11.6, z: -7.4 },
];

const LOWEST = 3.45; // hanging plants stop well above heads in the courtyard
const STAIR_CLEARANCE = 2.4; // ...and this far above the grand stair's treads beside them

/** The lowest a hanging plant may reach at x: never into the headroom of anyone on the grand stair. */
function bottomAt(x) {
  if (x < STAIR_START - 0.3 || x > LANDING.east) return LOWEST;
  const rise = x >= LANDING.west ? LANDING.top : (LANDING.top * (x - STAIR_START)) / (LANDING.west - STAIR_START);
  return Math.max(LOWEST, rise + STAIR_CLEARANCE);
}

function build(stoneMap) {
  const ctx = { ivy: new InstanceList(), lance: new InstanceList(), fig: new InstanceList(), raceme: new InstanceList(), bloom: new InstanceList(), solid: [], stone: [] };
  const rand = seeded(20240921);

  for (const side of ['north', 'south']) {
    for (const [kind, x0, x1] of CURTAINS[side]) {
      if (kind === 'ivy') ivyCurtain(ctx, rand, x0, x1, RAILS[side], bottomAt);
      else wisteriaCurtain(ctx, rand, x0, x1, RAILS[side], bottomAt);
    }
  }
  for (const [x, z, out] of DRAPES) ivyDrape(ctx, rand, x, z, out, 9.55, 7.3);

  const colliders = [];
  for (const t of TREES) {
    const at = new Vector3(t.x, 0, t.z);
    const pot = t.pot === 'urn' ? stoneUrn(ctx, at) : terracottaPot(ctx, at);
    const base = new Vector3(t.x, pot.soil, t.z);
    if (t.kind === 'olive') oliveTree(ctx, rand, base, t.height - pot.height);
    else figTree(ctx, rand, base, t.height);
    colliders.push({ kind: 'cylinder', position: [t.x, pot.height / 2, t.z], args: [pot.height / 2, pot.radius] });
  }
  for (const s of STANDS) {
    const { top, half } = flowerStand(ctx, rand, new Vector3(s.x, 0, s.z), s.kind);
    colliders.push({ kind: 'box', position: [s.x, top / 2, s.z], args: [half, top / 2, half] });
  }

  const textures = [ivyTexture(), lanceTexture(), figTexture(), racemeTexture(), blossomTexture()];
  const [ivyMap, lanceMap, figMap, racemeMap, bloomMap] = textures;
  const instanced = (name, list, geometry, material, cells = false) => {
    const mesh = new InstancedMesh(geometry, material, list.count);
    list.apply(mesh, cells);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  };
  const meshes = [
    instanced('ivy', ctx.ivy, leafGeometry({ fold: 0.15 }), foliageMaterial(ivyMap, { roughness: 0.6 })),
    instanced('lance', ctx.lance, leafGeometry({ fold: 0.2, segX: 2, segY: 1 }), foliageMaterial(lanceMap, { roughness: 0.8 })),
    instanced('fig', ctx.fig, leafGeometry({ fold: 0.1, curl: 0.16, segY: 4 }), foliageMaterial(figMap, { roughness: 0.38, glow: 0.08 })),
    instanced('wisteria', ctx.raceme, crossGeometry(), foliageMaterial(racemeMap, { roughness: 0.8, glow: 0.18 })),
    instanced('blossom', ctx.bloom, leafGeometry({ fold: 0.25, segX: 2, segY: 1 }), foliageMaterial(bloomMap, { roughness: 0.7, cells: 2, glow: 0.15 }), true),
  ];
  const solid = new Mesh(mergeParts(ctx.solid), new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
  solid.name = 'greenery-solid';
  const stone = new Mesh(mergeParts(ctx.stone), stoneMaterial(stoneMap, { roughness: 0.9, metalness: 0 }));
  stone.name = 'greenery-stone';
  for (const m of [solid, stone]) {
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
  }
  meshes.push(solid, stone);
  return { meshes, textures, colliders };
}

/**
 * Plants and flowers for the house, all procedural (no downloads):
 *
 * - Ivy and lilac wisteria spill over both upper balustrades into the courtyard, and ivy falls from a
 *   few upper arches. Strands sway in a gentle breeze in the vertex shader, most at their tips.
 * - Olive trees and fiddle-leaf figs in terracotta pots and stone urns stand in the aisles, behind
 *   the ground-floor columns.
 * - White roses and blue-and-white hydrangeas in vases on slender stone pedestals sit between the
 *   paintings in the aisles.
 *
 * Seven draw calls in all: one instanced mesh per kind of leaf or flower (ivy; narrow leaves; fig;
 * wisteria racemes; blossoms) and two merged meshes (vertex-coloured pots, bark and stems; stone urns
 * and pedestals, which take the house's floor texture when it is passed as `stoneMap`). Pots and
 * pedestals are solid; hanging plants are not. Nothing casts shadows.
 */
export default function Greenery({ stoneMap = null }) {
  const built = useMemo(() => build(stoneMap), [stoneMap]);

  useEffect(
    () => () => {
      for (const m of built.meshes) {
        m.geometry.dispose();
        m.material.dispose();
        if (m.isInstancedMesh) m.dispose();
      }
      for (const t of built.textures) t.dispose();
    },
    [built],
  );

  useFrame((state) => {
    windTime.value = state.clock.elapsedTime;
  });

  return (
    <>
      <RigidBody type="fixed" colliders={false} friction={0.8}>
        {built.colliders.map((c, i) =>
          c.kind === 'cylinder' ? <CylinderCollider key={i} args={c.args} position={c.position} /> : <CuboidCollider key={i} args={c.args} position={c.position} />,
        )}
      </RigidBody>
      {built.meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </>
  );
}
