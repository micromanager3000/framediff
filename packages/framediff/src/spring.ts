// A deterministic spring — a pure function of the frame. Integrates a damped harmonic oscillator
// from rest toward the target at a fixed dt = 1/fps, so the same frame always yields the same value
// (no wall-clock, no rAF). Mirrors the classic mass/stiffness/damping model used for UI springs.

export interface SpringConfig {
  /** Higher = slower to accelerate. Default 1. */
  mass?: number;
  /** Higher = stiffer/faster pull to target. Default 100. */
  stiffness?: number;
  /** Higher = more friction. Low values overshoot; high values settle smoothly. Default 10. */
  damping?: number;
  /** Clamp the result so it never exceeds the target (kills overshoot). Default false. */
  overshootClamping?: boolean;
}

export interface SpringOptions {
  frame: number;
  fps: number;
  config?: SpringConfig;
  /** Value at rest. Default 0. */
  from?: number;
  /** Value at settle. Default 1. */
  to?: number;
  /** Delay the spring by this many frames. Default 0. */
  delay?: number;
}

/** Spring value at `frame` (deterministic). Returns `from` before `delay`, easing toward `to`. */
export function spring({ frame, fps, config = {}, from = 0, to = 1, delay = 0 }: SpringOptions): number {
  const mass = config.mass ?? 1;
  const stiffness = config.stiffness ?? 100;
  const damping = config.damping ?? 10;
  const clamp = config.overshootClamping ?? false;

  const elapsed = frame - delay;
  if (elapsed <= 0) return from;

  // Integrate at a fixed 1/600s sub-step (independent of fps) so the solver stays stable even for
  // stiff / heavily-damped configs — a per-frame step diverges when damping is large. Deterministic:
  // the result is a pure function of the elapsed time (elapsed/fps).
  const seconds = elapsed / fps;
  const dt = 1 / 600;
  const steps = Math.max(1, Math.round(seconds / dt));
  let x = 0; // normalized position 0 → 1
  let v = 0; // velocity
  for (let i = 0; i < steps; i++) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
  }
  if (clamp && x > 1) x = 1;
  return from + (to - from) * x;
}
