import type { Health } from '../metrics';

/** A shape for each state, so the colour is never the only signal: check, triangle, cross. */
export function HealthIcon({ health, label }: { health: Health; label?: string }) {
  return (
    <svg className={`icon icon-${health}`} viewBox="0 0 16 16" width="14" height="14" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      {health === 'ok' && <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {health === 'warn' && (
        <>
          <path d="M8 2l6.5 11.5h-13z" fill="currentColor" />
          <path d="M8 6.5v3.2M8 11.6v.1" stroke="#0b1226" strokeWidth="1.7" strokeLinecap="round" />
        </>
      )}
      {health === 'bad' && <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
    </svg>
  );
}
