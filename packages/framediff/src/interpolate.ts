// Map a value (usually the frame) from one range to another, with optional easing and
// clamping. The workhorse for animation in a composition.

export type EasingFn = (t: number) => number;

export const Easing = {
  linear: (t: number) => t,
  easeIn: (t: number) => t * t,
  easeOut: (t: number) => 1 - (1 - t) * (1 - t),
  easeInOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  cubicOut: (t: number) => 1 - Math.pow(1 - t, 3),
} satisfies Record<string, EasingFn>;

type Extrapolate = "clamp" | "extend";

export interface InterpolateOptions {
  extrapolateLeft?: Extrapolate;
  extrapolateRight?: Extrapolate;
  easing?: EasingFn;
}

export function interpolate(
  input: number,
  inputRange: number[],
  outputRange: number[],
  options: InterpolateOptions = {},
): number {
  const { extrapolateLeft = "extend", extrapolateRight = "extend", easing } = options;
  const n = inputRange.length;
  if (n < 2 || n !== outputRange.length) {
    throw new Error("interpolate: inputRange and outputRange must be the same length (>= 2)");
  }

  if (input < inputRange[0]) {
    if (extrapolateLeft === "clamp") return outputRange[0];
    return linear(input, inputRange[0], inputRange[1], outputRange[0], outputRange[1]);
  }
  if (input > inputRange[n - 1]) {
    if (extrapolateRight === "clamp") return outputRange[n - 1];
    return linear(input, inputRange[n - 2], inputRange[n - 1], outputRange[n - 2], outputRange[n - 1]);
  }
  for (let i = 1; i < n; i++) {
    if (input <= inputRange[i]) {
      return eased(input, inputRange[i - 1], inputRange[i], outputRange[i - 1], outputRange[i], easing);
    }
  }
  return outputRange[n - 1];
}

function linear(x: number, x0: number, x1: number, y0: number, y1: number): number {
  return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

function eased(x: number, x0: number, x1: number, y0: number, y1: number, easing?: EasingFn): number {
  if (x1 === x0) return y0;
  let t = (x - x0) / (x1 - x0);
  if (easing) t = easing(Math.max(0, Math.min(1, t)));
  return y0 + (y1 - y0) * t;
}
