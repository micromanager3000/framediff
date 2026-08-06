import type {
  AnimationSnapshot,
  CompositionDescriptor,
  CompositionKind,
  CompositionType,
  NewCompositionTemplate,
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

export interface CompositionTypeContract {
  type: CompositionType;
  label: string;
  help: string;
  authoring?: Partial<CompositionKindAuthoringDefaults>;
}

export interface CompositionTemplateContract {
  template: NewCompositionTemplate;
  label: string;
  help: string;
  kind: CompositionKind;
  type: CompositionType;
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
  { kind: "custom", label: "Custom", help: "Frame-aware HTML, CSS, and JavaScript with no authored timeline", owns: "render", timeline: "hidden", transport: "always", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "scene", label: "Scene", help: "Reusable visual or procedural shot; timeline appears only for authored motion", owns: "render", timeline: "temporal", transport: "always", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "audio", label: "Audio", help: "Sound arrangement with timeline and transport", owns: "sound", timeline: "always", transport: "always", directManipulation: false, acceptsCompositionDrop: false },
  { kind: "plan", label: "Plan", help: "Timed beats or shots that can become an edit skeleton", owns: "timed-document", timeline: "always", transport: "always", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "doc", label: "Document", help: "Untimed structured reference document", owns: "document", timeline: "hidden", transport: "hidden", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "script", label: "Script", help: "Narrative document; temporal UI appears only when rows carry timing", owns: "document", timeline: "temporal", transport: "timeline", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "board", label: "Board", help: "Freeform planning canvas for cards and spatial relationships", owns: "canvas", timeline: "hidden", transport: "hidden", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "locations", label: "Locations", help: "Untimed, directly editable location and set reference catalog", owns: "document", timeline: "hidden", transport: "hidden", directManipulation: true, acceptsCompositionDrop: false },
  { kind: "cast", label: "Cast", help: "Untimed, directly editable cast and continuity catalog", owns: "document", timeline: "hidden", transport: "hidden", directManipulation: true, acceptsCompositionDrop: false },
] as const;

/** Runtime adapters may refine the UX without inventing new semantic composition kinds. */
export const COMPOSITION_TYPE_CONTRACTS: readonly CompositionTypeContract[] = [
  { type: "html", label: "HTML", help: "Authored HTML, CSS, and module setup" },
  { type: "three", label: "Three.js", help: "Package-mounted spatial scene with camera tools" },
  { type: "generative", label: "Generative", help: "Recipe inputs, parameters, and pinned takes", authoring: { timeline: "hidden", transport: "hidden", directManipulation: false, acceptsCompositionDrop: false } },
  { type: "processing", label: "Processing", help: "Pinned processing recipe and named output channels", authoring: { timeline: "hidden", transport: "always", directManipulation: false, acceptsCompositionDrop: false } },
  { type: "moodboard", label: "Moodboard", help: "Package-owned pan, zoom, cards, and media tools", authoring: { timeline: "hidden", transport: "hidden", directManipulation: true, acceptsCompositionDrop: false } },
] as const;

/** Creation choices are recipes, not new kinds. Each resolves to the two contract axes. */
export const COMPOSITION_TEMPLATE_CONTRACTS: readonly CompositionTemplateContract[] = [
  { template: "edit", label: "Edit", help: "Timed layers and nested compositions", kind: "edit", type: "html" },
  { template: "scene", label: "Scene", help: "Reusable visual shot with shared scene UX", kind: "scene", type: "html" },
  { template: "custom", label: "Custom", help: "Source-owned HTML, CSS, and JavaScript", kind: "custom", type: "html" },
  { template: "three", label: "3D canvas", help: "Scene scaffold for module-owned 3D rendering", kind: "scene", type: "three" },
  { template: "generate", label: "Generate", help: "Generative recipe with pinned takes", kind: "scene", type: "generative" },
  { template: "processing", label: "Process", help: "Pinned media processing recipe", kind: "scene", type: "processing" },
  { template: "audio", label: "Audio", help: "Sound arrangement with timeline and transport", kind: "audio", type: "html" },
  { template: "plan", label: "Plan", help: "Timed beats or shots", kind: "plan", type: "html" },
  { template: "script", label: "Script", help: "Narrative document with optional timing", kind: "script", type: "html" },
  { template: "doc", label: "Document", help: "Untimed structured reference", kind: "doc", type: "html" },
  { template: "board", label: "Board", help: "Freeform planning canvas", kind: "board", type: "html" },
  { template: "moodboard", label: "Moodboard", help: "Reference canvas with package-owned tools", kind: "board", type: "moodboard" },
  { template: "locations", label: "Locations", help: "Location and set reference catalog", kind: "locations", type: "html" },
  { template: "cast", label: "Cast", help: "Cast and continuity catalog", kind: "cast", type: "html" },
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

export function compositionTypeContract(type: CompositionType): CompositionTypeContract {
  return COMPOSITION_TYPE_CONTRACTS.find((contract) => contract.type === type)!;
}

export function compositionTemplateContract(template: NewCompositionTemplate): CompositionTemplateContract {
  return COMPOSITION_TEMPLATE_CONTRACTS.find((contract) => contract.template === template)!;
}

function hasTemporalProjection(
  composition: CompositionDescriptor,
  items: TimelineItemSnapshot[],
  animations: AnimationSnapshot[],
  unrollGroups: UnrollGroupSnapshot[],
): boolean {
  if (animations.length > 0 || unrollGroups.length > 0) return true;
  if (composition.kind === "scene") {
    if (items.length > 1) return true;
    return items.some((item) => {
      if (item.from !== 0 || item.durationInFrames !== composition.durationInFrames) return true;
      if (item.content.type === "layers") return false;
      // A leaf comp may expose its JSON-backed total duration in the Inspector while still only
      // needing a compact scrubber. Start/layer/trim edits describe a real arrangement and do
      // warrant the full timeline; duration alone does not.
      return !!(item.editable?.from || item.editable?.layer || item.editable?.trimStart);
    });
  }
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
  const kindDefaults = compositionKindAuthoringDefaults(composition.kind);
  const defaults = { ...kindDefaults, ...compositionTypeContract(composition.type).authoring };
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
