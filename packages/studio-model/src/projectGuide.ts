import type { StudioGuideDescriptor, StudioGuideStep, StudioGuideTarget } from "./types";

/**
 * A project's guide is the one piece of Studio a project is expected to write for itself, so it
 * needs both halves: a shape every project shares, and room for the part only this project can
 * say.
 *
 * The shared half is here. The phases below are the arc a FrameDiff walkthrough follows — watch
 * the thing, understand how it is put together, change it, read what changed on disk, and ship
 * it — and the blueprints are the Studio moves that are true of every project regardless of what
 * it renders. A project picks the ones it wants, points them at its own compositions, and
 * overrides any sentence that deserves its own words.
 */
export const STUDIO_GUIDE_PHASES = ["WATCH", "STRUCTURE", "EDIT", "SOURCE", "STUDIO", "DELIVER"] as const;

/** One of the shared phases, or a project's own — the vocabulary is a default, not a fence. */
export type StudioGuidePhase = (typeof STUDIO_GUIDE_PHASES)[number] | (string & {});

/** The copy half of a step: everything except which composition and frame it lands on. */
export interface StudioGuideStepBlueprint {
  phase: StudioGuidePhase;
  title: string;
  description: string;
  /** Concrete user action to perform after opening the target. */
  try: string;
  /** Observable result that tells a new user the feature worked. */
  success: string;
}

/**
 * The Studio moves every project can teach, written so they read correctly against any project's
 * own footage. A project supplies the target; anything that deserves its own words is overridden
 * at the call site.
 */
export const COMMON_GUIDE_STEPS = {
  play: {
    phase: "WATCH",
    title: "Play the whole piece",
    description:
      "Preview is the real renderer, not an approximation of it. What you are watching is what a "
      + "render writes out, frame for frame.",
    try: "Press Space. Press it again to stop, then drag the playhead across the timeline.",
    success: "The transport reads out timecode and frames together, and scrubbing lands on exact frames.",
  },
  stage: {
    phase: "WATCH",
    title: "Read the stage",
    description:
      "The area around the frame is a status light, not decoration. It rests when you rest, warms "
      + "while playback runs, and sweeps amber while a render is working.",
    try: "Start playback and watch the surround rather than the frame.",
    success: "The field picks up while the transport runs, and settles again when you stop.",
  },
  nest: {
    phase: "STRUCTURE",
    title: "Open a nested composition",
    description:
      "Every clip can be a whole composition in its own right, editable on its own terms. There is "
      + "no separate 'simple' mode for small projects.",
    try: "Double-click the clip on the canvas, or open the composition in the left rail.",
    success: "The breadcrumb grows a level. Use it, or the up arrow next to it, to get back out.",
  },
  manipulate: {
    phase: "EDIT",
    title: "Move something, then undo it",
    description:
      "Direct manipulation writes to the file that owns the property. Nothing is stored in a hidden "
      + "document that only the Studio can read.",
    try: "Drag the selected element. Watch the top bar say 'writing source…', then press ⌘Z.",
    success: "The move lands, undo puts it back, and the source file holds the number you dragged it to.",
  },
  properties: {
    phase: "EDIT",
    title: "Change a property",
    description:
      "Properties are data, held in the composition's JSON document and validated by its schema — "
      + "which is also what generates the Inspector's fields.",
    try: "Select the element and push its Inspector fields around.",
    success: "The canvas updates live, and the new value is in the composition's JSON document.",
  },
  recut: {
    phase: "EDIT",
    title: "Re-cut the edit",
    description:
      "Timeline placement lives in a readable document, so a re-cut is a diff you can review rather "
      + "than an opaque binary change.",
    try: "Drag a clip earlier, or trim its right edge with the playhead and ].",
    success: "The clip moves, neighbouring clips show drop targets, and the new from and durationInFrames are on disk.",
  },
  source: {
    phase: "SOURCE",
    title: "Read the file you have been editing",
    description:
      "The Code panel is the same text your editor and your agents see. There is no export step "
      + "between what you just did and what is on disk.",
    try: "Open the CODE panel with this composition selected.",
    success: "You can find the exact element you edited, by the data-fd-id the Inspector showed you.",
  },
  feel: {
    phase: "STUDIO",
    title: "Tune the Studio itself",
    description:
      "Sound is synthesized in the browser — no audio files — and it is always muted while a render "
      + "runs. Motion follows your system's reduced-motion setting until you say otherwise.",
    try: "Open the sound control in the top bar and try the level slider, then toggle Motion.",
    success: "The control's own bars stop dancing when you mute it, and the stage holds still with motion off.",
  },
  render: {
    phase: "DELIVER",
    title: "Render it",
    description:
      "WebCodecs, in this browser, on your machine. Rendering the same project twice produces the "
      + "same bytes — which is what the determinism-check example proves frame by frame.",
    try: "Press Render. Let it finish.",
    success: "The stage sweeps amber with progress, the Studio stays silent throughout, and a chime marks the finish.",
  },
} as const satisfies Record<string, StudioGuideStepBlueprint>;

export type CommonGuideStepId = keyof typeof COMMON_GUIDE_STEPS;

/** A step built on a shared blueprint: bring the target, override whatever deserves your words. */
export interface CommonStudioGuideStepInput extends Partial<StudioGuideStepBlueprint> {
  common: CommonGuideStepId;
  /** Defaults to the blueprint's own name, which is unique within a guide already. */
  id?: string;
  target: StudioGuideTarget;
}

export type StudioGuideStepInput = StudioGuideStep | CommonStudioGuideStepInput;

/** What a project declares. Everything a guide needs beyond this is derived, not authored. */
export interface ProjectGuideDefinition {
  id: string;
  title: string;
  summary: string;
  estimatedMinutes?: number;
  /** Label above the title. Defaults to "PROJECT WALKTHROUGH". */
  kicker?: string;
  steps: StudioGuideStepInput[];
}

const isCommonStep = (step: StudioGuideStepInput): step is CommonStudioGuideStepInput =>
  "common" in step;

function resolveStep(step: StudioGuideStepInput, index: number, guideId: string): StudioGuideStep {
  const position = `${guideId} step ${index + 1}`;
  if (!isCommonStep(step)) {
    if (!step.id) throw new Error(`${position} needs an id.`);
    return { ...step };
  }
  const blueprint = COMMON_GUIDE_STEPS[step.common];
  if (!blueprint) {
    throw new Error(`${position} extends an unknown common step "${step.common}". Known steps: ${Object.keys(COMMON_GUIDE_STEPS).join(", ")}.`);
  }
  return {
    id: step.id ?? step.common,
    phase: step.phase ?? blueprint.phase,
    title: step.title ?? blueprint.title,
    description: step.description ?? blueprint.description,
    try: step.try ?? blueprint.try,
    success: step.success ?? blueprint.success,
    target: step.target,
  };
}

/**
 * Resolve a project's declaration into the descriptor the Studio renders.
 *
 * The validation here is deliberately loud: a walkthrough with a duplicated id or a step that
 * never says what success looks like is worse than no walkthrough, and it is far cheaper to fail
 * at module load than to ship a tour that silently skips a step.
 */
export function defineProjectGuide(definition: ProjectGuideDefinition): StudioGuideDescriptor {
  const { id, title, summary, estimatedMinutes, kicker } = definition;
  if (!id.trim()) throw new Error("A project guide needs an id.");
  if (!title.trim()) throw new Error(`Project guide "${id}" needs a title.`);
  if (!summary.trim()) throw new Error(`Project guide "${id}" needs a summary.`);
  if (!definition.steps.length) throw new Error(`Project guide "${id}" needs at least one step.`);

  const steps = definition.steps.map((step, index) => resolveStep(step, index, id));
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) throw new Error(`Project guide "${id}" repeats the step id "${step.id}".`);
    seen.add(step.id);
    if (!step.title.trim()) throw new Error(`Project guide step "${step.id}" needs a title.`);
    if (!step.try.trim()) throw new Error(`Project guide step "${step.id}" needs a concrete action.`);
    if (!step.success.trim()) throw new Error(`Project guide step "${step.id}" needs an observable success state.`);
    if (!step.target.compositionKey.trim()) throw new Error(`Project guide step "${step.id}" needs a target composition.`);
  }

  return Object.freeze({
    id,
    title,
    summary,
    estimatedMinutes,
    kicker: kicker ?? "PROJECT WALKTHROUGH",
    /** Where the walkthrough starts — the rail badges this composition as the way in. */
    entryCompositionKey: steps[0].target.compositionKey,
    steps: Object.freeze(steps) as StudioGuideStep[],
  });
}

/** Ordered phases as authored, so the guide surface groups steps the way the project wrote them. */
export function guidePhases(guide: StudioGuideDescriptor): string[] {
  return [...new Set(guide.steps.map((step) => step.phase))];
}
