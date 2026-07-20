export interface ParamKeyframe<T = unknown> {
  frame: number;
  value: T;
  ease?: string;
}

export type ParamBinding<T = unknown> =
  | { kind: "const"; value: T }
  | { kind: "keyframes"; keys: ParamKeyframe<T>[] }
  | { kind: "spring"; from: number; to: number; config?: { damping?: number; mass?: number; stiffness?: number } }
  | { kind: "expr"; code: string }
  | { kind: "link"; compositionKey: string; objectId: string; property: string };

export type CanonicalTweenKind = "to" | "from" | "fromTo" | "set";

/** Source-independent trace used to prove helper unrolling and render adapters are equivalent. */
export interface NormalizedTweenOperation {
  target: string;
  kind: CanonicalTweenKind;
  startFrame: number;
  durationInFrames: number;
  from?: Record<string, string | number | boolean>;
  to: Record<string, string | number | boolean>;
  ease?: string;
}

function orderedRecord(record: NormalizedTweenOperation["to"] | undefined): NormalizedTweenOperation["to"] | undefined {
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

export function normalizeTweenTrace(operations: NormalizedTweenOperation[]): NormalizedTweenOperation[] {
  return operations.map((operation) => ({
    ...operation,
    startFrame: Math.round(operation.startFrame),
    durationInFrames: Math.max(0, Math.round(operation.durationInFrames)),
    from: orderedRecord(operation.from),
    to: orderedRecord(operation.to) ?? {},
  }));
}

export function tweenTracesEqual(left: NormalizedTweenOperation[], right: NormalizedTweenOperation[]): boolean {
  return JSON.stringify(normalizeTweenTrace(left)) === JSON.stringify(normalizeTweenTrace(right));
}
