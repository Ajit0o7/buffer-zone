# Our House — a private two-player 3D mansion

A web-native, real-time 3D home for two people. The host (the boy) creates a room and shares a key;
the guest (the girl) enters it and both walk through a cathedral-scale palace, where family photos hang behind
velvet curtains that part as you approach.

Deep dives: [docs/PERFORMANCE.md](docs/PERFORMANCE.md) (90+ fps architecture, KTX2 pipeline) ·
[docs/GALLERY.md](docs/GALLERY.md) (curtain mechanic, VRAM lifecycle, sync).

```
buffer-zone/
├── client/                React Three Fiber + Drei + Rapier + Vite
│   ├── index.html
│   ├── .env.example       VITE_SERVER_URL
│   ├── vite.config.js     code-splitting for the 3D engine
│   ├── public/            static, cacheable assets (served as-is)
│   │   ├── models/        mansion.glb (Sponza interior), avatars/{boy,girl}.glb (Mixamo rigs)
│   │   ├── hdri/          venice_sunset_1k.hdr (image-based lighting)
│   │   ├── photos/        your photos, referenced by gallery/photos.js (placeholders until you add yours)
│   │   ├── audio/         footstep.wav, romantic-theme.wav (placeholders until you add yours)
│   │   ├── draco/gltf/    Draco decoder   } copied from three on npm install
│   │   └── basis/         KTX2 transcoder }  (scripts/copy-decoders.mjs)
│   └── src/
│       ├── main.jsx · App.jsx · styles.css
│       ├── lobby/         Lobby.jsx: create room / enter key (shows offline state)
│       ├── ui/            ErrorBoundary.jsx: a failed asset shows a message, not a blank page
│       ├── net/           socket.js: Socket.io client + event bridge
│       ├── state/         session.js: zustand (UI state, reconnect token); perf.js: rendering tier
│       ├── world/         config.js (tuning + asset URLs), shared.js (per-frame state), rooms.js (zones)
│       ├── input/         useKeys.js
│       ├── scene/         GameScene.jsx (Canvas), Lighting.jsx (IBL, follow-sun shadows, post tiers),
│       │                  Mansion.jsx (lazy GLB + colliders), PerfGovernor.jsx (adaptive DPR and tier),
│       │                  loaders.js (Draco + KTX2 workers), Loading.jsx (DOM progress overlay)
│       ├── avatar/        Avatar.jsx (blend tree), LocalPlayer.jsx (character controller + camera + sync), RemotePlayer.jsx
│       ├── gallery/       PhotoFrames.jsx, CurtainPhotoFrame.jsx, GalleryBatch.jsx (instanced), curtainMaterial.js,
│       │                  textureCache.js (LRU VRAM), curtainState.js (sync), photos.js (your data)
│       ├── audio/         SpatialAudio.jsx (room music + positional footsteps)
│       ├── hud/           Hud.jsx (room key, photo caption overlay)
│       └── utils/         math.js (damped smoothing)
├── server/                Node 20+ · Socket.io 4
│   └── src/
│       ├── index.js       HTTP + Socket.io, rate limits, 20 Hz fan-out, graceful shutdown
│       ├── rooms.js       room registry: keys hashed, tokens for reconnect, cleanup
│       └── validate.js    pure input checks: key normalisation, payload sanitising
├── server/test/           node:test unit tests (run: npm test)
├── docs/                  PERFORMANCE.md, GALLERY.md
└── scripts/               copy-decoders.mjs, fetch-assets.mjs, make-standins.mjs
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
- **Join protection:** per-socket cap of 8 wrong keys, then the socket is refused. Keys are normalised, so `abcd-efgh`, `ABCDEFGH` and `abcd efgh` all work.
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
| C→S | `gallery:curtain` | `{ id, open }` | Click: hold open/closed, or `null` to release (burst 20, 10/s) |
| S→C | `gallery:curtain` | `{ id, open }` | The partner's click, mirrored |
| S→C | `gallery:state` | `{ [id]: bool }` | Held curtains, sent on join and resume |

Bandwidth: about 60 bytes × 20 Hz × 2 directions ≈ 2.4 KB/s per player. Latency is one network RTT plus
the interpolation delay (`INTERP_DELAY_MS = 110` in `world/config.js`).

### 1.4 Motion and animation

- **Local player:** a kinematic capsule (1.8 m, radius 0.35 m) moved by Rapier's character controller. It
  shape-casts, so it can't tunnel through walls at sprint speed; it climbs steps up to 0.4 m, snaps to the
  ground going down, and treats slopes over 50° as walls. Walk 3.5 m/s, sprint 8 m/s, with eased acceleration
  (λ = 10) and a slightly faster stop (λ = 14). The house is scaled 1.5× (`MANSION_SCALE`) to cathedral size.
- **Blend tree:** a 1-D tree on ground speed, idle → walk (3.5 m/s) → run (8 m/s), with linear cross-weights
  that sum to 1. Weights are damped every frame (`λ = 8`), so transitions never pop. Each clip plays at
  speed ÷ its capture speed (`CLIP_REFERENCE_SPEED`), so feet don't slide.
- **Partner:** visual only, no collider. Each server snapshot is stamped with the local receive time, and the partner is
  rendered `INTERP_DELAY_MS` in the past, blending between the two snapshots that bracket that moment. This needs no clock
  sync between machines, and it holds the last pose if packets stop instead of extrapolating.
- **Camera:** a third-person follow camera, 5.5 m back and 2.4 m up, FOV 60°, near 0.1 / far 250. A Rapier ray from the
  look point to the camera pulls the camera in when a wall is in the way, so the view never clips through the house.
- **Phase lock:** while walk and run blend, the run clip is set to walk's point in its cycle, so the legs don't ghost.

### 1.5 Rendering pipeline

```
Environment (IBL)               ─┐
Follow-sun (avatar shadows only) ─┼─► Scene ─► [SSAO*] ─► Bloom ─► [DoF*] ─► ToneMapping ─► grade (LUT) ─► screen
Spotlight pool (2, paintings)   ─┘                                   * cinematic tier only
```

The tier is chosen by `PerfGovernor` from the measured frame rate (target min(refresh, 90) fps), or forced with
`?quality=low|high|cinematic`. See [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

### 1.6 Interaction and audio

- **Curtain gallery:** each photo hangs behind a velvet curtain that parts within 3.5 m, or on a click that is
  synced to the partner. Photos load only when first revealed and are released when far away. See
  [docs/GALLERY.md](docs/GALLERY.md).
- **Room music:** each zone in `world/rooms.js` has a music weight, and the level crossfades over 6 m at zone edges.
- **Partner footsteps:** a `PositionalAudio` anchored to the partner. Cadence = speed ÷ 0.9 m per stride,
  so it speeds up on a run and stops when they stop. Falls off with distance (inverse model, 3 m reference, gentle rolloff for large halls).
- **Autoplay:** the Create/Join click in the lobby calls `AudioContext.resume()`. Music starts as soon as it has loaded, and on
  the next click if the browser still blocks it.

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

Assets: download and build the house, avatars and lighting with:

```bash
cd client && npm run assets
```

This fetches Khronos **Sponza** (a stone palace interior, about 52 MB, packed to about 11 MB with Draco and WebP), two
Mixamo characters with motion-capture idle, walk and run clips (Xbot and Michelle, from the three.js examples), and a Venice
sunset HDRI. The house is also its own collider, so walls, columns and floors stop the player.

Licences: these files are third-party. Sponza is under the CRYENGINE Limited License Agreement, and the Mixamo characters are
under Mixamo's terms. Both stay in your local `client/public/`, which the `.gitignore` excludes, and should not be published
without checking those terms. The HDRI is from Poly Haven (CC0).

The photos and music are still placeholders. Run `cd client && npm run standins` to regenerate them, and replace them with
your own files, keeping the same paths. The frame positions in `gallery/photos.js` were found by a search for wall areas flat
enough for a whole curtain and visible from where people walk; frames snap onto the wall at runtime. Re-check them if you
change the house (see [docs/GALLERY.md](docs/GALLERY.md)).

Tests: `cd server && npm test` runs the server unit tests (key handling, reconnect, relay, TTL cleanup, curtain sync).

Development builds expose `__three`, `__gallery` and `__teleport(x, y, z, yaw)` on `window` for testing and profiling;
production builds strip them.

Verified so far: the server unit tests pass, the client builds, and `npm run assets` rebuilds the house end to end. In a
browser, both players load into the Sponza house with the real avatars, and the guest's movement reaches the host's screen. Walking
to the west gallery shows a photo frame with its caption. Software rendering here runs at about 1.4 fps, so motion looks choppy in
this sandbox; it should run smoothly on a real GPU. Lighting, physics and the photo gallery are checked by screenshots, not by timing.

Not realistic yet: the Mixamo characters are stylised mannequins, not photoreal people. For photoreal avatars, export a
Ready Player Me file (or similar) at `avatars/boy.glb` and `avatars/girl.glb`, with its own rig and clips.

Environment variables (see `client/.env.example`):
- `client/.env.local`: `VITE_SERVER_URL=https://your-server.example.com`
- server: `PORT`, `CLIENT_ORIGIN=https://your-site.example.com` (comma-separated for more than one)

---

## 5. Roadmap

Done in this pass: camera occlusion, snapshot interpolation, walk/run phase lock, the offline environment, the error boundary,
the lobby's offline state, key normalisation, unit tests, and graceful shutdown.

1. **Photoreal avatars** — replace the Mixamo mannequins with photoreal characters that have walk and run clips.
   The house is a palace, so the photos and room zones may need tuning to your own layout.
2. **Touch controls** — the starter is keyboard and mouse only. Add a virtual joystick for phones.
3. **Per-room streaming** — split the house into zone GLBs and load neighbouring zones at their doors.
4. **Hosting** — static client on a CDN with long cache lifetimes for `/models`, `/draco` and `/hdri` (content-hashed). Server on one small container with WebSocket support.
5. **Privacy** — add server-side room expiry, and a rotated key if a room sits idle for a long time.
