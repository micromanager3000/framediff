import type {
  AnimationSnapshot,
  CompositionDescriptor,
  TimelineItemSnapshot,
  UnrollGroupSnapshot,
} from "@framediff/studio-model";
import { resolveCompositionAuthoring } from "@framediff/studio-model";

/**
 * Compatibility projection for callers that only need the timeline decision. The kind-level
 * resolver also owns transport, direct manipulation, and composition-drop semantics.
 */
export function shouldShowTimeline(
  composition: CompositionDescriptor | undefined,
  items: TimelineItemSnapshot[],
  animations: AnimationSnapshot[],
  unrollGroups: UnrollGroupSnapshot[],
): boolean {
  return resolveCompositionAuthoring(composition, items, animations, unrollGroups).timeline;
}
