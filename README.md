# Our House — a private two-player 3D mansion

A web-native, real-time 3D home for two people. The host (the boy) creates a room and shares a key;
the guest (the girl) enters it and both walk through a photoreal house together.

```
buffer-zone/
├── client/                React Three Fiber + Drei + Rapier + Vite
│   ├── index.html
│   ├── vite.config.js     code-splitting for the 3D engine
│   ├── public/            static, cacheable assets (served as-is)
│   │   ├── models/        mansion.glb, mansion.collision.glb, avatars/{boy,girl}.glb
│   │   ├── animations/    idle.glb, walk.glb, run.glb (one clip each, retargeted)
│   │   ├── photos/        WebP/KTX2 photos referenced by gallery/photos.js
│   │   ├── audio/         romantic-theme.ogg, footstep.ogg
│   │   └── draco/gltf/    Draco decoder (copied from three on npm install)
│   └── src/
│       ├── main.jsx · App.jsx · styles.css
│       ├── lobby/         Lobby.jsx: create room / enter key
│       ├── net/           socket.js: Socket.io client + event bridge
│       ├── state/         session.js: zustand (UI state, reconnect token)
│       ├── world/         config.js (tuning + asset URLs), shared.js (per-frame state), rooms.js (zones)
│       ├── input/         useKeys.js
│       ├── scene/         GameScene.jsx (Canvas), Lighting.jsx (IBL + post), Mansion.jsx (lazy GLB + colliders)
│       ├── avatar/        Avatar.jsx (blend tree), LocalPlayer.jsx (physics + camera + sync), RemotePlayer.jsx
│       ├── gallery/       PhotoFrames.jsx (spotlight + proximity), photos.js (your data)
│       ├── audio/         SpatialAudio.jsx (room music + positional footsteps)
│       ├── hud/           Hud.jsx (room key, photo caption overlay)
│       └── utils/         math.js (damped smoothing)
├── server/                Node 20+ · Socket.io 4
│   └── src/
│       ├── index.js       HTTP + Socket.io, validation, rate limits, 20 Hz fan-out
│       └── rooms.js       room registry: keys hashed, tokens for reconnect, cleanup
└── scripts/copy-draco.mjs
```

---

## 1. Architecture

### 1.1 Frontend

| Concern | Choice | Why |
|---|---|---|
| Renderer | React Three Fiber 9 + Three.js r170 | Declarative scene, React state for UI, imperative `useFrame` for the hot path |
| Helpers | `@react-three/drei` | `useGLTF`, `useAnimations`, `Environment`, `Html` |
| Post | `@react-three/postprocessing` (SSAO, Bloom, DoF, ACES) | Composed pass chain; `multisampling={0}` avoids MSAA cost |
| Physics | `@react-three/rapier` (WASM) | Capsule character, trimesh walls, no tunnelling at 60 fps |
| Net | `socket.io-client`, WebSocket only | Skips the long-poll upgrade; lower latency |
| State | `zustand` | Tiny store; per-frame data stays in plain objects (`world/shared.js`) |
| Build | Vite 6 | Fast dev, code-splitting, Draco/KTX2 aware |

**Rule:** no React state in the render loop. Positions, velocities and blend weights live in mutable
objects and are read in `useFrame`. React only renders UI that changes at human speed (lobby, captions, key card).

### 1.2 Backend

Single Node process, in-memory rooms (`server/src/rooms.js`).

- **Room key:** 8 characters from a 31-symbol alphabet with no look-alikes. ~40 bits of entropy.
  Only a SHA-256 hash is stored; the plaintext key goes to the host once.
- **Join protection:** per-socket cap of 8 wrong keys, then the socket is refused.
- **Reconnect:** each seat has a 24-byte random token (in `sessionStorage` only) so a refresh reclaims your seat.
  Cleanup of an empty room runs after 60 s.
- **Sync:** the client sends `player:update` at 20 Hz (`volatile`). The server validates and clamps every
  field, then fans out each seat's latest state to its partner at 20 Hz, only when it changed.
- **Inbound cap:** 66 Hz per socket. Excess packets are dropped rather than queued.

### 1.3 Network protocol

| Direction | Event | Payload | Notes |
|---|---|---|---|
| C→S | `room:create` (ack) | — | → `{ roomId, key, role:'host', token }` |
| C→S | `room:join` (ack) | `{ key }` | → `{ roomId, role:'guest', token, peerConnected }` |
| C→S | `room:resume` (ack) | `{ roomId, token }` | Reclaim a seat after reconnect |
| C→S | `player:update` (volatile) | `{ p:[x,y,z], r, a, v }` | 20 Hz |
| S→C | `world:peer` (volatile) | `{ p, r, a, v, t }` | Partner's latest state, 20 Hz |
| S→C | `room:peer` | `{ connected }` | Partner joined or left |

Bandwidth: about 60 bytes × 20 Hz × 2 directions ≈ 2.4 KB/s per player. Latency is one network RTT plus
interpolation delay (~70 ms with `POSITION_LAMBDA = 14`).

### 1.4 Motion and animation

- **Local player:** a dynamic capsule with rotation locked. Input sets *velocity*, not position, so walls
  stop it through the physics solver.
- **Blend tree:** a 1-D tree on ground speed, idle → walk (2.2 m/s) → run (4.8 m/s), with linear cross-weights
  that sum to 1. Weights are damped every frame (`λ = 8`), so transitions never pop.
- **Partner:** visual only, interpolated toward the latest server sample. Uses the same blend tree from the speed it receives.

### 1.5 Rendering pipeline

```
Environment (IBL)  ─┐
Key light (shadow) ─┼─► Scene ─► SSAO ─► Bloom ─► DepthOfField ─► ToneMapping (ACES) ─► screen
Warm practicals    ─┘
```

Quality tiers are in `scene/Lighting.jsx`. The `quality="low"` path drops SSAO and DoF (the two most expensive passes).

### 1.6 Interaction and audio

- **Photo frames:** when the local player is within 2.6 m, a spotlight eases on (intensity damped to 45),
  and the DOM caption fades in. Outside that range it fades out.
- **Room music:** each zone in `world/rooms.js` has a music weight. Volume eases toward it (λ = 2).
- **Partner footsteps:** a `PositionalAudio` anchored to the partner. Cadence = speed ÷ 0.9 m per stride,
  so it speeds up on a run and stops when they stop. Falls off with distance (inverse model, 2 m reference).
- **Autoplay:** the Enter click in the lobby calls `AudioContext.resume()`. The music starts on that gesture.

---

## 2. Asset pipeline

The goal is a first load under ~15 MB and a steady 60 fps on a mid-range laptop.

### 2.1 Budgets

| Asset | Target triangles | Textures | Compressed size |
|---|---|---|---|
| Mansion (visual) | 1–2 M total, instanced repeats | 4K PBR sets for hero surfaces, 2K elsewhere | ≤ 8 MB (GLB) |
| Mansion collision | ≤ 30 k | none | ≤ 300 KB |
| Avatar (each) | 60–100 k | 2K PBR (albedo, normal, ORM) | ≤ 3 MB |
| Animation clip | — | — | ≤ 300 KB each |
| Photos | — | 2048 px WebP, ~250 KB each | — |

### 2.2 Compression

```bash
# Draco geometry + WebP textures (pairs with the Draco decoder in public/draco/)
npx @gltf-transform/cli optimize in.glb out.glb \
  --compress draco --texture-compress webp --texture-size 2048

# Alternative: meshopt geometry + KTX2 (GPU-native, smaller decode cost)
npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress ktx2

# Collision mesh: decimate hard, keep it watertight
npx @gltf-transform/cli simplify collision-src.glb mansion.collision.glb --ratio 0.02
```

Check the result with `npx @gltf-transform/cli inspect out.glb` before shipping.

### 2.3 Loading strategy

- **Lazy chunk:** the mansion is `lazy()`-imported, so the lobby never pulls in the engine.
- **Per-room streaming (next step):** split the house into `hall.glb`, `bedroom.glb` and so on, and load the
  neighbouring zone when the player nears its door. Keeps GPU memory bounded.
- **Preload:** once the lobby is shown, call `useGLTF.preload()` for the avatars, so the scene opens with no visible pop-in.

---

## 3. Recommended tools (2026)

I could not check these live, so verify availability, licences and pricing before you commit.

**Mansion and environment**
- **Blender** (free): clean, retopologise and bake. Export GLB with the Draco or meshopt options.
- **Poly Haven** (CC0): HDRIs for IBL, and PBR materials (wood, plaster, fabric). Use 2K–4K.
- **Sketchfab / Fab / CGTrader**: pre-made interiors. Check the licence allows a private, non-commercial use.
- **Unreal / Bridge** (free): if you want to hand-author the lighting, bake it and export the lightmaps.
- **Gaussian splats (Luma, Polycam)**: a real room scanned into a splat, for a photo-real background. Advanced.

**Avatars**
- **Ready Player Me**: the high-res GLB avatar you named. Check the service is still active and its licence
  before building around it.
- **Character Creator 4 / Avaturn / VRoid Studio**: alternatives if RPM is unavailable.
- **Mixamo** (Adobe, free with an account): motion-captured clips for idle, walk, run. Export each as FBX, then
  convert to GLB in Blender.

**Retargeting (required for Mixamo ↔ RPM)**
- Mixamo rigs use `mixamorig:` bone names. RPM rigs use different names, so the clips will not bind directly.
  Retarget in Blender with the **Rokoko** add-on or the **Auto-Rig Pro** retargeter, then export
  one-animation GLBs against the avatar's skeleton. The clips must use the same bone names as the avatar.

**Optimisation and QA**
- **glTF-Transform** (CLI): inspect, optimise, dedupe, compress.
- **gltfpack** (meshoptimizer): a fast alternative to glTF-Transform.
- **Spector.js**: a WebGL frame-capture inspector, to find draw-call and overdraw hot spots.
- **Lighthouse / WebPageTest**: check the first load.

---

## 4. Running it

```bash
# 1. Backend
cd server && npm install && npm run dev        # http://localhost:3001/health

# 2. Frontend (new terminal)
cd client && npm install && npm run dev        # http://localhost:5173
```

Both tabs can be on one machine for testing: one tab creates a room, the other joins with the key.

Assets: the starter code expects the GLBs and photos listed in the tree above. Until you add them, the scene
will show a loader and then an error, because the models are missing. The lobby, networking and server work without them.

Environment variables:
- `client/.env.local`: `VITE_SERVER_URL=https://your-server.example.com`
- server: `PORT`, `CLIENT_ORIGIN=https://your-site.example.com` (comma-separated for more than one)

---

## 5. Roadmap

1. **Assets in** — drop the mansion, avatars and clips into `public/`, then tune the collision mesh and room zones.
2. **Camera collision** — raycast from the orbit point and pull the camera in before it clips through walls.
3. **Interpolation buffer** — buffer 2–3 snapshots and interpolate on server time, for smoother remote motion under jitter.
4. **Phase sync** — align walk and run clip phases so cross-fades don't ghost.
5. **Hosting** — static client on a CDN with long cache lifetimes for `/models` and `/draco` (use content hashes). Server on a single small VM or container with WebSocket support.
6. **Privacy** — add a server-side expiry for rooms, and consider a rotated key if the room sits idle.
