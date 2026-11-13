import { useEffect, useRef } from 'react';

/** Moves focus to the screen's heading when the screen opens, so keyboard and screen-reader users start at the top. */
export function useScreenHeading<T extends HTMLElement = HTMLHeadingElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}

/** Takes a replay link out of the address bar, without adding a history entry. */
export function clearHash(): void {
  if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`);
}
