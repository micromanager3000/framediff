// A Remotion-parity spring (exact port of remotion's spring math) — used when porting Remotion
// compositions so motion matches frame-for-frame. Differences from our `spring()`: closed-form
// damped-oscillator advance stepped per output frame (not a fixed sub-step), plus Remotion's
// `durationInFrames` stretch (measured natural duration, frame axis rescaled) and its exact
// settle semantics (returns `to` beyond the stretched duration).
//
// Deterministic: a pure function of (frame, fps, config). No wall clock, no caching required for
// correctness (we keep a small measure cache for speed, keyed by the full config).

export interface SpringRConfig {
  damping?: number; // default 10
  mass?: number; // default 1
  stiffness?: number; // default 100
  overshootClamping?: boolean; // default false
}

interface AnimState {
  lastTimestamp: number;
  current: number;
  toValue: number;
  velocity: number;
}

// Advance the closed-form damped harmonic oscillator from `animation` to time `now` (ms).
function advance(animation: AnimState, now: number, config: Required<SpringRConfig>): AnimState {
  const { toValue, lastTimestamp, current, velocity } = animation;
  const deltaTime = Math.min(now - lastTimestamp, 64);
  const c = config.damping;
  const m = config.mass;
  const k = config.stiffness;

  const v0 = -velocity;
  const x0 = toValue - current;
  const zeta = c / (2 * Math.sqrt(k * m)); // damping ratio
  const omega0 = Math.sqrt(k / m); // undamped angular frequency (rad/ms scale below)
  const omega1 = omega0 * Math.sqrt(1 - zeta ** 2);
  const t = deltaTime / 1000;

  let position: number;
  let newVelocity: number;
  if (zeta < 1) {
    // under-damped
    const envelope = Math.exp(-zeta * omega0 * t);
    const frag1 = envelope * (Math.sin(omega1 * t) * ((v0 + zeta * omega0 * x0) / omega1) + x0 * Math.cos(omega1 * t));
    position = toValue - frag1;
    newVelocity =
      zeta * omega0 * frag1 -
      envelope * (Math.cos(omega1 * t) * (v0 + zeta * omega0 * x0) - omega1 * x0 * Math.sin(omega1 * t));
  } else {
    // critically damped
    const envelope = Math.exp(-omega0 * t);
    position = toValue - envelope * (x0 + (v0 + omega0 * x0) * t);
    newVelocity = envelope * (v0 * (t * omega0 - 1) + t * x0 * omega0 * omega0);
  }
  return { toValue, lastTimestamp: now, current: position, velocity: newVelocity };
}

function springCalculation(frame: number, fps: number, config: SpringRConfig): AnimState {
  const full: Required<SpringRConfig> = {
    damping: config.damping ?? 10,
    mass: config.mass ?? 1,
    stiffness: config.stiffness ?? 100,
    overshootClamping: config.overshootClamping ?? false,
  };
  if (full.damping <= 0) throw new Error("Spring damping must be greater than 0");
  let animation: AnimState = { lastTimestamp: 0, current: 0, toValue: 1, velocity: 0 };
  const frameClamped = Math.max(0, frame);
  const unevenRest = frameClamped % 1;
  for (let f = 0; f <= Math.floor(frameClamped); f++) {
    if (f === Math.floor(frameClamped)) f += unevenRest;
    animation = advance(animation, (f / fps) * 1000, full);
  }
  return animation;
}

const measureCache = new Map<string, number>();

/** How many frames a spring takes to settle (Remotion's measureSpring, threshold 0.005). */
export function measureSpringR({ fps, config = {}, threshold = 0.005 }: { fps: number; config?: SpringRConfig; threshold?: number }): number {
  if (threshold === 0) return Infinity;
  if (threshold === 1) return 0;
  const key = [fps, config.damping, config.mass, config.overshootClamping, config.stiffness, threshold].join("-");
  const hit = measureCache.get(key);
  if (hit !== undefined) return hit;

  let frame = 0;
  let animation = springCalculation(frame, fps, config);
  const diff = () => Math.abs(animation.current - animation.toValue);
  while (diff() >= threshold) {
    frame++;
    animation = springCalculation(frame, fps, config);
  }
  // it's bouncy: require it to stay within threshold for 20 consecutive frames
  let finishedFrame = frame;
  for (let i = 0; i < 20; i++) {
    frame++;
    animation = springCalculation(frame, fps, config);
    if (diff() >= threshold) {
      i = 0;
      finishedFrame = frame + 1;
    }
  }
  measureCache.set(key, finishedFrame);
  return finishedFrame;
}

export interface SpringROptions {
  frame: number;
  fps: number;
  config?: SpringRConfig;
  from?: number;
  to?: number;
  /** Stretch the spring so it settles in exactly this many frames (Remotion semantics). */
  durationInFrames?: number;
  delay?: number;
}

/** Remotion-parity spring value at `frame`. */
export function springR({ frame, fps, config = {}, from = 0, to = 1, durationInFrames, delay = 0 }: SpringROptions): number {
  const delayProcessed = frame - delay;
  const durationProcessed =
    durationInFrames === undefined
      ? delayProcessed
      : delayProcessed / (durationInFrames / measureSpringR({ fps, config }));
  if (durationInFrames && delayProcessed > durationInFrames) return to;

  const spr = springCalculation(durationProcessed, fps, config);
  const inner = config.overshootClamping ? (to >= from ? Math.min(spr.current, 1) : Math.max(spr.current, 1)) : spr.current;
  return from + (to - from) * inner;
}
