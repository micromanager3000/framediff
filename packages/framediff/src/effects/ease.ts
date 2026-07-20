// AE-style temporal ease between two keyframes with speed 0 at both ends: the VALUE curve is
// always the cubic s²(3−2s); the two INFLUENCES only warp time. With both influences at AE's
// default 33.33% the warp is the identity and this reduces exactly to smoothstep — larger
// influences hold near the endpoints longer and whip through the middle.

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/**
 * Evaluate the eased progress at normalized time t for a key pair with the given bezier
 * influences (outgoing influence of the from-key, incoming influence of the to-key), both in
 * (0, 1). aeEaseInfluence(t, 1/3, 1/3) === smoothstep(t).
 */
export function aeEaseInfluence(t: number, outInfluence = 1 / 3, inInfluence = 1 / 3): number {
  const x = clamp01(t);
  const a = Math.max(0.01, Math.min(0.99, outInfluence));
  const b = Math.max(0.01, Math.min(0.99, inInfluence));
  // time warp: x(s) = 3a·s(1−s)² + 3(1−b)·s²(1−s) + s³ — monotonic in s, solve by bisection
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const s = (lo + hi) / 2;
    const xs = 3 * a * s * (1 - s) * (1 - s) + 3 * (1 - b) * s * s * (1 - s) + s * s * s;
    if (xs < x) lo = s;
    else hi = s;
  }
  const s = (lo + hi) / 2;
  return s * s * (3 - 2 * s);
}
