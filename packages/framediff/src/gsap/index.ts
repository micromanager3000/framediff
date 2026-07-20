import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import type { CompositionSetup } from "../composition";
import type { NormalizedTweenOperation } from "@framediff/studio-model";

export interface FrameGsapTimeline {
  pause(atTime?: number, suppressEvents?: boolean): this;
  totalTime(value: number, suppressEvents?: boolean): this;
  kill(): void;
  getChildren?(nested?: boolean, tweens?: boolean, timelines?: boolean): unknown[];
}

export interface RuntimeGsapTraceGroup {
  id: string;
  operations: NormalizedTweenOperation[];
  serializable: boolean;
  issues: string[];
}

export interface FrameGsapContext {
  readonly gsap: typeof gsap;
  readonly root: HTMLElement;
  readonly fps: number;
  /** Convert an authored frame count to the seconds GSAP expects without losing frame intent. */
  frames(count: number): number;
  /** Execute a helper/loop normally while registering only the tweens it adds for safe unrolling. */
  unroll(id: string, timeline: FrameGsapTimeline, factory: () => void): void;
}

export type FrameGsapTimelineFactory = (context: FrameGsapContext) => FrameGsapTimeline;

interface GsapAdapterEngine {
  context(callback: () => void, scope?: Element | string | object): { revert(): void };
}

type TraceTween = {
  vars?: Record<string, unknown>;
  targets?: () => unknown[];
  duration?: () => number;
  startTime?: () => number;
  /** Resolved root-timeline time (covers nested stagger timelines and relative positions). */
  globalTime?: (localTime?: number) => number;
  _startAt?: { vars?: Record<string, unknown> };
};

const latestTraces = new Map<string, RuntimeGsapTraceGroup[]>();
const traceControlKeys = new Set([
  "parent", "id", "duration", "ease", "delay", "stagger", "overwrite", "immediateRender",
  "runBackwards", "startAt", "data", "callbackScope", "lazy", "paused", "repeat",
  "repeatDelay", "yoyo",
]);

function traceValues(
  vars: Record<string, unknown> | undefined,
  options: { reportCallbacks?: boolean } = {},
): { values: Record<string, string | number | boolean>; issues: string[] } {
  const values: Record<string, string | number | boolean> = {};
  const issues: string[] = [];
  for (const [key, value] of Object.entries(vars ?? {})) {
    if (traceControlKeys.has(key)) continue;
    if (key.startsWith("on")) {
      if (options.reportCallbacks !== false) issues.push(`callback ${key}`);
      continue;
    }
    if (["string", "number", "boolean"].includes(typeof value)) values[key] = value as string | number | boolean;
    else if (value != null) issues.push(`non-literal ${key}`);
  }
  return { values, issues };
}

function selectorOf(target: unknown): string | undefined {
  if (typeof Element !== "undefined" && target instanceof Element) {
    const id = target.getAttribute("data-fd-id");
    return id ? `[data-fd-id="${id.replaceAll('"', '\\"')}"]` : undefined;
  }
  return undefined;
}

function traceTween(tween: TraceTween, fps: number): { operations: NormalizedTweenOperation[]; issues: string[] } {
  const targets = tween.targets?.() ?? [];
  const to = traceValues(tween.vars);
  // GSAP synthesizes an onUpdate callback on the private start-at tween used by fromTo().
  // Authored callbacks remain visible on tween.vars and are rejected above; private callbacks
  // are engine bookkeeping and must not make an otherwise literal trace look unsafe.
  const from = traceValues(tween._startAt?.vars, { reportCallbacks: false });
  const issues = [...to.issues, ...from.issues];
  if (tween.vars?.stagger != null) issues.push("unresolved stagger");
  const selectors = targets.map(selectorOf);
  if (selectors.some((selector) => !selector)) issues.push("target without stable data-fd-id");
  const durationInFrames = Math.max(0, Math.round((tween.duration?.() ?? Number(tween.vars?.duration ?? 0)) * fps));
  const startFrame = Math.round((tween.globalTime?.(0) ?? tween.startTime?.() ?? 0) * fps);
  const kind = durationInFrames === 0 ? "set" : Object.keys(from.values).length ? "fromTo" : "to";
  const ease = typeof tween.vars?.ease === "string" ? tween.vars.ease : undefined;
  return {
    operations: selectors.flatMap((target) => target ? [{
      target,
      kind,
      startFrame,
      durationInFrames,
      ...(Object.keys(from.values).length ? { from: from.values } : {}),
      to: to.values,
      ...(ease ? { ease } : {}),
    } satisfies NormalizedTweenOperation] : []),
    issues,
  };
}

export function getGsapRuntimeTraces(compositionId: string): RuntimeGsapTraceGroup[] {
  return latestTraces.get(compositionId) ?? [];
}

export interface DefineGsapTimelineOptions {
  /** Test/integration seam. Production callers should use the bundled GSAP engine. */
  engine?: typeof gsap;
}

/**
 * Register a GSAP timeline as an ordinary FrameDiff setup.
 *
 * The adapter pauses the timeline and seeks it from the absolute composition frame. It never uses
 * GSAP's ticker as time authority, so preview scrubbing, random-access export, and repeated frame
 * evaluation all reach the same timeline time. Keep registered factories free of random values,
 * wall-clock reads, callbacks with side effects, and external ticker/autoplay control.
 */
export function defineGsapTimeline(
  factory: FrameGsapTimelineFactory,
  options: DefineGsapTimelineOptions = {},
): CompositionSetup {
  return ({ root, composition, onFrame, onCleanup }) => {
    const engine = (options.engine ?? gsap) as typeof gsap & GsapAdapterEngine;
    if (!options.engine) engine.registerPlugin(MotionPathPlugin);
    let timeline: FrameGsapTimeline | undefined;
    const traceGroups: RuntimeGsapTraceGroup[] = [];
    const unroll = (id: string, targetTimeline: FrameGsapTimeline, run: () => void) => {
      const before = new Set(targetTimeline.getChildren?.(true, true, false) ?? []);
      run();
      const added = (targetTimeline.getChildren?.(true, true, false) ?? []).filter((child) => !before.has(child));
      const normalized = added.map((child) => traceTween(child as TraceTween, composition.fps));
      const issues = normalized.flatMap((entry) => entry.issues);
      traceGroups.push({ id, operations: normalized.flatMap((entry) => entry.operations), serializable: !issues.length && !!added.length, issues });
    };
    const context = engine.context(() => {
      timeline = factory({
        gsap: engine,
        root,
        fps: composition.fps,
        frames: (count) => count / composition.fps,
        unroll,
      });
    }, root);
    if (!timeline) throw new Error("defineGsapTimeline() factory must return a GSAP timeline.");
    latestTraces.set(composition.id, traceGroups);

    // A caller may omit `{ paused: true }`; enforce the frame-driven contract at the boundary.
    timeline.pause(0, true);
    const stop = onFrame(({ frame }) => {
      timeline?.totalTime(frame / composition.fps, true);
    });
    onCleanup(() => {
      stop();
      timeline?.kill();
      context.revert();
    });
  };
}

export { gsap };
export { MotionPathPlugin };
