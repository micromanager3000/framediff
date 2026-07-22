const SOURCE_END_EPSILON_SECONDS = 1e-6;

/**
 * Visual media holds at its boundary. Audio is intentionally not routed through this helper: an
 * overlong audio placement should remain silent rather than repeat its final sample.
 */
export function clampVisualMediaTime(time: number, durationSeconds?: number | null): number {
  const startClamped = Number.isFinite(time) ? Math.max(0, time) : 0;
  if (durationSeconds == null || !Number.isFinite(durationSeconds)) return startClamped;
  return Math.min(startClamped, Math.max(0, durationSeconds - SOURCE_END_EPSILON_SECONDS));
}
