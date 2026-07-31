<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import {
    previewDeltaToComposition,
    motionPathToSvg,
    parseMotionPathSvg,
    type CubicMotionSegment,
    resizeRect,
    type CacheEntryDescriptor,
    type CompositionRuntimePort,
    type PreviewElementPatch,
    type PreviewHandle,
    type PreviewNodeSnapshot,
    type ResizeHandle,
    type StudioSession,
  } from "@framediff/studio-model";
  import { sessionStore } from "../viewmodels/store";
  import StageAmbience from "./StageAmbience.svelte";
  import { formatDuration } from "../design/timecode";

  export let runtime: CompositionRuntimePort;
  export let session: StudioSession;
  export let cachedArtifact: CacheEntryDescriptor | undefined = undefined;
  export let interactive = true;
  export let directManipulation = true;
  export let onselect: () => void = () => {};
  /** 0–1 render progress driving the ambient sweep, or null when nothing is rendering. */
  export let renderProgress: number | null = null;
  /** Surfaced by the shell so a failed render tints the stage instead of only the status text. */
  export let faulted = false;

  type Guide = { axis: "x" | "y"; position: number };
  type DragState = {
    node: PreviewNodeSnapshot;
    mode: "move" | "resize";
    handle?: ResizeHandle;
    clientX: number;
    clientY: number;
    patch: PreviewElementPatch;
    groupId: string;
  };

  let host: HTMLDivElement;
  let cachedVideo: HTMLVideoElement | undefined;
  let overlay: HTMLDivElement;
  let handle: PreviewHandle | undefined;
  let unsubscribeNodes: (() => void) | undefined;
  let mounted = false;
  let nodes: PreviewNodeSnapshot[] = [];
  let selected: PreviewNodeSnapshot | undefined;
  let drag: DragState | null = null;
  let guides: Guide[] = [];
  let textEditing: PreviewNodeSnapshot | null = null;
  let textDraft = "";
  let textEditor: HTMLTextAreaElement;
  type GesturePointerState = {
    pointerId: number;
    node: PreviewNodeSnapshot;
    offset: { x: number; y: number };
  };
  let gesturePointer: GesturePointerState | null = null;
  let gestureTargetMiss = false;
  let pathDraft = "";
  type PathHandle = "from" | "control1" | "control2" | "to";
  let pathDrag: { animationId: string; segment: number; handle: PathHandle; startX: number; startY: number; segments: CubicMotionSegment[] } | null = null;
  const store = sessionStore(session);

  const groupId = (): string => globalThis.crypto?.randomUUID?.() ?? `gesture-${Date.now()}-${Math.random()}`;

  /**
   * Stage readiness.
   *
   * `mountPreview` resolves and builds a composition asynchronously, and until this existed the
   * stage was an unlabelled black rectangle the entire time — indistinguishable from a broken
   * project or a legitimately dark first frame. Watching the host for its first child tells us
   * exactly when real content arrived, with no runtime API change required.
   */
  type StageStatus = "preparing" | "slow" | "ready";
  let stageStatus: StageStatus = "preparing";
  let stageObserver: MutationObserver | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | null = null;
  let mountedStageKey = "";

  function markStageReady(): void {
    if (stageStatus === "ready") return;
    stageStatus = "ready";
    if (slowTimer) clearTimeout(slowTimer);
    slowTimer = null;
  }

  function watchStage(compositionKey: string): void {
    if (!host || mountedStageKey === compositionKey) return;
    mountedStageKey = compositionKey;
    stageStatus = "preparing";
    if (slowTimer) clearTimeout(slowTimer);
    // A composition that takes this long is usually pulling media or compiling a shader. Say so
    // rather than leaving the user to guess whether anything is happening.
    slowTimer = setTimeout(() => { if (stageStatus === "preparing") stageStatus = "slow"; }, 2600);

    if (host.querySelector(".ms-stage")) return markStageReady();
    stageObserver?.disconnect();
    stageObserver = new MutationObserver(() => { if (host.querySelector(".ms-stage")) markStageReady(); });
    stageObserver.observe(host, { childList: true, subtree: true });
  }

  function attachNodeSubscription(): void {
    unsubscribeNodes?.();
    unsubscribeNodes = handle?.subscribeNodes?.((next) => { nodes = next; });
  }

  function destroyLivePreview(): void {
    unsubscribeNodes?.();
    unsubscribeNodes = undefined;
    handle?.destroy();
    handle = undefined;
    nodes = [];
  }

  function syncPreviewMode(
    cachedUrl: string | undefined,
    currentKey: string,
    frame: number,
    playing: boolean,
    gradeBypass: boolean,
  ): void {
    if (!mounted || !currentKey) return;
    if (cachedUrl) {
      if (handle) destroyLivePreview();
      return;
    }
    if (!handle) {
      handle = runtime.mountPreview(host, currentKey, { frame, playing, gradeBypass });
      attachNodeSubscription();
      return;
    }
    handle.update(currentKey, { frame, playing, gradeBypass });
  }

  function syncCachedVideo(frame: number, playing: boolean, fps: number): void {
    if (!cachedVideo) return;
    const target = Math.max(0, frame / Math.max(1, fps));
    if (cachedVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
      const last = Number.isFinite(cachedVideo.duration) ? Math.max(0, cachedVideo.duration - 0.001) : target;
      const time = Math.min(target, last);
      if (Math.abs(cachedVideo.currentTime - time) > Math.max(0.04, 1 / Math.max(1, fps))) cachedVideo.currentTime = time;
    }
    if (playing) void cachedVideo.play().catch(() => undefined);
    else cachedVideo.pause();
  }

  function beginDrag(event: PointerEvent, node: PreviewNodeSnapshot, mode: DragState["mode"], resizeHandle?: ResizeHandle): void {
    if (!interactive || !directManipulation) return;
    session.pause();
    overlay.setPointerCapture(event.pointerId);
    drag = {
      node,
      mode,
      handle: resizeHandle,
      clientX: event.clientX,
      clientY: event.clientY,
      patch: {},
      groupId: groupId(),
    };
    guides = [];
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerDown(event: PointerEvent): void {
    if (!interactive || (event.target as HTMLElement).dataset.resizeHandle || (event.target as HTMLElement).dataset.motionHandle) return;
    // Clicking out of the canvas text editor must commit it: a drag begun by this
    // pointerdown prevents the default focus change, so blur alone can't be trusted.
    if (textEditing) void commitTextEdit();
    if ($store.gestureDraft && $store.gestureDraft.status !== "preview") {
      const target = pathNode;
      const hit = handle?.hitTest?.(event.clientX, event.clientY) ?? null;
      const value = clientToComposition(event.clientX, event.clientY);
      if (!target || !value || !nodeBelongsTo(hit, target.ref.objectId)) {
        gestureTargetMiss = true;
        event.preventDefault();
        return;
      }
      gestureTargetMiss = false;
      gesturePointer = {
        pointerId: event.pointerId,
        node: target,
        offset: {
          x: value.x - target.properties.x,
          y: value.y - target.properties.y,
        },
      };
      overlay.setPointerCapture(event.pointerId);
      session.recordGesturePoint({ x: target.properties.x, y: target.properties.y });
      handle?.applyDraft?.(target.ref.objectId, { x: target.properties.x, y: target.properties.y });
      event.preventDefault();
      return;
    }
    const hit = handle?.hitTest?.(event.clientX, event.clientY) ?? null;
    // A non-movable leaf (a text node inside a moodboard card) selects and drags its
    // nearest movable ancestor; the leaf itself stays reachable via double-click.
    let movable: PreviewNodeSnapshot | undefined = hit ?? undefined;
    while (movable && !movable.movable) {
      const parentId: string | undefined = movable.parentId;
      movable = parentId ? nodes.find((node) => node.ref.objectId === parentId) : undefined;
    }
    const chosen = movable ?? hit;
    session.selectElement(chosen?.ref.objectId ?? null, chosen?.ownerItemId);
    if (chosen) onselect();
    // The first gesture may establish explicit geometry. JSON-bound nodes commit to their
    // document; remaining source-backed nodes materialize data-fd geometry as the drag commits.
    if (directManipulation && chosen) beginDrag(event, chosen, "move");
  }

  function onDoubleClick(event: MouseEvent): void {
    const hit = handle?.hitTest?.(event.clientX, event.clientY);
    if (!hit) return;
    if (hit.nestedCompositionKey) session.enterNested(hit.ownerItemId ?? hit.ref.objectId);
    else if (directManipulation && hit.text != null) {
      textEditing = hit;
      textDraft = hit.text;
      void tick().then(() => textEditor?.focus());
    }
    event.preventDefault();
  }

  async function commitTextEdit(): Promise<void> {
    const editing = textEditing;
    textEditing = null;
    if (editing && textDraft !== editing.text) {
      await session.editElementText({ compositionKey: editing.ref.compositionKey, objectId: editing.ref.objectId }, textDraft);
    }
  }

  function onTextEditorKeyDown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === "Escape") {
      textEditing = null;
      event.preventDefault();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      void commitTextEdit();
      event.preventDefault();
    }
  }

  function snapMove(node: PreviewNodeSnapshot, x: number, y: number): { x: number; y: number } {
    const threshold = 6;
    const deltaX = x - node.properties.x;
    const deltaY = y - node.properties.y;
    const movingX = [node.bounds.x + deltaX, node.bounds.x + deltaX + node.bounds.width / 2, node.bounds.x + deltaX + node.bounds.width];
    const movingY = [node.bounds.y + deltaY, node.bounds.y + deltaY + node.bounds.height / 2, node.bounds.y + deltaY + node.bounds.height];
    guides = [];
    for (const candidate of nodes) {
      if (candidate.ref.objectId === node.ref.objectId) continue;
      const targetX = [candidate.bounds.x, candidate.bounds.x + candidate.bounds.width / 2, candidate.bounds.x + candidate.bounds.width];
      const targetY = [candidate.bounds.y, candidate.bounds.y + candidate.bounds.height / 2, candidate.bounds.y + candidate.bounds.height];
      for (const moving of movingX) for (const target of targetX) {
        if (Math.abs(moving - target) <= threshold) {
          x += target - moving;
          guides.push({ axis: "x", position: candidate.previewBounds.x + candidate.previewBounds.width / 2 });
          return { x, y };
        }
      }
      for (const moving of movingY) for (const target of targetY) {
        if (Math.abs(moving - target) <= threshold) {
          y += target - moving;
          guides.push({ axis: "y", position: candidate.previewBounds.y + candidate.previewBounds.height / 2 });
          return { x, y };
        }
      }
    }
    return { x, y };
  }

  function onPointerMove(event: PointerEvent): void {
    if (gesturePointer?.pointerId === event.pointerId) {
      const value = clientToComposition(event.clientX, event.clientY);
      if (value) {
        const point = {
          x: Math.round(value.x - gesturePointer.offset.x),
          y: Math.round(value.y - gesturePointer.offset.y),
        };
        session.recordGesturePoint(point);
        handle?.applyDraft?.(gesturePointer.node.ref.objectId, point);
      }
      return;
    }
    if (pathDrag) {
      const matrix = pathNode?.compositionToPreview;
      if (!matrix) return;
      const delta = previewDeltaToComposition(matrix, { x: event.clientX - pathDrag.startX, y: event.clientY - pathDrag.startY });
      const segments = pathDrag.segments.map((segment) => ({
        from: { ...segment.from }, control1: { ...segment.control1 }, control2: { ...segment.control2 }, to: { ...segment.to },
      }));
      const segment = segments[pathDrag.segment];
      const handle = segment[pathDrag.handle];
      handle.x += delta.x;
      handle.y += delta.y;
      if (pathDrag.handle === "from") {
        segment.control1.x += delta.x; segment.control1.y += delta.y;
        if (pathDrag.segment > 0) {
          segments[pathDrag.segment - 1].to = { ...handle };
          segments[pathDrag.segment - 1].control2.x += delta.x;
          segments[pathDrag.segment - 1].control2.y += delta.y;
        }
      } else if (pathDrag.handle === "to") {
        segment.control2.x += delta.x; segment.control2.y += delta.y;
        if (pathDrag.segment < segments.length - 1) {
          segments[pathDrag.segment + 1].from = { ...handle };
          segments[pathDrag.segment + 1].control1.x += delta.x;
          segments[pathDrag.segment + 1].control1.y += delta.y;
        }
      }
      pathDraft = motionPathToSvg(segments);
      return;
    }
    if (!drag) return;
    const matrix = drag.mode === "resize" ? drag.node.localToPreview : drag.node.compositionToPreview;
    let delta = previewDeltaToComposition(matrix, { x: event.clientX - drag.clientX, y: event.clientY - drag.clientY });
    if (drag.mode === "move") {
      if (event.shiftKey) delta = Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
      let point = { x: drag.node.properties.x + delta.x, y: drag.node.properties.y + delta.y };
      if (!event.altKey) point = snapMove(drag.node, point.x, point.y);
      drag.patch = { x: Math.round(point.x), y: Math.round(point.y) };
    } else if (drag.handle) {
      const rect = resizeRect(
        {
          x: drag.node.properties.x,
          y: drag.node.properties.y,
          width: drag.node.properties.width,
          height: drag.node.properties.height,
        },
        drag.handle,
        delta,
        { minWidth: 1, minHeight: 1, lockAspect: event.shiftKey },
      );
      drag.patch = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }
    handle?.applyDraft?.(drag.node.ref.objectId, drag.patch);
  }

  async function finishDrag(event: PointerEvent, cancel = false): Promise<void> {
    if (gesturePointer?.pointerId === event.pointerId) {
      const completed = gesturePointer;
      gesturePointer = null;
      if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
      if (cancel) {
        handle?.clearDraft?.(completed.node.ref.objectId);
        session.cancelGesture();
      } else {
        session.previewGesture();
      }
      return;
    }
    if (pathDrag) {
      const completed = pathDrag;
      pathDrag = null;
      if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
      const nextPath = pathDraft;
      pathDraft = "";
      if (!cancel && nextPath) await session.editMotionPath(completed.animationId, nextPath, { label: `Edit ${completed.animationId} Bézier handle` });
      return;
    }
    if (!drag) return;
    const completed = drag;
    drag = null;
    guides = [];
    if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
    handle?.clearDraft?.(completed.node.ref.objectId);
    if (!cancel && Object.keys(completed.patch).length) {
      await session.editSelectedElement(completed.patch, {
        groupId: completed.groupId,
        label: completed.mode === "move" ? `Move ${completed.node.label}` : `Resize ${completed.node.label}`,
      });
    }
  }

  function clientToComposition(clientX: number, clientY: number): { x: number; y: number } | null {
    const matrix = nodes[0]?.compositionToPreview;
    if (!matrix) return null;
    const hostBounds = overlay.getBoundingClientRect();
    return previewDeltaToComposition(matrix, { x: clientX - hostBounds.left - matrix.e, y: clientY - hostBounds.top - matrix.f });
  }

  function nodeBelongsTo(node: PreviewNodeSnapshot | null, objectId: string): boolean {
    let current = node ?? undefined;
    while (current) {
      if (current.ref.objectId === objectId) return true;
      const parentId = current.parentId;
      current = parentId ? nodes.find((candidate) => candidate.ref.objectId === parentId) : undefined;
    }
    return false;
  }

  function cancelGesture(): void {
    const objectId = $store.gestureDraft?.objectId;
    gesturePointer = null;
    gestureTargetMiss = false;
    if (objectId) handle?.clearDraft?.(objectId);
    session.cancelGesture();
  }

  function recordGestureAgain(): void {
    const draft = $store.gestureDraft;
    if (!draft) return;
    handle?.clearDraft?.(draft.objectId);
    gestureTargetMiss = false;
    session.armGesture(draft.objectId, draft.animationId);
  }

  async function commitGesture(): Promise<void> {
    const objectId = $store.gestureDraft?.objectId;
    if (await session.commitGesture()) {
      if (objectId) handle?.clearDraft?.(objectId);
      gestureTargetMiss = false;
    }
  }

  function beginPathDrag(event: PointerEvent, segment: number, handle: PathHandle): void {
    if (!directManipulation || !selectedAnimation?.editable || !selectedAnimation.motionPath || !pathSegments) return;
    event.preventDefault();
    event.stopPropagation();
    overlay.setPointerCapture(event.pointerId);
    pathDrag = {
      animationId: selectedAnimation.id,
      segment,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      segments: pathSegments.map((entry) => ({ from: { ...entry.from }, control1: { ...entry.control1 }, control2: { ...entry.control2 }, to: { ...entry.to } })),
    };
  }

  function nudgePathHandle(event: KeyboardEvent, segmentIndex: number, handle: PathHandle): void {
    if (!directManipulation || !selectedAnimation?.motionPath || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    const segments = selectedAnimation.motionPath.segments.map((segment) => ({ from: { ...segment.from }, control1: { ...segment.control1 }, control2: { ...segment.control2 }, to: { ...segment.to } }));
    segments[segmentIndex][handle].x += event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
    segments[segmentIndex][handle].y += event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
    void session.editMotionPath(selectedAnimation.id, motionPathToSvg(segments), { label: `Nudge ${selectedAnimation.id} ${handle}` });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (textEditing) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
    if (event.key === "Escape" && $store.gestureDraft) {
      const pointer = gesturePointer;
      gesturePointer = null;
      if (pointer && overlay?.hasPointerCapture(pointer.pointerId)) overlay.releasePointerCapture(pointer.pointerId);
      cancelGesture();
      event.preventDefault();
      return;
    }
    if (!interactive || !directManipulation || !selected || event.defaultPrevented) return;
    if (event.key === "Escape" && drag) {
      handle?.clearDraft?.(drag.node.ref.objectId);
      drag = null;
      guides = [];
      event.preventDefault();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const amount = event.shiftKey ? 10 : 1;
    const patch = {
      x: selected.properties.x + (event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0),
      y: selected.properties.y + (event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0),
    };
    event.preventDefault();
    void session.editSelectedElement(patch, { label: `Nudge ${selected.label}` });
  }

  onMount(() => {
    mounted = true;
    syncPreviewMode(cachedUrl, $store.currentKey, $store.frame, $store.playing, $store.gradeBypass);
  });

  onDestroy(() => {
    mounted = false;
    destroyLivePreview();
    stageObserver?.disconnect();
    stageObserver = null;
    if (slowTimer) clearTimeout(slowTimer);
    slowTimer = null;
  });

  // A momentary grade bypass needs the source layers; normal playback stays entirely on the bake.
  $: cachedUrl = cachedArtifact && !$store.gradeBypass
    ? `/__framediff-cache/${encodeURIComponent(cachedArtifact.contentHash ?? cachedArtifact.name)}`
    : undefined;
  $: currentComposition = $store.compositions.find((composition) => composition.key === $store.currentKey);
  $: syncPreviewMode(cachedUrl, $store.currentKey, $store.frame, $store.playing, $store.gradeBypass);
  $: syncCachedVideo($store.frame, $store.playing, currentComposition?.fps ?? 24);
  $: selectedAnimation = $store.selection?.kind === "animation"
    ? ($store.animationsByComposition[$store.currentKey] ?? []).find((animation) => animation.id === $store.selection?.objectId)
    : undefined;
  $: animationObjectId = selectedAnimation?.target.match(/data-fd-id=(?:"([^"]+)"|'([^']+)')/)?.slice(1).find(Boolean);
  $: selected = $store.selection?.kind === "element"
    ? nodes.find((node) => node.ref.compositionKey === $store.selection?.compositionKey && node.ref.objectId === $store.selection?.objectId)
    : animationObjectId
      ? nodes.find((node) => node.ref.objectId === animationObjectId)
      : undefined;
  $: pathSource = pathDraft || $store.gestureDraft?.path || ($store.gestureDraft ? "" : selectedAnimation?.motionPath?.path) || "";
  $: pathSegments = pathSource ? parseMotionPathSvg(pathSource) : null;
  $: pathObjectId = $store.gestureDraft?.objectId ?? animationObjectId;
  $: pathNode = pathObjectId ? nodes.find((node) => node.ref.objectId === pathObjectId) : undefined;
  $: gestureSamples = $store.gestureDraft?.samples ?? [];

  // A cached artifact paints immediately; only a live mount has a stage to wait on.
  $: if (mounted && !cachedUrl && $store.currentKey) watchStage($store.currentKey);
  $: if (cachedUrl) markStageReady();
  $: stageBusy = !cachedUrl && stageStatus !== "ready";
  $: compositionDuration = currentComposition
    ? formatDuration(
        (currentComposition.render ? currentComposition.render.to - currentComposition.render.from : currentComposition.durationInFrames),
        currentComposition.fps ?? 24,
      )
    : "";
  // The stage doubles as an ambient status light: calm at rest, livelier under playback, amber
  // while a render sweeps across it, desaturated red on a fault.
  $: ambienceEnergy = faulted ? 0.3 : renderProgress != null ? 0.9 : $store.playing ? 0.55 : stageBusy ? 0.7 : 0.18;
  $: ambienceHue = renderProgress != null
    ? 0.02
    : $store.playing && currentComposition
      ? ($store.frame / Math.max(1, currentComposition.durationInFrames)) * 0.3
      : 0.12;
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="preview-surface">
  <StageAmbience energy={ambienceEnergy} hue={ambienceHue} progress={renderProgress} fault={faulted ? 1 : 0} />
  <div class="preview-host" aria-label="Composition preview">
    <div class="preview-runtime-host" class:cached={!!cachedUrl} class:settling={stageBusy} bind:this={host}></div>

    {#if stageBusy}
      <!-- Standing in for the composition at its real aspect ratio, so the frame never jumps
           into existence at a different size than the placeholder that preceded it. -->
      <div
        class="stage-placeholder"
        role="status"
        aria-live="polite"
        style={currentComposition ? `aspect-ratio:${currentComposition.width} / ${currentComposition.height}` : ""}
      >
        <div class="stage-shimmer"></div>
        <div class="stage-placeholder-body">
          <span class="stage-spinner" aria-hidden="true"></span>
          <strong>{stageStatus === "slow" ? "Still building this composition" : "Building the composition"}</strong>
          <small>
            {#if stageStatus === "slow"}
              Large media and shaders resolve on first open — this is cached from here on.
            {:else if currentComposition}
              {currentComposition.width}×{currentComposition.height} · {compositionDuration} · {currentComposition.fps ?? 24}fps
            {:else}
              Reading the composition registry…
            {/if}
          </small>
        </div>
      </div>
    {/if}
    {#if cachedUrl}
      <div class="cached-composition-frame">
        {#if currentComposition?.outputKind === "image"}
          <img class="cached-composition-preview" src={cachedUrl} alt="" />
        {:else}
          <video
            class="cached-composition-preview"
            bind:this={cachedVideo}
            src={cachedUrl}
            muted
            playsinline
            preload="auto"
            onloadedmetadata={() => syncCachedVideo($store.frame, $store.playing, currentComposition?.fps ?? 24)}
          ></video>
        {/if}
      </div>
    {/if}
  </div>
  {#if interactive && !cachedUrl}
    <div
      class="canvas-overlay"
      class:dragging={!!drag}
      class:gesture-active={$store.gestureDraft?.status === "armed" || $store.gestureDraft?.status === "recording"}
      class:gesture-preview={$store.gestureDraft?.status === "preview"}
      class:animation-selection={!!selectedAnimation}
      bind:this={overlay}
      aria-label="Canvas selection and direct manipulation"
      role="application"
      onpointerdown={onPointerDown}
      ondblclick={onDoubleClick}
      onpointermove={onPointerMove}
      onpointerup={(event) => void finishDrag(event)}
      onpointercancel={(event) => void finishDrag(event, true)}
    >
      {#each guides as guide}
        <span class="snap-guide {guide.axis}" style={guide.axis === "x" ? `left:${guide.position}px` : `top:${guide.position}px`}></span>
      {/each}
      {#if $store.gestureDraft}
        <div class="gesture-mode-hud {$store.gestureDraft.status}" class:target-miss={gestureTargetMiss} role="status" aria-live="polite" onpointerdown={(event) => event.stopPropagation()}>
          <span class="gesture-status-dot"></span>
          <div>
            <strong>{$store.gestureDraft.status === "armed" ? `Grab ${pathNode?.label ?? $store.gestureDraft.objectId} to record` : $store.gestureDraft.status === "recording" ? `Recording ${pathNode?.label ?? "move"}` : $store.error ? "Couldn’t save this take" : $store.gestureDraft.path ? "Take ready to review" : "Move was too short"}</strong>
            <small>
              {$store.gestureDraft.status === "armed"
                ? gestureTargetMiss
                  ? `Start the take by dragging ${pathNode?.label ?? "the selected object"} — clicks elsewhere are ignored`
                  : `Playback starts when you drag the selected object · starts at ${$store.gestureDraft.startFrame}f`
                : $store.gestureDraft.status === "recording"
                  ? `${$store.gestureDraft.samples.length} frames captured · release to finish the take`
                  : $store.error
                    ? $store.error
                    : $store.gestureDraft.path
                    ? `${$store.gestureDraft.samples.length} frames · save, record again, or cancel`
                    : "Hold and move the object for at least two frames, then release"}
            </small>
          </div>
          {#if $store.gestureDraft.status === "preview"}
            <div class="gesture-mode-actions">
              <button class="save" disabled={!$store.gestureDraft.path} onclick={() => void commitGesture()}>{$store.error ? "Try save again" : "Save move"}</button>
              <button onclick={recordGestureAgain}>Record again</button>
              <button onclick={cancelGesture}>Cancel</button>
            </div>
          {:else}
            <kbd>ESC</kbd>
          {/if}
        </div>
      {:else if selectedAnimation?.motionPath}
        <div class="canvas-context-hud motion">
          <strong>EDIT ROUTE</strong><span>solid stops set positions · hollow handles shape the curve · scrub to inspect timing</span>
        </div>
      {:else if selected && directManipulation}
        <div class="canvas-context-hud">
          <strong>CANVAS</strong><span>drag to move · handles resize · ⇧ constrain · ⌥ bypass snap</span>
        </div>
      {/if}
      {#if (pathSegments?.length || gestureSamples.length > 1) && (pathNode || nodes[0])}
        {@const matrix = (pathNode ?? nodes[0]).compositionToPreview}
        <svg class="motion-path-overlay" aria-label="Editable motion path">
          <g transform={`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`}>
            {#if gestureSamples.length > 1}
              <polyline class="motion-gesture-trace" points={gestureSamples.map((sample) => `${sample.x},${sample.y}`).join(" ")}></polyline>
            {/if}
            {#if pathSegments?.length}
              <path class="motion-path-line" d={motionPathToSvg(pathSegments)}></path>
              {#each pathSegments as segment, index (`${index}:${segment.from.x}:${segment.to.x}`)}
                <path class="motion-tangent" d={`M${segment.from.x},${segment.from.y} L${segment.control1.x},${segment.control1.y} M${segment.to.x},${segment.to.y} L${segment.control2.x},${segment.control2.y}`}></path>
                <circle role="button" tabindex="0" aria-label={`Control 1 for path segment ${index + 1}`} data-motion-handle="control1" class="motion-handle tangent" cx={segment.control1.x} cy={segment.control1.y} r="7" onpointerdown={(event) => beginPathDrag(event, index, "control1")} onkeydown={(event) => nudgePathHandle(event, index, "control1")}></circle>
                <circle role="button" tabindex="0" aria-label={`Control 2 for path segment ${index + 1}`} data-motion-handle="control2" class="motion-handle tangent" cx={segment.control2.x} cy={segment.control2.y} r="7" onpointerdown={(event) => beginPathDrag(event, index, "control2")} onkeydown={(event) => nudgePathHandle(event, index, "control2")}></circle>
                <circle role="button" tabindex="0" aria-label={`Start anchor for path segment ${index + 1}`} data-motion-handle="from" class="motion-handle anchor" cx={segment.from.x} cy={segment.from.y} r="8" onpointerdown={(event) => beginPathDrag(event, index, "from")} onkeydown={(event) => nudgePathHandle(event, index, "from")}></circle>
                {#if index === pathSegments.length - 1}<circle role="button" tabindex="0" aria-label="End anchor for motion path" data-motion-handle="to" class="motion-handle anchor" cx={segment.to.x} cy={segment.to.y} r="8" onpointerdown={(event) => beginPathDrag(event, index, "to")} onkeydown={(event) => nudgePathHandle(event, index, "to")}></circle>{/if}
              {/each}
            {/if}
            {#if gestureSamples.length}
              {@const firstSample = gestureSamples[0]}
              {@const lastSample = gestureSamples[gestureSamples.length - 1]}
              <circle class="motion-take-point start" cx={firstSample.x} cy={firstSample.y} r="10"></circle>
              <circle class="motion-take-point end" cx={lastSample.x} cy={lastSample.y} r="10"></circle>
            {/if}
          </g>
        </svg>
      {/if}
      {#if selected}
        <div
          class="canvas-selection"
          class:editable={selected.movable && selected.resizable}
          style={`left:${selected.previewBounds.x}px;top:${selected.previewBounds.y}px;width:${selected.previewBounds.width}px;height:${selected.previewBounds.height}px;transform:rotate(${selected.properties.rotation}deg)`}
          aria-label={`Selected ${selected.label}`}
        >
          <span class="selection-label" class:motion={!!selectedAnimation || !!$store.gestureDraft}>{$store.gestureDraft?.status === "preview" ? `TAKE · ${selected.label}` : $store.gestureDraft ? `RECORD · ${selected.label}` : selectedAnimation ? `MOTION · ${selected.label}` : selected.label}</span>
          {#if directManipulation && !selectedAnimation && !$store.gestureDraft}
            {#each ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as resizeHandle}
              <button
                class="resize-handle {resizeHandle}"
                data-resize-handle={resizeHandle}
                aria-label={`Resize ${resizeHandle}`}
                onpointerdown={(event) => beginDrag(event, selected!, "resize", resizeHandle as ResizeHandle)}
              ></button>
            {/each}
          {/if}
        </div>
      {/if}
      {#if directManipulation && textEditing}
        <textarea
          class="canvas-text-editor"
          bind:this={textEditor}
          bind:value={textDraft}
          aria-label={`Edit ${textEditing.label} text`}
          style={`left:${textEditing.previewBounds.x}px;top:${textEditing.previewBounds.y}px;width:${Math.max(120, textEditing.previewBounds.width)}px;height:${Math.max(42, textEditing.previewBounds.height)}px;transform:rotate(${textEditing.properties.rotation}deg)`}
          onpointerdown={(event) => event.stopPropagation()}
          onkeydown={onTextEditorKeyDown}
          onblur={() => void commitTextEdit()}
        ></textarea>
      {/if}
    </div>
  {/if}
</div>
