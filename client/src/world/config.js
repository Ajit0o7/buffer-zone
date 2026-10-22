// Central tuning constants. Keep asset URLs here so swapping a model never touches gameplay code.

export const AVATAR_URLS = {
  boy: '/models/avatars/boy.glb',
  girl: '/models/avatars/girl.glb',
};

// Both avatars are Mixamo rigs with the same bone names, so one file's clips drive either model.
// The boy file carries the motion-capture clips; CLIP_NAMES maps our states to the names inside it.
export const CLIP_SOURCE_URL = '/models/avatars/boy.glb';
export const CLIP_NAMES = { idle: 'idle', walk: 'walk', run: 'run' };
// Ground speed each clip was captured at. Playback rate = actual speed / this, so feet don't slide.
export const CLIP_REFERENCE_SPEED = { walk: 1.8, run: 5.0 };

// Interior HDRI for image-based lighting (CC0, Poly Haven). Set to null for the procedural fallback.
export const HDRI_URL = '/hdri/venice_sunset_1k.hdr';
// Optional 3D colour-grading LUT (.cube). One texture lookup, merged into the tone-mapping pass.
export const LUT_URL = null;
// Optional baked lightmap for the house (second UV set, TEXCOORD_1). See docs/PERFORMANCE.md.
export const LIGHTMAP_URL = null;

// The house is authored at real scale; this multiplier makes it cathedral-sized
// (Sponza becomes about 45 m long, 27 m wide and 17 m to the vault). Avatars stay human-sized.
export const MANSION_SCALE = 1.5;

// The host is always the boy, the guest is always the girl.
export const AVATAR_BY_ROLE = { host: 'boy', guest: 'girl' };
export const partnerRole = (role) => (role === 'host' ? 'guest' : 'host');

// Locomotion, tuned for the larger halls.
export const WALK_SPEED = 3.5; // m/s
export const RUN_SPEED = 8.0; // m/s
export const ACCELERATION = 10; // how fast ground speed reaches its target (1/s)
export const DECELERATION = 14; // stops a little faster than it starts, so it doesn't feel floaty
export const GRAVITY = 20; // m/s², a little above Earth's so drops feel weighted under a game camera
export const SEND_HZ = 20; // local -> server position rate

// Third-person camera, tuned for tall vaults: further back and wider so the architecture reads.
export const CAMERA = {
  fov: 60,
  near: 0.1, // 0.1 / 250 keeps depth precision good enough to avoid z-fighting on distant columns
  far: 250,
  distance: 5.5,
  height: 2.4,
  lookHeight: 1.5,
  clearance: 0.3, // keep the lens this far off the wall it hits
};

// How far in the past the partner is rendered. One snapshot of headroom at 20 Hz hides normal jitter.
// Raise it on bad connections; lower it for snappier motion.
export const INTERP_DELAY_MS = 110;

// Curtain gallery
export const GALLERY = {
  proximityRadius: 3.5, // curtain opens when the player is this close (metres)
  closeRadius: 4.5, // and closes again beyond this, so it doesn't flicker on the boundary
  resetRadius: 12, // a clicked open/closed override returns to automatic once both players are this far away
  releaseRadius: 30, // a loaded photo is handed back to the texture cache beyond this distance
  textureBudgetMB: 128, // idle (unreferenced) photo textures are kept up to this estimated GPU size
  spotlights: 2, // fixed size of the spotlight pool, so light count (and shader variants) never change
};
