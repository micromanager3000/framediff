import type {
  AnimationSnapshot,
  CompositionDescriptor,
  CompositionKind,
  TimelineItemSnapshot,
  UnrollGroupSnapshot,
} from "./types";

export interface CompositionKindAuthoringDefaults {
  /** `temporal` ignores a single full-span structural layers wrapper. */
  timeline: "always" | "temporal" | "hidden";
  transport: "always" | "timeline" | "hidden";
  directManipulation: boolean;
  acceptsCompositionDrop: boolean;
}

export interface CompositionKindContract extends CompositionKindAuthoringDefaults {
  kind: CompositionKind;
  label: string;
  help: string;
  /** The project data this kind primarily owns. */
  owns: "assembly" | "render" | "recipe" | "sound" | "timed-document" | "document" | "canvas";
}

export interface ResolvedCompositionAuthoring {
  timeline: boolean;
  transport: boolean;
  directManipulation: boolean;
  acceptsCompositionDrop: boolean;
}

/**
 * `kind` describes what the composition is, and this table supplies its normal Studio surfaces.
 * Individual compositions only need authoring metadata when they intentionally depart from these
 * semantics (for example, a static scene that does not need preview transport).
 */
export const COMPOSITION_KIND_CONTRACTS: readonly CompositionKindContract[] = [
  { kind: "edit", label: "Edit", help: "Timed layers and nested compositions", owns: "assembly", timeline: "always", transport: "always", directManipulation: true, acceptsCompositionDrop: true },
  { kind: "scene", label: "Scene", help: "Reusable visual or procedural shot; timeline appears only for authored motion", owns: "render", timeline: "temporal", transport: "always", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "3d", label: "3D", help: "Spatial or procedural scene with cameras and preview transport", owns: "render", timeline: "temporal", transport: "always", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "generate", label: "Generate", help: "Generative recipe with comp or asset inputs and pinned takes", owns: "recipe", timeline: "hidden", transport: "hidden", directManipulation: false, acceptsCompositionDrop: false },
  { kind: "audio", label: "Audio", help: "Sound arrangement with timeline and transport", owns: "sound", timeline: "always", transport: "always", directManipulation: false, acceptsCompositionDrop: false },
  { kind: "plan", label: "Plan", help: "Timed beats or shots that can become an edit skeleton", owns: "timed-document", timeline: "always", transport: "always", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "doc", label: "Document", help: "Untimed structured reference document", owns: "document", timeline: "hidden", transport: "hidden", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "script", label: "Script", help: "Narrative document; temporal UI appears only when rows carry timing", owns: "document", timeline: "temporal", transport: "timeline", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "storyboard", label: "Storyboard", help: "Editable shot panels; temporal UI appears only when panels carry timing", owns: "canvas", timeline: "temporal", transport: "timeline", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "board", label: "Board", help: "Freeform planning canvas for cards and spatial relationships", owns: "canvas", timeline: "hidden", transport: "hidden", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "moodboard", label: "Moodboard", help: "Freeform reference canvas with composition-owned pan, zoom, and card tools", owns: "canvas", timeline: "hidden", transport: "hidden", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "locations", label: "Locations", help: "Untimed, directly editable location and set reference catalog", owns: "document", timeline: "hidden", transport: "hidden", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "cast", label: "Cast", help: "Untimed, directly editable cast and continuity catalog", owns: "document", timeline: "hidden", transport: "hidden", directManipulation: true, acceptsCompositionDrop: false },
] as const;

const KIND_DEFAULTS = Object.fromEntries(
  COMPOSITION_KIND_CONTRACTS.map(({ kind, timeline, transport, directManipulation, acceptsCompositionDrop }) => [
    kind,
    { timeline, transport, directManipulation, acceptsCompositionDrop },
  ]),
) as Record<CompositionKind, CompositionKindAuthoringDefaults>;

export function compositionKindContract(kind: CompositionKind): CompositionKindContract {
  return COMPOSITION_KIND_CONTRACTS.find((contract) => contract.kind === kind)!;
}

export function compositionKindAuthoringDefaults(kind: CompositionKind): CompositionKindAuthoringDefaults {
  return KIND_DEFAULTS[kind];
}

function hasTemporalProjection(
  composition: CompositionDescriptor,
  items: TimelineItemSnapshot[],
  animations: AnimationSnapshot[],
  unrollGroups: UnrollGroupSnapshot[],
): boolean {
  if (animations.length > 0 || unrollGroups.length > 0) return true;
  return items.some((item) =>
    item.content.type !== "layers"
    || item.from !== 0
    || item.durationInFrames !== composition.durationInFrames,
  );
}

export function resolveCompositionAuthoring(
  composition: CompositionDescriptor | undefined,
  items: TimelineItemSnapshot[] = [],
  animations: AnimationSnapshot[] = [],
  unrollGroups: UnrollGroupSnapshot[] = [],
): ResolvedCompositionAuthoring {
  if (!composition) {
    return { timeline: false, transport: false, directManipulation: false, acceptsCompositionDrop: false };
  }
  const defaults = compositionKindAuthoringDefaults(composition.kind);
  const timelineMode = composition.authoring?.timeline;
  const timeline = timelineMode === "always"
    ? true
    : timelineMode === "hidden"
      ? false
      : defaults.timeline === "always"
        ? true
        : defaults.timeline === "temporal"
          ? hasTemporalProjection(composition, items, animations, unrollGroups)
          : false;
  const transportMode = composition.authoring?.transport;
  const transport = transportMode === "always"
    ? true
    : transportMode === "hidden"
      ? false
      : defaults.transport === "always" || (defaults.transport === "timeline" && timeline);
  return {
    timeline,
    transport,
    directManipulation: composition.authoring?.directManipulation ?? defaults.directManipulation,
    acceptsCompositionDrop: defaults.acceptsCompositionDrop,
  };
}
