let cached: boolean | null = null;

/** True when the browser can give us a WebGL2 context. Checked once. */
export function hasWebGL2(): boolean {
  if (cached !== null) return cached;
  try {
    cached = document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    cached = false;
  }
  return cached;
}
