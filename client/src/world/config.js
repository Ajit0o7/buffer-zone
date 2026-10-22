// Central tuning constants. Keep asset URLs here so swapping a model never touches gameplay code.

export const AVATAR_URLS = {
  boy: '/models/avatars/boy.glb',
  girl: '/models/avatars/girl.glb',
};

// Both avatars are Mixamo rigs with the same bone names, so one file's clips drive either model.
// The boy file carries the motion-capture clips; CLIP_NAMES maps our states to the names inside it.
export const CLIP_SOURCE_URL = '/models/avatars/boy.glb';
export const CLIP_NAMES = { idle: 'idle', walk: 'walk', run: 'run' };

// Interior HDRI for image-based lighting (CC0, Poly Haven). Set to null for the procedural fallback.
export const HDRI_URL = '/hdri/venice_sunset_1k.hdr';


// The host is always the boy, the guest is always the girl.
export const AVATAR_BY_ROLE = { host: 'boy', guest: 'girl' };
export const partnerRole = (role) => (role === 'host' ? 'guest' : 'host');

export const WALK_SPEED = 2.2; // m/s
export const RUN_SPEED = 4.8; // m/s
export const SEND_HZ = 20; // local -> server position rate

// How far in the past the partner is rendered. One snapshot of headroom at 20 Hz hides normal jitter.
// Raise it on bad connections; lower it for snappier motion.
export const INTERP_DELAY_MS = 110;

export const PHOTO_PROXIMITY = 2.6; // metres at which a frame lights up
