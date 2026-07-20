<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import {
    previewDeltaToComposition,
    motionPathToSvg,
    parseMotionPathSvg,
    type CubicMotionSegment,
    resizeRect,
    type CompositionRuntimePort,
    type PreviewElementPatch,
    type PreviewHandle,
    type PreviewNodeSnapshot,
    type ResizeHandle,
    type StudioSession,
  } from "@framediff/studio-model";
  import { sessionStore } from "../viewmodels/store";

  export let runtime: CompositionRuntimePort;
  export let session: StudioSession;
  export let interactive = true;
  export let onselect: () => void = () => {};

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
  let overlay: HTMLDivElement;
  let handle: PreviewHandle | undefined;
  let unsubscribeNodes: (() => void) | undefined;
  let nodes: PreviewNodeSnapshot[] = [];
  let selected: PreviewNodeSnapshot | undefined;
  let drag: DragState | null = null;
  let guides: Guide[] = [];
  let textEditing: PreviewNodeSnapshot | null = null;
  let textDraft = "";
  let textEditor: HTMLTextAreaElement;
  let gesturePointer: number | null = null;
  let pathDraft = "";
  type PathHandle = "from" | "control1" | "control2" | "to";
  let pathDrag: { animationId: string; segment: number; handle: PathHandle; startX: number; startY: number; segments: CubicMotionSegment[] } | null = null;
  const store = sessionStore(session);

  const groupId = (): string => globalThis.crypto?.randomUUID?.() ?? `gesture-${Date.now()}-${Math.random()}`;

  function updatePreview(currentKey: string, frame: number, playing: boolean, gradeBypass: boolean): void {
    if (!handle || !currentKey) return;
    handle.update(currentKey, { frame, playing, gradeBypass });
  }

  function attachNodeSubscription(): void {
    unsubscribeNodes?.();
    unsubscribeNodes = handle?.subscribeNodes?.((next) => { nodes = next; });
  }

  function beginDrag(event: PointerEvent, node: PreviewNodeSnapshot, mode: DragState["mode"], resizeHandle?: ResizeHandle): void {
    if (!interactive || (mode === "move" && !node.movable) || (mode === "resize" && !node.resizable)) return;
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
      const value = clientToComposition(event.clientX, event.clientY);
      if (!value) return;
      gesturePointer = event.pointerId;
      overlay.setPointerCapture(event.pointerId);
      session.recordGesturePoint(value);
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
    if (chosen?.movable) beginDrag(event, chosen, "move");
  }

  function onDoubleClick(event: MouseEvent): void {
    const hit = handle?.hitTest?.(event.clientX, event.clientY);
    if (!hit) return;
    if (hit.nestedCompositionKey) session.enterNested(hit.ownerItemId ?? hit.ref.objectId);
    else if (hit.text != null) {
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
    if (gesturePointer === event.pointerId) {
      const value = clientToComposition(event.clientX, event.clientY);
      if (value) session.recordGesturePoint(value);
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
    if (gesturePointer === event.pointerId) {
      gesturePointer = null;
      if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
      session.previewGesture();
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

  function beginPathDrag(event: PointerEvent, segment: number, handle: PathHandle): void {
    if (!selectedAnimation?.editable || !selectedAnimation.motionPath || !pathSegments) return;
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
    if (!selectedAnimation?.motionPath || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    const segments = selectedAnimation.motionPath.segments.map((segment) => ({ from: { ...segment.from }, control1: { ...segment.control1 }, control2: { ...segment.control2 }, to: { ...segment.to } }));
    segments[segmentIndex][handle].x += event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
    segments[segmentIndex][handle].y += event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
    void session.editMotionPath(selectedAnimation.id, motionPathToSvg(segments), { label: `Nudge ${selectedAnimation.id} ${handle}` });
  }

  async function makeMovable(): Promise<void> {
    if (!selected) return;
    await session.editSelectedElement({
      x: selected.properties.x,
      y: selected.properties.y,
      width: Math.max(1, Math.round(selected.properties.width)),
      height: Math.max(1, Math.round(selected.properties.height)),
    }, { label: `Make ${selected.label} movable` });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (textEditing) return;
    if (!interactive || !selected || event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
    if (event.key === "Escape" && drag) {
      handle?.clearDraft?.(drag.node.ref.objectId);
      drag = null;
      guides = [];
      return;
    }
    if (!selected.movable || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const amount = event.shiftKey ? 10 : 1;
    const patch = {
      x: selected.properties.x + (event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0),
      y: selected.properties.y + (event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0),
    };
    event.preventDefault();
    void session.editSelectedElement(patch, { label: `Nudge ${selected.label}` });
  }

  onMount(() => {
    if (!$store.currentKey) return;
    handle = runtime.mountPreview(host, $store.currentKey, {
      frame: $store.frame,
      playing: $store.playing,
      gradeBypass: $store.gradeBypass,
    });
    attachNodeSubscription();
  });

  onDestroy(() => {
    unsubscribeNodes?.();
    handle?.destroy();
  });

  $: updatePreview($store.currentKey, $store.frame, $store.playing, $store.gradeBypass);
  $: selected = $store.selection?.kind === "element"
    ? nodes.find((node) => node.ref.compositionKey === $store.selection?.compositionKey && node.ref.objectId === $store.selection?.objectId)
    : undefined;
  $: selectedAnimation = $store.selection?.kind === "animation"
    ? ($store.animationsByComposition[$store.currentKey] ?? []).find((animation) => animation.id === $store.selection?.objectId)
    : undefined;
  $: pathSource = pathDraft || $store.gestureDraft?.path || selectedAnimation?.motionPath?.path || "";
  $: pathSegments = pathSource ? parseMotionPathSvg(pathSource) : null;
  $: pathObjectId = $store.gestureDraft?.objectId ?? selectedAnimation?.target.match(/data-fd-id=(?:"([^"]+)"|'([^']+)')/)?.slice(1).find(Boolean);
  $: pathNode = pathObjectId ? nodes.find((node) => node.ref.objectId === pathObjectId) : undefined;
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="preview-surface">
  <div class="preview-host" bind:this={host} aria-label="Composition preview"></div>
  {#if interactive}
    <div
      class="canvas-overlay"
      class:dragging={!!drag}
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
      {#if pathSegments?.length && (pathNode || nodes[0])}
        {@const matrix = (pathNode ?? nodes[0]).compositionToPreview}
        <svg class="motion-path-overlay" aria-label="Editable motion path">
          <g transform={`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`}>
            <path class="motion-path-line" d={motionPathToSvg(pathSegments)}></path>
            {#each pathSegments as segment, index (`${index}:${segment.from.x}:${segment.to.x}`)}
              <path class="motion-tangent" d={`M${segment.from.x},${segment.from.y} L${segment.control1.x},${segment.control1.y} M${segment.to.x},${segment.to.y} L${segment.control2.x},${segment.control2.y}`}></path>
              <circle role="button" tabindex="0" aria-label={`Control 1 for path segment ${index + 1}`} data-motion-handle="control1" class="motion-handle tangent" cx={segment.control1.x} cy={segment.control1.y} r="7" onpointerdown={(event) => beginPathDrag(event, index, "control1")} onkeydown={(event) => nudgePathHandle(event, index, "control1")}></circle>
              <circle role="button" tabindex="0" aria-label={`Control 2 for path segment ${index + 1}`} data-motion-handle="control2" class="motion-handle tangent" cx={segment.control2.x} cy={segment.control2.y} r="7" onpointerdown={(event) => beginPathDrag(event, index, "control2")} onkeydown={(event) => nudgePathHandle(event, index, "control2")}></circle>
              <circle role="button" tabindex="0" aria-label={`Start anchor for path segment ${index + 1}`} data-motion-handle="from" class="motion-handle anchor" cx={segment.from.x} cy={segment.from.y} r="8" onpointerdown={(event) => beginPathDrag(event, index, "from")} onkeydown={(event) => nudgePathHandle(event, index, "from")}></circle>
              {#if index === pathSegments.length - 1}<circle role="button" tabindex="0" aria-label="End anchor for motion path" data-motion-handle="to" class="motion-handle anchor" cx={segment.to.x} cy={segment.to.y} r="8" onpointerdown={(event) => beginPathDrag(event, index, "to")} onkeydown={(event) => nudgePathHandle(event, index, "to")}></circle>{/if}
            {/each}
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
          <span class="selection-label">{selected.label}</span>
          {#if selected.resizable}
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
        {#if !selected.movable || !selected.resizable}
          <button class="make-movable" onpointerdown={(event) => event.stopPropagation()} onclick={() => void makeMovable()}>Make movable · source-backed</button>
        {/if}
      {/if}
      {#if textEditing}
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
