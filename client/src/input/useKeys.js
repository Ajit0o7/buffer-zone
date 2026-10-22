import { useEffect, useRef } from 'react';

const BINDINGS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
};

/** Returns a ref holding the currently held actions. Read it inside useFrame, never via state. */
export function useKeys() {
  const held = useRef({ forward: false, back: false, left: false, right: false, run: false });

  useEffect(() => {
    const setHeld = (isDown) => (event) => {
      const action = BINDINGS[event.code];
      if (action) held.current[action] = isDown;
    };
    const onDown = setHeld(true);
    const onUp = setHeld(false);
    const releaseAll = () => {
      for (const key of Object.keys(held.current)) held.current[key] = false;
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', releaseAll); // avoid stuck keys when focus leaves the tab
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', releaseAll);
    };
  }, []);

  return held;
}
