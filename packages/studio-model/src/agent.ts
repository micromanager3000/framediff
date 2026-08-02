import type { StudioApplication } from "./StudioApplication";
import { artifactStatusFromInputs, timelineItemSilence } from "./timeline";
import type {
  AgentCheckDiagnostic,
  AgentCheckResult,
  AgentCommandEnvelope,
  AgentCommandResult,
  AgentCompositionSnapshot,
  AgentFrameSnapshot,
  AgentProjectSnapshot,
  AgentSemanticCommand,
  AgentSourceRevisionSnapshot,
  CompositionOutputKind,
  PlacementEditResult,
  ProjectEditReceipt,
  ProjectEditResult,
} from "./types";

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function sourceFiles(application: StudioApplication): Map<string, Set<string>> {
  const state = application.session.state.get();
  return new Map(state.compositions.map((composition) => {
    const files = new Set<string>();
    if (composition.file) files.add(composition.file);
    for (const file of composition.sources ?? []) files.add(file);
    for (const animation of state.animationsByComposition[composition.key] ?? []) if (animation.source.file) files.add(animation.source.file);
    for (const diagnostic of state.animationDiagnosticsByComposition[composition.key] ?? []) if (diagnostic.source?.file) files.add(diagnostic.source.file);
    for (const group of state.unrollGroupsByComposition[composition.key] ?? []) if (group.source.file) files.add(group.source.file);
    return [composition.key, files] as const;
  }));
}

/** An audio-only source carries nothing but its performance — muting one is almost always a
 *  placeholder that outlived its purpose, and it is invisible in the preview because there is
 *  no picture to notice missing. Video keeps its own mute intent; only audio sources qualify.
 *  Lane classification matches `buildTimelineLanes`, so the badge and this agree by construction. */
function silentAudioSource(
  object: AgentCompositionSnapshot["objects"][number],
  outputKindByKey: Map<string, CompositionOutputKind>,
): "muted" | "zero volume" | null {
  const content = object.content;
  const isAudio = content.type === "audio"
    || (content.type === "nested" && outputKindByKey.get(object.production?.nestedCompositionKey ?? "") === "audio");
  return timelineItemSilence(object, isAudio ? "audio" : "video");
}

function checkSnapshot(snapshot: AgentProjectSnapshot): AgentCheckResult {
  const diagnostics: AgentCheckDiagnostic[] = [];
  const outputKindByKey = new Map(snapshot.compositions.map((entry) => [entry.composition.key, entry.composition.outputKind]));
  for (const entry of snapshot.compositions) {
    const key = entry.composition.key;
    for (const source of entry.sources) {
      if (source.hash == null) diagnostics.push({ code: "missing-source", severity: "error", compositionKey: key, file: source.file, message: `${source.file} is unavailable through the project bridge.` });
    }
    for (const object of entry.objects) {
      if (object.id.startsWith("clip:")) diagnostics.push({ code: "unstable-object", severity: "warning", compositionKey: key, objectId: object.id, message: `${object.id} is a generated fallback identity; author data-fd-id before machine editing it.` });
      if (object.editable && !Object.values(object.editable).some(Boolean)) diagnostics.push({ code: "read-only-object", severity: "info", compositionKey: key, objectId: object.id, message: `${object.id} is inspectable but its source authority is read-only.` });
      if (object.production?.availability === "missing") diagnostics.push({ code: "missing-asset", severity: "error", compositionKey: key, objectId: object.id, message: `${object.id} references media that is not available locally or remotely.` });
      if (object.production?.availability === "remote") diagnostics.push({ code: "remote-asset", severity: "info", compositionKey: key, objectId: object.id, message: `${object.id} will resolve its media remotely until it is cached locally.` });
      const silence = silentAudioSource(object, outputKindByKey);
      if (silence) diagnostics.push({ code: "silent-audio", severity: "warning", compositionKey: key, objectId: object.id, message: `${object.id} places an audio source but is ${silence} — it will render silent.` });
    }
    if (entry.opaqueAnimationCount) diagnostics.push({ code: "opaque-animation", severity: "warning", compositionKey: key, message: `${entry.opaqueAnimationCount} animation call${entry.opaqueAnimationCount === 1 ? " is" : "s are"} outside the registered editable subset.` });
    for (const diagnostic of entry.animationDiagnostics) {
      diagnostics.push({
        code: "opaque-animation",
        severity: diagnostic.severity,
        compositionKey: key,
        ...(diagnostic.source?.file ? { file: diagnostic.source.file } : {}),
        message: diagnostic.message,
      });
    }
    for (const animation of entry.animations) if (!animation.editable) {
      diagnostics.push({ code: "read-only-animation", severity: "info", compositionKey: key, objectId: animation.id, file: animation.source.file, message: `${animation.id} is ${animation.authority} and cannot be rewritten without materialization.` });
    }
    for (const group of entry.unrollGroups) if (!group.safe) {
      diagnostics.push({ code: "unsafe-unroll", severity: "warning", compositionKey: key, objectId: group.id, file: group.source.file, message: group.issues.join("; ") || `${group.id} cannot be safely unrolled.` });
    }
    const staleArtifacts = entry.artifacts.filter((artifact) => artifact.status === "stale");
    if (staleArtifacts.length) {
      const labels = [...new Set(staleArtifacts.map((artifact) => artifact.label ?? artifact.name))];
      diagnostics.push({
        code: "stale-artifact",
        severity: "warning",
        compositionKey: key,
        ...(staleArtifacts.length === 1 ? { objectId: staleArtifacts[0].contentHash ?? staleArtifacts[0].name } : {}),
        message: staleArtifacts.length === 1
          ? `${labels[0]} was built from older source revisions.`
          : `${staleArtifacts.length} cached artifacts (${labels.join(", ")}) were built from older source revisions.`,
      });
    }
  }
  // A cache may contain several physical records for the same content-addressed artifact, and the
  // registry may project the same authored diagnostic through more than one view. Agents need one
  // actionable finding, not repeated noise that crowds higher-value findings out of the response.
  const uniqueDiagnostics = [...new Map(diagnostics.map((diagnostic) => [[
    diagnostic.code,
    diagnostic.severity,
    diagnostic.compositionKey ?? "",
    diagnostic.objectId ?? "",
    diagnostic.file ?? "",
    diagnostic.message,
  ].join("\0"), diagnostic])).values()];
  const severityRank = { error: 0, warning: 1, info: 2 } as const;
  uniqueDiagnostics.sort((left, right) => severityRank[left.severity] - severityRank[right.severity]
    || (left.compositionKey ?? "").localeCompare(right.compositionKey ?? "")
    || left.message.localeCompare(right.message));
  return { ok: !uniqueDiagnostics.some((entry) => entry.severity === "error"), revision: snapshot.revision, diagnostics: uniqueDiagnostics };
}

type CommandDispatch = ProjectEditResult & { message?: string };

/**
 * First-party machine surface over the same Studio session, source writers and history manager.
 * It intentionally carries plain snapshots and semantic commands rather than DOM handles.
 */
export class StudioAgentApi {
  public readonly version = 1 as const;

  public constructor(private readonly application: StudioApplication) {}

  public async inspect(): Promise<AgentProjectSnapshot> {
    await this.application.start();
    await Promise.all([
      this.application.session.refresh(),
      this.application.assets.refresh(),
      this.application.git.refresh(),
      this.application.operations.refreshCache(),
    ]);
    const state = this.application.session.state.get();
    const filesByComposition = sourceFiles(this.application);
    const allFiles = [...new Set([...filesByComposition.values()].flatMap((files) => [...files]))].sort();
    const revisions = new Map<string, AgentSourceRevisionSnapshot>();
    await Promise.all(allFiles.map(async (file) => {
      const text = await this.application.runtime.readSource(file);
      revisions.set(file, { file, hash: text == null ? null : await sha256(text) });
    }));
    const revision = await sha256(allFiles.map((file) => `${file}\0${revisions.get(file)?.hash ?? "missing"}`).join("\n"));
    const cache = this.application.operations.state.get().cache;
    const bakeInputs = new Map(await Promise.all(state.compositions.map(async (composition) => [
      composition.key,
      await this.application.runtime.getCompositionBakeInputs(composition.key),
    ] as const)));
    const compositions: AgentCompositionSnapshot[] = state.compositions.map((composition) => ({
      composition,
      objects: state.timelineByComposition[composition.key] ?? [],
      animations: state.animationsByComposition[composition.key] ?? [],
      animationDiagnostics: state.animationDiagnosticsByComposition[composition.key] ?? [],
      opaqueAnimationCount: state.animationOpaqueCountByComposition[composition.key] ?? 0,
      unrollGroups: state.unrollGroupsByComposition[composition.key] ?? [],
      sources: [...(filesByComposition.get(composition.key) ?? [])].sort().map((file) => revisions.get(file) ?? { file, hash: null }),
      artifacts: cache.filter((artifact) => artifact.compId === composition.id).map((artifact) => ({
        name: artifact.name,
        ...(artifact.contentHash ? { contentHash: artifact.contentHash } : {}),
        ...(artifact.compId ? { compId: artifact.compId } : {}),
        ...(artifact.label ? { label: artifact.label } : {}),
        bytes: artifact.size,
        ...(artifact.inputs ? { inputs: artifact.inputs } : {}),
        status: artifactStatusFromInputs(
          artifact.inputs,
          new Map<string, string | null>([
            ...Object.entries(bakeInputs.get(composition.key)?.inputs ?? {}),
            ...(bakeInputs.get(composition.key)?.missing ?? []).map((input) => [input, null] as const),
          ]),
        ),
      })),
    }));
    return {
      schemaVersion: 1,
      revision,
      compositions,
      assets: this.application.assets.state.get().assets.map((asset) => ({ ...asset, availability: asset.filename ? "local" as const : "remote" as const })),
      dirtyFiles: this.application.git.state.get().dirty,
    };
  }

  public async check(snapshot?: AgentProjectSnapshot): Promise<AgentCheckResult> {
    return checkSnapshot(snapshot ?? await this.inspect());
  }

  public async snapshot(compositionKey: string, frame: number): Promise<AgentFrameSnapshot> {
    if (!this.application.runtime.captureFrame) throw new Error("This runtime does not provide exact frame snapshots.");
    return this.application.runtime.captureFrame(compositionKey, Math.round(frame));
  }

  public async execute(envelope: AgentCommandEnvelope): Promise<AgentCommandResult> {
    const before = await this.inspect();
    if (envelope.expectedRevision && envelope.expectedRevision !== before.revision) {
      const check = checkSnapshot(before);
      check.ok = false;
      check.diagnostics.unshift({
        code: "source-conflict",
        severity: "error",
        message: `The command expected ${envelope.expectedRevision}, but current source is ${before.revision}. Inspect again before editing.`,
      });
      return { ok: false, beforeRevision: before.revision, afterRevision: before.revision, message: "Project source changed since it was inspected.", check };
    }

    const historyBefore = this.application.history.state.get().undo.length;
    const dispatched = await this.dispatch(envelope.command);
    if (dispatched.ok) await this.application.session.refresh();
    const after = await this.inspect();
    const recorded = this.application.history.state.get().undo;
    const receipt = dispatched.receipt ?? (recorded.length > historyBefore ? recorded.at(-1) : undefined);
    const afterCheck = checkSnapshot(after);
    if (dispatched.conflicts?.length) {
      afterCheck.ok = false;
      afterCheck.diagnostics.unshift(...dispatched.conflicts.map((conflict) => ({
        code: "source-conflict" as const,
        severity: "error" as const,
        file: conflict.file,
        message: `${conflict.file} changed between command validation and atomic commit.`,
      })));
    }
    return {
      ok: dispatched.ok,
      beforeRevision: before.revision,
      afterRevision: after.revision,
      ...(receipt ? { receipt } : {}),
      ...(dispatched.conflicts ? { conflicts: dispatched.conflicts } : {}),
      ...(dispatched.message ? { message: dispatched.message } : {}),
      check: afterCheck,
    };
  }

  private async dispatch(command: AgentSemanticCommand): Promise<CommandDispatch> {
    const runtime = this.application.runtime;
    const session = this.application.session;
    const navigate = (compositionKey: string) => {
      if (session.state.get().currentKey !== compositionKey) session.navigate(compositionKey);
    };
    const placement = (result: PlacementEditResult): CommandDispatch => ({ ok: result.ok, receipt: result.receipt, conflicts: result.conflicts, message: result.message });
    switch (command.type) {
      case "edit-placement": {
        navigate(command.compositionKey);
        const result = await session.editTimelineItemResult(command.itemId, command.patch);
        return result.ok
          ? { ...result, message: "Placement updated through the Studio edit kernel." }
          : result;
      }
      case "edit-element": {
        navigate(command.request.compositionKey);
        session.selectElement(command.request.objectId);
        const ok = await session.editSelectedElement(command.request.patch, { groupId: command.request.groupId });
        return { ok, message: ok ? "Element properties updated through the Studio edit kernel." : session.state.get().error ?? "The element edit was refused." };
      }
      case "edit-inspector":
        navigate(command.request.compositionKey);
        session.selectItem(command.request.itemId);
        return placement(await runtime.editInspectorField(command.request));
      case "apply-grade-preset":
        navigate(command.compositionKey);
        session.selectItem(command.itemId);
        return placement(await runtime.applyGradePreset(command.compositionKey, command.itemId, command.presetId));
      case "edit-animation":
        if (!runtime.editAnimation) return { ok: false, message: "This runtime does not support registered animation editing." };
        navigate(command.request.compositionKey);
        session.selectAnimation(command.request.animationId);
        return placement(await runtime.editAnimation(command.request));
      case "edit-animations":
        if (!runtime.editAnimations) return { ok: false, message: "This runtime does not support grouped animation editing." };
        if (command.requests[0]) { navigate(command.requests[0].compositionKey); session.selectAnimation(command.requests[0].animationId); }
        return placement(await runtime.editAnimations(command.requests));
      case "create-animation":
        if (!runtime.createAnimation) return { ok: false, message: "This runtime does not support registered animation creation." };
        navigate(command.request.compositionKey);
        return placement(await runtime.createAnimation(command.request));
      case "edit-motion-path":
        if (!runtime.editMotionPath) return { ok: false, message: "This runtime does not support motion-path editing." };
        navigate(command.request.compositionKey);
        session.selectAnimation(command.request.animationId);
        return placement(await runtime.editMotionPath(command.request));
      case "create-motion-path":
        if (!runtime.createMotionPath) return { ok: false, message: "This runtime does not support motion-path creation." };
        navigate(command.request.compositionKey);
        return placement(await runtime.createMotionPath(command.request));
      case "unroll-animation-group":
        navigate(command.request.compositionKey);
        return { ok: await session.unrollAnimationGroup(command.request.groupId), message: session.state.get().error ?? session.state.get().notice ?? undefined };
      case "set-render-window":
        navigate(command.compositionKey);
        return runtime.setRenderWindow(command.compositionKey, command.from, command.to);
      case "undo": {
        const receipt = this.application.history.state.get().undo.at(-1);
        return { ok: await this.application.history.undo(), receipt, message: this.application.history.state.get().error ?? undefined };
      }
      case "redo": {
        const receipt = this.application.history.state.get().redo.at(-1);
        return { ok: await this.application.history.redo(), receipt, message: this.application.history.state.get().error ?? undefined };
      }
    }
  }
}

export interface ExposedStudioAgentApi {
  api: StudioAgentApi;
  dispose(): void;
}

/** Publish the supported browser/MCP entry point as window.__framediffAgent. */
export function exposeStudioAgentApi(application: StudioApplication, target: typeof globalThis = globalThis): ExposedStudioAgentApi {
  const api = new StudioAgentApi(application);
  const holder = target as typeof globalThis & { __framediffAgent?: StudioAgentApi };
  holder.__framediffAgent = api;
  return {
    api,
    dispose() { if (holder.__framediffAgent === api) delete holder.__framediffAgent; },
  };
}

declare global {
  interface Window { __framediffAgent?: StudioAgentApi }
}
