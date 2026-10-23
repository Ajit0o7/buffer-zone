// Hearts to float up from an avatar. Avatars push where and how many; scene/Reactions.jsx drains the list.
export const heartBursts = []; // { x, y, z, count }
const MAX_PENDING = 12;

export function burstHearts(x, y, z, count = 5) {
  if (heartBursts.length >= MAX_PENDING) heartBursts.shift();
  heartBursts.push({ x, y, z, count });
}
