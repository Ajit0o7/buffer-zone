// Central tuning constants. Keep asset URLs here so swapping a model never touches gameplay code.

/**
 * Avatars. Each one names its model, the file its idle/walk/run clips come from, and the ground speed
 * each clip was captured at (playback rate = actual speed / this, so feet don't slide).
 *
 * The boy and the girl are realistic Microsoft Rocketbox characters (MIT licence) dressed in Nepali
 * clothes by scripts/dress-avatars.py: daura suruwal, waistcoat and Dhaka topi; a sari with a cholo.
 * Their motion-capture clips (male and female idle, fast walk and run, from the same library and
 * skeleton) are built into their own files, so they play as recorded, with nothing to download.
 * A model with a different rig can name another file as clipSource: its clips are then retargeted
 * by bone name (avatar/retarget.js).
 */
export const AVATARS = {
  boy: {
    url: '/models/avatars/boy.glb', // host
    clipSource: '/models/avatars/boy.glb',
    clipSpeed: { walk: 2.01, run: 5.86 }, // measured by scripts/dress-avatars.py
  },
  girl: {
    url: '/models/avatars/girl.glb', // guest
    clipSource: '/models/avatars/girl.glb',
    clipSpeed: { walk: 1.92, run: 5.38 },
  },
};
// Clip names to look for in the clip source (first match wins, case-insensitive).
export const CLIP_NAMES = { idle: ['idle'], walk: ['walk'], run: ['run'] };

// Heads turn toward the partner when they're this close, within this angle of straight ahead.
export const HEAD_LOOK = { radius: 4.5, maxYaw: (70 * Math.PI) / 180, maxPitch: (25 * Math.PI) / 180, eyeHeight: 1.6 };

// Fallback capture speeds for avatars that don't give their own clipSpeed.
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

// The host plays the boy, the guest the girl.
export const AVATAR_BY_ROLE = { host: 'boy', guest: 'girl' };
export const partnerRole = (role) => (role === 'host' ? 'guest' : 'host');

// Player capsule: 1.8 m tall overall, matching the avatars. The slightly wider radius keeps the player
// from threading between column bases in the colonnades. Positions sent over the network are its centre.
export const CAPSULE = { radius: 0.35, halfHeight: 0.55, center: 0.9 }; // center = halfHeight + radius

// Locomotion, tuned for the larger halls.
// Human speeds, close to the clips' own, so legs move at their natural rate.
export const WALK_SPEED = 2.2; // m/s, a brisk walk
export const RUN_SPEED = 5.8; // m/s
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
  releaseRadius: 10, // a closed painting hands its photo back to the texture cache beyond this distance
  textureBudgetMB: 128, // idle (unreferenced) photo textures are kept up to this estimated GPU size...
  maxResident: 6, // ...and at most this many photo textures stay loaded at once (visible ones are never dropped)
  spotlights: 2, // fixed size of the spotlight pool, so light count (and shader variants) never change
};
