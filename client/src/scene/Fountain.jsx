import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AudioContext, PositionalAudio } from 'three';
import { CylinderCollider, RigidBody } from '@react-three/rapier';
import { usePerf } from '../state/perf';
import { createFountainBuffer } from '../audio/fountainSound';
import { fallsGeometry, marbleGeometry, waterGeometry } from './fountain/geometry';
import { fallsMaterial, marbleMaterial, waterMaterial } from './fountain/materials';
import { createSplash } from './fountain/splash';

/** Where the fountain stands (the courtyard's centre) and the outer radius of its basin, in metres. */
export const FOUNTAIN = { x: -5.5, z: -0.45, radius: 1.45 };

const COLLIDER_HALF_HEIGHT = 0.275; // as tall as the rim (0.49 m) and then some: too tall to step onto
const SOUND = { height: 0.8, volume: 0.35, refDistance: 2, rolloff: 1.4, seconds: 8 };

/**
 * A low classical fountain in white marble for the courtyard: a round basin with a moulded rim to lean
 * on, and a baluster pedestal carrying two bowls that spill into each other and into the basin.
 *
 * Four draw calls: the marble (both lathe profiles merged), the three pools' surfaces, the three falling
 * sheets, and the spray. All animation is in shaders driven by one time uniform; nothing is allocated per
 * frame. Nothing casts shadows. A cylinder collider keeps players out of the basin, and a quiet synthesized
 * trickle (audio/fountainSound.js) plays from the fountain once the game's audio is unlocked.
 * `stoneMap` is accepted for parity with the other set pieces; the marble is procedural.
 */
export default function Fountain({ stoneMap = null }) {
  const tier = usePerf((s) => s.tier);
  const { camera, gl } = useThree();
  const group = useRef();

  const assets = useMemo(() => {
    const time = { value: 0 }; // shared by every shader here
    return {
      time,
      marble: marbleGeometry(),
      marbleMaterial: marbleMaterial(),
      water: waterGeometry(),
      waterMaterial: waterMaterial(time),
      falls: fallsGeometry(),
      fallsMaterial: fallsMaterial(time),
      splash: createSplash(time),
    };
  }, []);

  useEffect(
    () => () => {
      for (const key of ['marble', 'marbleMaterial', 'water', 'waterMaterial', 'falls', 'fallsMaterial']) assets[key].dispose();
      assets.splash.geometry.dispose();
      assets.splash.material.dispose();
    },
    [assets],
  );

  // Sound: the buffer is synthesized when the page is idle (it takes ~60 ms), the PositionalAudio is made
  // once SpatialAudio has put its listener on the camera, and playback waits for the audio to be unlocked.
  const audio = useRef({ buffer: null, sound: null, playing: false }).current;
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 200));
    const cancelIdle = window.cancelIdleCallback ?? clearTimeout;
    const job = idle(() => {
      audio.buffer = createFountainBuffer(AudioContext.getContext(), SOUND.seconds);
    });
    return () => {
      cancelIdle(job);
      const { sound } = audio;
      if (sound) {
        if (sound.isPlaying) sound.stop();
        sound.disconnect();
        sound.getOutput().disconnect();
        sound.gain.disconnect();
        sound.removeFromParent();
      }
      audio.sound = null;
      audio.playing = false;
    };
  }, [audio]);

  useFrame((state) => {
    assets.time.value = state.clock.elapsedTime;
    // Pixels per metre at distance 1, so droplets keep their real size on any screen.
    assets.splash.material.uniforms.uScale.value = gl.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));

    if (audio.playing || !audio.buffer) return;
    if (!audio.sound) {
      const listener = camera.children.find((c) => c.isAudioListener);
      if (!listener || !group.current) return; // SpatialAudio hasn't mounted yet: try again next frame
      const sound = new PositionalAudio(listener);
      sound.setBuffer(audio.buffer);
      sound.setLoop(true);
      sound.setVolume(SOUND.volume);
      sound.setRefDistance(SOUND.refDistance);
      sound.setRolloffFactor(SOUND.rolloff);
      sound.setDistanceModel('inverse');
      sound.setMaxDistance(40);
      sound.position.set(0, SOUND.height, 0);
      group.current.add(sound);
      audio.sound = sound;
    }
    if (audio.sound.context.state === 'running') {
      audio.sound.play();
      audio.playing = true;
    }
  });

  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[COLLIDER_HALF_HEIGHT, FOUNTAIN.radius]} position={[FOUNTAIN.x, COLLIDER_HALF_HEIGHT, FOUNTAIN.z]} />
      </RigidBody>
      {/* Translated only: the shaders treat the group's axes as world axes. */}
      <group ref={group} position={[FOUNTAIN.x, 0, FOUNTAIN.z]}>
        <mesh geometry={assets.marble} material={assets.marbleMaterial} receiveShadow />
        {/* Pools, then the sheets falling into them, then the spray: transparent, so drawn in that order. */}
        <mesh geometry={assets.water} material={assets.waterMaterial} receiveShadow renderOrder={1} />
        <mesh geometry={assets.falls} material={assets.fallsMaterial} renderOrder={2} />
        {tier !== 'low' && <primitive object={assets.splash} renderOrder={3} />}
      </group>
    </>
  );
}
