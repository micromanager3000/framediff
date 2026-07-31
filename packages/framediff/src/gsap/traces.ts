import type { NormalizedTweenOperation } from "@framediff/studio-model";

export interface RuntimeGsapTraceGroup {
  id: string;
  operations: NormalizedTweenOperation[];
  serializable: boolean;
  issues: string[];
}

const latestTraces = new Map<string, RuntimeGsapTraceGroup[]>();

export function getGsapRuntimeTraces(compositionId: string): RuntimeGsapTraceGroup[] {
  return latestTraces.get(compositionId) ?? [];
}

export function recordGsapRuntimeTraces(compositionId: string, traces: RuntimeGsapTraceGroup[]): void {
  latestTraces.set(compositionId, traces);
}
