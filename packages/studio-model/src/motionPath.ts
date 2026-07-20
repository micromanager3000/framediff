export interface MotionPoint {
  x: number;
  y: number;
}

export interface CubicMotionSegment {
  from: MotionPoint;
  control1: MotionPoint;
  control2: MotionPoint;
  to: MotionPoint;
}

export interface GestureSample extends MotionPoint {
  frame: number;
}

const round = (value: number): number => Math.round(value * 1_000) / 1_000;
const point = (value: MotionPoint): MotionPoint => ({ x: round(value.x), y: round(value.y) });

export function makeArcSegment(
  from: MotionPoint,
  to: MotionPoint,
  curvature = 0.25,
  direction: "clockwise" | "counterclockwise" = "clockwise",
): CubicMotionSegment {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const sign = direction === "clockwise" ? 1 : -1;
  const normal = { x: -dy * curvature * sign, y: dx * curvature * sign };
  return {
    from: point(from),
    control1: point({ x: from.x + dx / 3 + normal.x, y: from.y + dy / 3 + normal.y }),
    control2: point({ x: from.x + 2 * dx / 3 + normal.x, y: from.y + 2 * dy / 3 + normal.y }),
    to: point(to),
  };
}

export function motionPathToSvg(segments: CubicMotionSegment[]): string {
  if (!segments.length) return "";
  const first = segments[0].from;
  return `M${round(first.x)},${round(first.y)} ` + segments.map((segment) =>
    `C${round(segment.control1.x)},${round(segment.control1.y)} ${round(segment.control2.x)},${round(segment.control2.y)} ${round(segment.to.x)},${round(segment.to.y)}`,
  ).join(" ");
}

export function parseMotionPathSvg(source: string): CubicMotionSegment[] | null {
  const tokens = source.match(/[MC]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens?.length || tokens[0].toUpperCase() !== "M") return null;
  let index = 1;
  const numeric = () => {
    const value = Number(tokens[index++]);
    return Number.isFinite(value) ? value : NaN;
  };
  let cursor = { x: numeric(), y: numeric() };
  if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return null;
  const segments: CubicMotionSegment[] = [];
  while (index < tokens.length) {
    if (tokens[index++].toUpperCase() !== "C") return null;
    const control1 = { x: numeric(), y: numeric() };
    const control2 = { x: numeric(), y: numeric() };
    const to = { x: numeric(), y: numeric() };
    if (![control1.x, control1.y, control2.x, control2.y, to.x, to.y].every(Number.isFinite)) return null;
    segments.push({ from: point(cursor), control1: point(control1), control2: point(control2), to: point(to) });
    cursor = to;
  }
  return segments.length ? segments : null;
}

export function pointOnCubic(segment: CubicMotionSegment, progress: number): MotionPoint {
  const t = Math.max(0, Math.min(1, progress));
  const u = 1 - t;
  return point({
    x: u ** 3 * segment.from.x + 3 * u ** 2 * t * segment.control1.x + 3 * u * t ** 2 * segment.control2.x + t ** 3 * segment.to.x,
    y: u ** 3 * segment.from.y + 3 * u ** 2 * t * segment.control1.y + 3 * u * t ** 2 * segment.control2.y + t ** 3 * segment.to.y,
  });
}

/** Keep the final pointer position observed for each integer composition frame. */
export function sampleGestureByFrame(samples: GestureSample[]): GestureSample[] {
  const byFrame = new Map<number, GestureSample>();
  for (const sample of samples) byFrame.set(Math.round(sample.frame), { frame: Math.round(sample.frame), ...point(sample) });
  return [...byFrame.values()].sort((left, right) => left.frame - right.frame);
}

function distanceToLine(value: MotionPoint, from: MotionPoint, to: MotionPoint): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (!dx && !dy) return Math.hypot(value.x - from.x, value.y - from.y);
  const t = Math.max(0, Math.min(1, ((value.x - from.x) * dx + (value.y - from.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(value.x - (from.x + dx * t), value.y - (from.y + dy * t));
}

export function simplifyGesture(samples: GestureSample[], tolerance = 2): GestureSample[] {
  const input = sampleGestureByFrame(samples);
  if (input.length <= 2) return input;
  const simplify = (start: number, end: number): GestureSample[] => {
    let furthest = -1;
    let distance = tolerance;
    for (let index = start + 1; index < end; index += 1) {
      const next = distanceToLine(input[index], input[start], input[end]);
      if (next > distance) { distance = next; furthest = index; }
    }
    if (furthest < 0) return [input[start], input[end]];
    return [...simplify(start, furthest).slice(0, -1), ...simplify(furthest, end)];
  };
  return simplify(0, input.length - 1);
}

/** Fit a deterministic C1-continuous Catmull–Rom-derived cubic through simplified samples. */
export function fitGesturePath(samples: GestureSample[], tolerance = 2): CubicMotionSegment[] {
  const anchors = simplifyGesture(samples, tolerance);
  if (anchors.length < 2) return [];
  const segments: CubicMotionSegment[] = [];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const previous = anchors[Math.max(0, index - 1)];
    const from = anchors[index];
    const to = anchors[index + 1];
    const next = anchors[Math.min(anchors.length - 1, index + 2)];
    segments.push({
      from: point(from),
      control1: point({ x: from.x + (to.x - previous.x) / 6, y: from.y + (to.y - previous.y) / 6 }),
      control2: point({ x: to.x - (next.x - from.x) / 6, y: to.y - (next.y - from.y) / 6 }),
      to: point(to),
    });
  }
  return segments;
}
