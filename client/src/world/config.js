// Central tuning constants. Keep asset URLs here so swapping a model never touches gameplay code.

export const AVATAR_URLS = {
  boy: '/models/avatars/boy.glb',
  girl: '/models/avatars/girl.glb',
};

// Mixamo clips, each exported as a single-animation GLB retargeted to the avatar rig.
export const ANIMATION_URLS = {
  idle: '/animations/idle.glb',
  walk: '/animations/walk.glb',
  run: '/animations/run.glb',
};

// The host is always the boy, the guest is always the girl.
export const AVATAR_BY_ROLE = { host: 'boy', guest: 'girl' };
export const partnerRole = (role) => (role === 'host' ? 'guest' : 'host');

export const WALK_SPEED = 2.2; // m/s
export const RUN_SPEED = 4.8; // m/s
export const SEND_HZ = 20; // local -> server position rate

export const PHOTO_PROXIMITY = 2.6; // metres at which a frame lights up
