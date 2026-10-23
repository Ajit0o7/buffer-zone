import { lazy, Suspense, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { NoToneMapping } from 'three';
import { useSession } from '../state/session';
import { AVATAR_BY_ROLE, CAMERA, HDRI_URL, partnerRole } from '../world/config';
import Lighting from './Lighting';
import PerfGovernor from './PerfGovernor';
import LocalPlayer from '../avatar/LocalPlayer';
import RemotePlayer from '../avatar/RemotePlayer';
import PhotoFrames from '../gallery/PhotoFrames';
import SpatialAudio from '../audio/SpatialAudio';
import VisibilityBake from '../world/VisibilityBake';
import Loading from './Loading';
import './loaders'; // sets the local Draco decoder path before any model loads

// Development only (stripped from production builds): exposes the renderer for tests and the console.
function DevHooks() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    window.__three = { gl, scene, camera };
  }, [gl, scene, camera]);
  return null;
}

// The house is code-split: the lobby never downloads the 3D engine or the mansion.
const Mansion = lazy(() => import('./Mansion'));

// Canvas hygiene for 90+ fps:
// - dpr capped at 1.5: post-processing and fill cost scale with pixel count (PerfGovernor lowers it further).
// - no MSAA and no stencil buffer: neither is used, and both cost memory bandwidth on every frame.
// - toneMapping off on the renderer: the post chain tone-maps once, at the end.
const GL = {
  antialias: false,
  stencil: false,
  depth: true,
  powerPreference: 'high-performance',
  toneMapping: NoToneMapping,
};

export default function GameScene() {
  const role = useSession((s) => s.role);
  const localAvatar = AVATAR_BY_ROLE[role];
  const remoteAvatar = AVATAR_BY_ROLE[partnerRole(role)];

  return (
    <>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        gl={GL}
        camera={{ fov: CAMERA.fov, near: CAMERA.near, far: CAMERA.far, position: [0, 3, 8] }}
      >
        <color attach="background" args={['#0b0a09']} />
        <PerfGovernor />
        {import.meta.env.DEV && <DevHooks />}
        {/* No fallback here: a DOM overlay (Loading) shows progress, so nothing 3D is drawn while loading */}
        <Suspense fallback={null}>
          <Lighting hdri={HDRI_URL} />
          <Physics gravity={[0, -9.81, 0]}>
            <Mansion />
            <LocalPlayer avatarId={localAvatar} />
            <RemotePlayer avatarId={remoteAvatar} />
            {/* Inside Physics: each frame snaps itself onto the nearest wall with a physics ray. */}
            <PhotoFrames />
            {/* Zone culling: bakes which rooms see each painting and light, with physics rays. */}
            <VisibilityBake />
          </Physics>
          <SpatialAudio />
        </Suspense>
      </Canvas>
      <Loading />
    </>
  );
}
