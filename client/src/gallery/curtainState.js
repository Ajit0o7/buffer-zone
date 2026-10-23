import { Vector3 } from 'three';

// Shared, mutable gallery state. Read inside useFrame; never React state, so nothing re-renders.

/**
 * Per-painting override set by a click: true = held open, false = held closed. A painting without
 * an override follows proximity. Overrides are synced to the partner, so both see the same reveal.
 */
export const curtainOverrides = new Map();

/** The partner's interpolated position, refreshed once per frame by the gallery. */
export const partner = { position: new Vector3(), known: false, yaw: 0, speed: 0, sitting: false };

let emit = null;

/** Called by the socket layer; keeps this module free of a socket import (no circular dependency). */
export function setCurtainEmitter(fn) {
  emit = fn;
}

/** value: true | false | null (null clears the override, back to proximity). */
export function setCurtainOverride(id, value, { broadcast = true } = {}) {
  const current = curtainOverrides.has(id) ? curtainOverrides.get(id) : null;
  if (current === value) return;
  if (value === null) curtainOverrides.delete(id);
  else curtainOverrides.set(id, value);
  if (broadcast) emit?.(id, value);
}

/** Replaces all overrides with the room's current state (sent by the server on join or resume). */
export function applyCurtainSnapshot(snapshot) {
  curtainOverrides.clear();
  for (const [id, value] of Object.entries(snapshot ?? {})) {
    if (typeof value === 'boolean') curtainOverrides.set(id, value);
  }
}
