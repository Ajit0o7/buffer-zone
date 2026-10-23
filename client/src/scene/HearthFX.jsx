import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, PositionalAudio, ShaderMaterial } from 'three';
import { PRACTICALS } from '../world/rooms';
import { localMotion } from '../world/shared';
import { createFireBuffer } from '../audio/fireSound';

// The salon fireplace comes alive: embers lifting off the logs and winking out, and the sound of the fire, a low
// roar with crackles and pops, heard from across the room. The flames and the flickering light are the hearth
// practical's own (scene/Practicals.jsx). Embers are one Points object with a fixed pool, drawn only nearby.

const HEARTH = PRACTICALS.find((p) => p.id === 'hearth');
const POOL = 80;
const RATE = 16; // embers a second
const NEAR = 22; // metres: beyond this, no embers are simulated or drawn

const VERTEX = /* glsl */ `
  attribute float aLife;   // 0..1, or -1 when unused
  uniform float uScale;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aLife < 0.0 ? 0.0 : 0.035 * (1.0 - 0.6 * aLife) * uScale / -mv.z;
  }
`;
const FRAGMENT = /* glsl */ `
  varying float vLife;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d) * 4.0;
    if (r > 1.0 || vLife < 0.0) discard;
    vec3 hot = mix(vec3(3.2, 1.6, 0.45), vec3(1.4, 0.25, 0.05), vLife); // yellow-orange, cooling to red
    float fade = (1.0 - vLife) * (1.0 - r);
    gl_FragColor = vec4(hot * fade, 1.0);
  }
`;

export default function HearthFX() {
  const { camera, gl } = useThree();
  const state = useRef({ spawn: 0, next: 0, sound: null, started: false }).current;

  const embers = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(POOL * 3), 3));
    geometry.setAttribute('aLife', new BufferAttribute(new Float32Array(POOL).fill(-1), 1));
    const material = new ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    const sim = { age: new Float32Array(POOL).fill(-1), life: new Float32Array(POOL), vx: new Float32Array(POOL), vy: new Float32Array(POOL), vz: new Float32Array(POOL), phase: new Float32Array(POOL) };
    return { geometry, material, points, sim };
  }, []);

  useEffect(() => () => {
    embers.geometry.dispose();
    embers.material.dispose();
    if (state.sound) {
      if (state.sound.isPlaying) state.sound.stop();
      state.sound.parent?.remove(state.sound);
      state.sound.disconnect();
    }
  }, [embers, state]);

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    if (!HEARTH) return;
    const fire = HEARTH.position;

    // Sound: made once the game's listener exists, started once the browser lets audio play.
    if (!state.sound) {
      const listener = camera.children.find((c) => c.type === 'AudioListener'); // added by audio/SpatialAudio.jsx
      if (listener) {
        const sound = new PositionalAudio(listener);
        sound.setBuffer(createFireBuffer(listener.context));
        sound.setLoop(true);
        sound.setRefDistance(1.6);
        sound.setRolloffFactor(1.6);
        sound.setVolume(0.55);
        sound.position.copy(fire);
        frame.scene.add(sound);
        sound.updateMatrixWorld(true);
        state.sound = sound;
      }
    } else if (!state.started && state.sound.context.state === 'running') {
      state.sound.play();
      state.started = true;
    }

    const { sim } = embers;
    const pos = embers.geometry.attributes.position;
    const life = embers.geometry.attributes.aLife;
    const near = localMotion.position.distanceTo(fire) < NEAR;
    embers.points.visible = near;
    if (!near) return;

    state.spawn += dt * RATE;
    while (state.spawn >= 1) {
      state.spawn -= 1;
      const i = state.next;
      state.next = (state.next + 1) % POOL;
      pos.setXYZ(i, fire.x + (Math.random() - 0.5) * 0.7, fire.y - 0.2 + Math.random() * 0.1, fire.z + (Math.random() - 0.5) * 0.2);
      sim.age[i] = 0;
      sim.life[i] = 0.9 + Math.random() * 1.6;
      sim.vx[i] = (Math.random() - 0.5) * 0.15;
      sim.vy[i] = 0.45 + Math.random() * 0.7;
      sim.vz[i] = -0.05 - Math.random() * 0.12; // the draught carries them a little into the room
      sim.phase[i] = Math.random() * 6.28;
    }
    for (let i = 0; i < POOL; i++) {
      if (sim.age[i] < 0) continue;
      sim.age[i] += dt;
      const a = sim.age[i] / sim.life[i];
      if (a >= 1) {
        sim.age[i] = -1;
        life.setX(i, -1);
        continue;
      }
      const swirl = Math.sin(sim.age[i] * 5 + sim.phase[i]) * 0.25;
      pos.setXYZ(i, pos.getX(i) + (sim.vx[i] + swirl) * dt, pos.getY(i) + sim.vy[i] * (1 - 0.5 * a) * dt, pos.getZ(i) + sim.vz[i] * dt);
      life.setX(i, a);
    }
    pos.needsUpdate = true;
    life.needsUpdate = true;
    embers.material.uniforms.uScale.value = gl.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  });

  return <primitive object={embers.points} />;
}
