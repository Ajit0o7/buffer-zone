import { useLayoutEffect, useRef } from 'react';
import { keepOutOfReflections } from '../world/layers';

/** Draws its children for the main camera only, not in the marble floor's reflection (see world/layers.js). */
export default function OutOfReflections({ children, name }) {
  const group = useRef();
  useLayoutEffect(() => {
    // Children mount (and run their own layout effects) first, so their meshes exist by now.
    keepOutOfReflections(group.current);
  });
  return <group ref={group} name={name}>{children}</group>;
}
