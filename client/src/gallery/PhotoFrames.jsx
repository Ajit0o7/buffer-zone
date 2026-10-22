import { Component, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { Euler, Object3D, SRGBColorSpace, Vector3 } from 'three';
import { PHOTOS } from './photos';
import { useSession } from '../state/session';
import { localMotion } from '../world/shared';
import { PHOTO_PROXIMITY } from '../world/config';
import { damp } from '../utils/math';

// Frames stay visible even if their image fails to load, so one bad file can't blank the scene.
class FrameBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function FrameWithPhoto({ photo }) {
  const texture = useTexture(photo.src);
  texture.colorSpace = SRGBColorSpace;
  return (
    <mesh position={[0, 0, 0.03]}>
      <planeGeometry args={[1.0, 0.7]} />
      <meshStandardMaterial map={texture} roughness={0.85} metalness={0} />
    </mesh>
  );
}

function PhotoFrame({ photo }) {
  const lightRef = useRef();
  const targetRef = useRef();
  const setActivePhoto = useSession((s) => s.setActivePhoto);

  const anchor = useMemo(() => new Vector3(...photo.position), [photo.position]);
  // The frame's outward normal, so the spotlight sits in front of the canvas, not inside the wall.
  const lightPos = useMemo(() => {
    const normal = new Vector3(0, 0, 1).applyEuler(new Euler(...photo.rotation));
    return anchor.clone().addScaledVector(normal, 1.6).add(new Vector3(0, 1.4, 0));
  }, [anchor, photo.rotation]);

  // Attach the spotlight's aim point once both objects exist.
  useEffect(() => {
    if (lightRef.current && targetRef.current) lightRef.current.target = targetRef.current;
  }, []);

  const nearRef = useRef(false);
  useFrame((_, dt) => {
    const near = localMotion.position.distanceTo(anchor) < PHOTO_PROXIMITY;

    // Ease the spotlight in and out instead of snapping on.
    const light = lightRef.current;
    if (light) light.intensity = damp(light.intensity, near ? 45 : 0, 3.5, dt);

    if (near !== nearRef.current) {
      nearRef.current = near;
      const store = useSession.getState();
      if (near) store.setActivePhoto(photo.id);
      else if (store.activePhoto === photo.id) store.setActivePhoto(null);
    }
  });

  return (
    <>
      <group position={photo.position} rotation={photo.rotation}>
        {/* Gilded frame: clearcoat gives the lacquered-wood sheen */}
        <mesh castShadow>
          <boxGeometry args={[1.22, 0.92, 0.05]} />
          <meshPhysicalMaterial color="#4a3320" roughness={0.35} clearcoat={0.6} clearcoatRoughness={0.25} />
        </mesh>
        <FrameBoundary fallback={<mesh position={[0, 0, 0.03]}><planeGeometry args={[1.0, 0.7]} /><meshStandardMaterial color="#222" /></mesh>}>
          <FrameWithPhoto photo={photo} />
        </FrameBoundary>
      </group>

      <spotLight
        ref={lightRef}
        position={lightPos}
        angle={0.28}
        penumbra={0.9}
        distance={9}
        intensity={0}
        color="#fff1d6"
      />
      <object3D ref={targetRef} position={photo.position} />
    </>
  );
}

export default function PhotoFrames() {
  return PHOTOS.map((photo) => <PhotoFrame key={photo.id} photo={photo} />);
}
