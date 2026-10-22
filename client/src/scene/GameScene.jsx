import { lazy, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { NoToneMapping } from 'three';
import { useSession } from '../state/session';
import { AVATAR_BY_ROLE, AVATAR_URLS, partnerRole } from '../world/config';
import Lighting from './Lighting';
import LocalPlayer from '../avatar/LocalPlayer';
import RemotePlayer from '../avatar/RemotePlayer';
import PhotoFrames from '../gallery/PhotoFrames';
import SpatialAudio from '../audio/SpatialAudio';
import Loading from './Loading';

// The house is code-split: the lobby never downloads the 3D engine or the mansion.
const Mansion = lazy(() => import('./Mansion'));

export default function GameScene() {
  const role = useSession((s) => s.role);
  const localUrl = AVATAR_URLS[AVATAR_BY_ROLE[role]];
  const remoteUrl = AVATAR_URLS[AVATAR_BY_ROLE[partnerRole(role)]];
  // Weak devices (few logical cores) get the cheaper post stack. Tune this threshold on real hardware.
  const quality = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4 ? 'low' : 'high';

  return (
    <>
      <Canvas
        shadows
        dpr={[1, 1.75]} // cap pixel ratio: post-processing cost scales with it
        camera={{ fov: 55, near: 0.05, far: 200, position: [0, 2.5, 6] }}
        gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: NoToneMapping }}
      >
        <color attach="background" args={['#0b0a09']} />
        {/* No fallback here: a DOM overlay (Loading) shows progress, so nothing 3D is drawn while loading */}
        <Suspense fallback={null}>
          <Lighting quality={quality} />
          <Physics gravity={[0, -9.81, 0]}>
            <Mansion />
            <LocalPlayer url={localUrl} />
            <RemotePlayer url={remoteUrl} />
          </Physics>
          <PhotoFrames />
          <SpatialAudio />
        </Suspense>
      </Canvas>
      <Loading />
    </>
  );
}
