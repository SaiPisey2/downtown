let cached: boolean | null = null;

/** True when the browser can give us a WebGL2 context. Checked once. */
export function hasWebGL2(): boolean {
  if (cached !== null) return cached;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    cached = gl !== null;
    // browsers cap live contexts; hand this probe's back now rather than at garbage collection
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}

/** True when the address asks for the flat board (`?flat=1`), whatever the browser can do. */
export function flatAsked(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('flat', '1');
}
