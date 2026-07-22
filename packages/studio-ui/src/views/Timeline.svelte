<script lang="ts">
  import { tick } from "svelte";
  import { timelineItemLabel, type TimelineItemSnapshot, type TimelineLaneSnapshot } from "@framediff/studio-model";
  import type { TimelineViewModel } from "../viewmodels/Timeline.ViewModel";

  export let viewModel: TimelineViewModel;
  export let onselect: () => void = () => {};
  export let acceptCompositionDrop = false;
  export let oncompositiondrop: (compositionKey: string, from: number) => void = () => {};
  const store = viewModel.store;

  const LABEL_W = 54;
  const MAX_PPF = 40;

  let scroller: HTMLElement | null = null;
  let viewportW = 0;
  let userPpf = 0; // 0 = fit-to-width
  let restoredZoomFor = "";
  let compositionDropFrame: number | null = null;
  const COMP_DRAG_MIME = "application/x-framediff-comp";

  $: duration = Math.max(1, $store.durationInFrames);
  $: pad = Math.max($store.fps, Math.round(duration * 0.15));

  // The axis is open-ended: it always covers every clip (wherever it was staged),
  // the render window, and the comp itself, plus breathing room — and it grows as
  // things are dragged outward. Bounds follow committed state so they stay stable
  // mid-gesture.
  $: clipBounds = (() => {
    let min = 0;
    let max = duration;
    for (const lane of $store.lanes) {
      for (const item of lane.items) {
        const length = Number.isFinite(item.durationInFrames) ? item.durationInFrames : Math.max(1, duration - item.from);
        min = Math.min(min, item.from);
        max = Math.max(max, item.from + length);
      }
    }
    for (const animation of $store.animations) {
      min = Math.min(min, animation.startFrame);
      max = Math.max(max, animation.startFrame + animation.durationInFrames);
    }
    for (const group of $store.unrollGroups) for (const operation of group.operations) {
      min = Math.min(min, operation.startFrame);
      max = Math.max(max, operation.startFrame + operation.durationInFrames);
    }
    return { min, max };
  })();
  $: axisStart = Math.min(clipBounds.min, $store.render.from) - pad;
  $: axisEnd = Math.max(clipBounds.max, $store.render.to) + pad;
  $: axisLen = Math.max(1, axisEnd - axisStart);
  $: fitPpf = Math.max(0.02, (Math.max(0, viewportW - LABEL_W) - 8) / axisLen);
  $: ppf = userPpf > 0 ? Math.min(MAX_PPF, Math.max(fitPpf, userPpf)) : fitPpf;
  $: zoomKey = `framediff:timeline-zoom:${$store.currentKey}`;
  $: if ($store.currentKey && $store.currentKey !== restoredZoomFor) {
    restoredZoomFor = $store.currentKey;
    try {
      userPpf = Number(sessionStorage.getItem(zoomKey)) || 0;
    } catch {
      userPpf = 0;
    }
  }

  const time = (frame: number) => `${(frame / Math.max(1, $store.fps)).toFixed(1)}s`;

  function isCompositionDrag(event: DragEvent): boolean {
    return acceptCompositionDrop && (event.dataTransfer?.types.includes(COMP_DRAG_MIME) ?? false);
  }

  function frameAtDrop(event: DragEvent): number {
    if (!scroller) return $store.frame;
    const rect = scroller.getBoundingClientRect();
    const contentX = event.clientX - rect.left + scroller.scrollLeft - LABEL_W;
    return Math.round(axisStart + contentX / Math.max(0.0001, ppf));
  }

  function dragCompositionOver(event: DragEvent): void {
    if (!isCompositionDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    compositionDropFrame = frameAtDrop(event);
  }

  function dragCompositionLeave(event: DragEvent): void {
    if (event.relatedTarget instanceof Node && event.currentTarget instanceof HTMLElement && event.currentTarget.contains(event.relatedTarget)) return;
    compositionDropFrame = null;
  }

  function dropComposition(event: DragEvent): void {
    if (!isCompositionDrag(event)) return;
    event.preventDefault();
    const sourceKey = event.dataTransfer?.getData(COMP_DRAG_MIME);
    const from = frameAtDrop(event);
    compositionDropFrame = null;
    if (sourceKey) oncompositiondrop(sourceKey, from);
  }
  const animationKeys = (animation: (typeof $store.animations)[number]) => {
    const byFrame = new Map<number, string[]>();
    for (const [property, binding] of Object.entries(animation.bindings)) {
      if (binding.kind !== "keyframes") continue;
      for (const key of binding.keys) byFrame.set(key.frame, [...(byFrame.get(key.frame) ?? []), property]);
    }
    return [...byFrame].sort(([left], [right]) => left - right).map(([frame, properties]) => ({ frame, properties }));
  };

  type AnimationKeyDrag = { animationId: string; properties: string[]; frame: number; toFrame: number; startX: number; moved: boolean };
  let animationKeyDrag: AnimationKeyDrag | null = null;
  function beginAnimationKeyDrag(event: PointerEvent, animationId: string, properties: string[], frame: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    viewModel.selectAnimation(animationId);
    onselect();
    viewModel.seek(frame);
    animationKeyDrag = { animationId, properties, frame, toFrame: frame, startX: event.clientX, moved: false };
    window.addEventListener("pointermove", moveAnimationKeyDrag);
    window.addEventListener("pointerup", finishAnimationKeyDrag, { once: true });
    window.addEventListener("pointercancel", finishAnimationKeyDrag, { once: true });
  }
  function moveAnimationKeyDrag(event: PointerEvent): void {
    if (!animationKeyDrag) return;
    const toFrame = Math.round(animationKeyDrag.frame + (event.clientX - animationKeyDrag.startX) / ppf);
    const moved = animationKeyDrag.moved || Math.abs(event.clientX - animationKeyDrag.startX) > 2;
    animationKeyDrag = { ...animationKeyDrag, toFrame, moved };
    if (moved) viewModel.seek(toFrame);
  }
  function finishAnimationKeyDrag(): void {
    window.removeEventListener("pointermove", moveAnimationKeyDrag);
    window.removeEventListener("pointercancel", finishAnimationKeyDrag);
    const finished = animationKeyDrag;
    animationKeyDrag = null;
    if (finished?.moved && finished.toFrame !== finished.frame) {
      void viewModel.moveAnimationKeys(finished.animationId, finished.properties, finished.frame, finished.toFrame);
    }
  }

  // --- the render window (work-area) ---
  type ZoneMode = "move" | "left" | "right";
  type ZoneDragState = {
    mode: ZoneMode;
    startX: number;
    f0: number;
    t0: number;
    from: number;
    to: number;
    moved: boolean;
    clientX: number;
    clientY: number;
    snapped: number | null;
  };
  let zoneDrag: ZoneDragState | null = null;

  // live window: the in-flight drag wins over the committed value
  $: rw = zoneDrag ? { from: zoneDrag.from, to: zoneDrag.to } : $store.render;

  // Ruler ticks read OUTPUT time: 0 sits at the render window's start, negatives run
  // through the pre-roll staging, and numbering continues past the window's end.
  $: tickStep = (() => {
    const fps = Math.max(1, $store.fps);
    const steps = [1, 2, 5, 10, Math.max(1, Math.round(fps / 2)), fps, fps * 2, fps * 5, fps * 10, fps * 30, fps * 60];
    return steps.find((step) => step * ppf >= 64) ?? fps * 120;
  })();
  $: relTicks = (() => {
    const relStart = Math.ceil((axisStart - rw.from) / tickStep) * tickStep;
    const relEnd = Math.floor((axisEnd - rw.from) / tickStep) * tickStep;
    const list: number[] = [];
    for (let rel = relStart; rel <= relEnd; rel += tickStep) list.push(rel);
    const windowEnd = rw.to - rw.from;
    if (!list.includes(windowEnd)) list.push(windowEnd);
    return list;
  })();
  const tickLabel = (rel: number) => {
    const abs = Math.abs(rel);
    const fps = Math.max(1, $store.fps);
    const text = abs < fps ? `${abs}f` : `${(abs / fps).toFixed(abs % fps ? 1 : 0)}s`;
    return rel < 0 ? `-${text}` : text;
  };

  function setZoom(next: number, centerClientX?: number): void {
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const anchorX = centerClientX ?? rect.left + LABEL_W + (rect.width - LABEL_W) / 2;
    const frameAt = (scroller.scrollLeft + anchorX - rect.left - LABEL_W) / ppf + axisStart;
    userPpf = Math.min(MAX_PPF, Math.max(fitPpf, next));
    try {
      sessionStorage.setItem(zoomKey, String(userPpf));
    } catch {
      // best effort
    }
    void tick().then(() => {
      if (scroller) scroller.scrollLeft = (frameAt - axisStart) * ppf + LABEL_W - (anchorX - rect.left);
    });
  }
  function zoomFit(): void {
    userPpf = 0;
    try {
      sessionStorage.removeItem(zoomKey);
    } catch {
      // best effort
    }
  }
  function onWheel(event: WheelEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return; // plain wheel pans/scrolls natively
    event.preventDefault();
    setZoom(ppf * Math.exp(-event.deltaY * 0.002), event.clientX);
  }

  // --- scrubbing (the timeline is the one scrub surface) ---
  let scrubbing = false;
  function seekFromPointer(event: PointerEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const frame = (event.clientX - rect.left) / ppf + axisStart;
    // the playable domain covers the render window too (incl. a negative pre-roll)
    const lo = Math.min(0, $store.render.from);
    const hi = Math.max(duration, $store.render.to);
    viewModel.seek(Math.max(lo, Math.min(hi - 1, frame)));
  }
  function beginScrub(event: PointerEvent): void {
    if (event.button !== 0) return;
    scrubbing = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    seekFromPointer(event);
  }
  function moveScrub(event: PointerEvent): void {
    if (scrubbing) seekFromPointer(event);
  }
  function endScrub(event: PointerEvent): void {
    scrubbing = false;
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  }

  // --- clip move / trim with magnetic snapping ---
  type DragMode = "move" | "trim-left" | "trim-right";
  type DragState = {
    itemId: string;
    mode: DragMode;
    startX: number;
    startY: number;
    originalFrom: number;
    originalDuration: number;
    from: number;
    duration: number;
    moved: boolean;
    clientX: number;
    clientY: number;
    snapped: number | null;
    originalLayer: number;
    layer: number;
    originalLaneId: string;
    targetLaneId: string;
    laneKind: TimelineLaneSnapshot["kind"];
  };
  let drag: DragState | null = null;

  const finiteDuration = (item: TimelineItemSnapshot) =>
    Number.isFinite(item.durationInFrames) ? item.durationInFrames : Math.max(1, duration - item.from);

  function snapTargets(excludeId: string): number[] {
    const targets = [0, duration, Math.round($store.frame), $store.render.from, $store.render.to];
    for (const lane of $store.lanes) {
      for (const item of lane.items) {
        if (item.id === excludeId) continue;
        targets.push(item.from, item.from + finiteDuration(item));
      }
    }
    return targets;
  }
  function applySnap(value: number, targets: number[], threshold: number): { value: number; snapped: number | null } {
    let best: number | null = null;
    let bestDistance = threshold;
    for (const target of targets) {
      const distance = Math.abs(target - value);
      if (distance <= bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
    return best == null ? { value, snapped: null } : { value: best, snapped: best };
  }

  function autoPan(event: PointerEvent): void {
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    if (event.clientX > rect.right - 36) scroller.scrollLeft += 14;
    else if (event.clientX < rect.left + LABEL_W + 36) scroller.scrollLeft -= 14;
  }

  function beginDrag(event: PointerEvent, item: TimelineItemSnapshot, mode: DragMode, lane: TimelineLaneSnapshot): void {
    if (event.button !== 0) return;
    if (mode === "move" && !item.editable?.from) return;
    if (mode === "trim-left" && !(item.editable?.from && item.editable?.duration)) return;
    if (mode === "trim-right" && !item.editable?.duration) return;
    event.preventDefault();
    event.stopPropagation();
    viewModel.select(item.id);
    onselect();
    drag = {
      itemId: item.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      originalFrom: item.from,
      originalDuration: finiteDuration(item),
      from: item.from,
      duration: finiteDuration(item),
      moved: false,
      clientX: event.clientX,
      clientY: event.clientY,
      snapped: null,
      originalLayer: lane.layer ?? 0,
      layer: lane.layer ?? 0,
      originalLaneId: lane.id,
      targetLaneId: lane.id,
      laneKind: lane.kind,
    };
    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", finishDrag, { once: true });
    window.addEventListener("pointercancel", finishDrag, { once: true });
  }

  function moveDrag(event: PointerEvent): void {
    if (!drag) return;
    autoPan(event);
    const delta = Math.round((event.clientX - drag.startX) / ppf);
    const threshold = Math.max(1, Math.round(7 / ppf));
    const targets = event.altKey ? [] : snapTargets(drag.itemId);
    const laneElement = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".lane[data-lane-id]");
    const targetKind = laneElement?.dataset.laneKind;
    const targetLayer = Number(laneElement?.dataset.layer);
    const targetLaneId = targetKind === drag.laneKind && Number.isFinite(targetLayer)
      ? laneElement?.dataset.laneId ?? drag.targetLaneId
      : drag.targetLaneId;
    const layer = targetKind === drag.laneKind && Number.isFinite(targetLayer) ? targetLayer : drag.layer;
    let from = drag.originalFrom;
    let dur = drag.originalDuration;
    let snapped: number | null = null;
    if (drag.mode === "move") {
      from = drag.originalFrom + delta;
      const startSnap = applySnap(from, targets, threshold);
      const endSnap = applySnap(from + dur, targets, threshold);
      if (startSnap.snapped != null && (endSnap.snapped == null || Math.abs(startSnap.value - from) <= Math.abs(endSnap.value - (from + dur)))) {
        from = startSnap.value;
        snapped = startSnap.snapped;
      } else if (endSnap.snapped != null) {
        from = endSnap.value - dur;
        snapped = endSnap.snapped;
      }
      // the axis is open: clips can be staged anywhere within the (growing) canvas
      from = Math.max(axisStart, Math.min(axisEnd - dur, from));
    } else if (drag.mode === "trim-left") {
      const snap = applySnap(drag.originalFrom + delta, targets, threshold);
      snapped = snap.snapped;
      from = Math.max(axisStart, Math.min(drag.originalFrom + drag.originalDuration - 1, snap.value));
      dur = drag.originalDuration - (from - drag.originalFrom);
    } else {
      const snap = applySnap(drag.originalFrom + drag.originalDuration + delta, targets, threshold);
      snapped = snap.snapped;
      dur = Math.max(1, Math.min(axisEnd - drag.originalFrom, snap.value - drag.originalFrom));
    }
    const moved = drag.moved || Math.abs(event.clientX - drag.startX) > 2 || Math.abs(event.clientY - drag.startY) > 2;
    // live-preview the frame at the edge being trimmed — you see exactly what you cut to
    if (moved && drag.mode === "trim-left") viewModel.seek(from);
    else if (moved && drag.mode === "trim-right") viewModel.seek(from + dur - 1);
    drag = { ...drag, from, duration: dur, layer, targetLaneId, snapped, clientX: event.clientX, clientY: event.clientY, moved };
  }

  function finishDrag(): void {
    window.removeEventListener("pointermove", moveDrag);
    window.removeEventListener("pointercancel", finishDrag);
    if (!drag) return;
    const finished = drag;
    drag = null;
    if (finished.moved) void viewModel.commitPlacement(
      finished.itemId,
      finished.from,
      finished.duration,
      finished.targetLaneId !== finished.originalLaneId ? finished.layer : undefined,
    );
  }

  function beginZoneDrag(event: PointerEvent, mode: ZoneMode): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const current = $store.render;
    zoneDrag = {
      mode,
      startX: event.clientX,
      f0: current.from,
      t0: current.to,
      from: current.from,
      to: current.to,
      moved: false,
      clientX: event.clientX,
      clientY: event.clientY,
      snapped: null,
    };
    window.addEventListener("pointermove", moveZoneDrag);
    window.addEventListener("pointerup", finishZoneDrag, { once: true });
    window.addEventListener("pointercancel", finishZoneDrag, { once: true });
  }

  function moveZoneDrag(event: PointerEvent): void {
    if (!zoneDrag) return;
    autoPan(event);
    const delta = Math.round((event.clientX - zoneDrag.startX) / ppf);
    const threshold = Math.max(1, Math.round(7 / ppf));
    const targets = event.altKey ? [] : snapTargets("");
    const length = zoneDrag.t0 - zoneDrag.f0;
    let from = zoneDrag.f0;
    let to = zoneDrag.t0;
    let snapped: number | null = null;
    if (zoneDrag.mode === "move") {
      from = zoneDrag.f0 + delta;
      const startSnap = applySnap(from, targets, threshold);
      const endSnap = applySnap(from + length, targets, threshold);
      if (startSnap.snapped != null && (endSnap.snapped == null || Math.abs(startSnap.value - from) <= Math.abs(endSnap.value - (from + length)))) {
        from = startSnap.value;
        snapped = startSnap.snapped;
      } else if (endSnap.snapped != null) {
        from = endSnap.value - length;
        snapped = endSnap.snapped;
      }
      from = Math.max(axisStart, Math.min(axisEnd - length, from));
      to = from + length;
    } else if (zoneDrag.mode === "left") {
      const snap = applySnap(zoneDrag.f0 + delta, targets, threshold);
      snapped = snap.snapped;
      from = Math.max(axisStart, Math.min(zoneDrag.t0 - 1, snap.value));
    } else {
      const snap = applySnap(zoneDrag.t0 + delta, targets, threshold);
      snapped = snap.snapped;
      to = Math.max(zoneDrag.f0 + 1, Math.min(axisEnd, snap.value));
    }
    const moved = zoneDrag.moved || Math.abs(event.clientX - zoneDrag.startX) > 2;
    // live-preview the output boundary being set
    if (moved && zoneDrag.mode === "left") viewModel.seek(from);
    else if (moved && zoneDrag.mode === "right") viewModel.seek(to - 1);
    zoneDrag = { ...zoneDrag, from, to, snapped, clientX: event.clientX, clientY: event.clientY, moved };
  }

  function finishZoneDrag(): void {
    window.removeEventListener("pointermove", moveZoneDrag);
    window.removeEventListener("pointercancel", finishZoneDrag);
    if (!zoneDrag) return;
    const finished = zoneDrag;
    zoneDrag = null;
    if (finished.moved) {
      // the playhead comes to rest at the window's start — the output's t0
      viewModel.seek(finished.from);
      void viewModel.commitRenderWindow(finished.from, finished.to);
    }
  }

  $: activeSnap = drag?.snapped ?? zoneDrag?.snapped ?? null;
  $: hud = drag?.moved
    ? drag.mode === "move"
      ? `${drag.from}f – ${drag.from + drag.duration}f · ${drag.targetLaneId !== drag.originalLaneId ? `layer ${drag.layer + 1} · ` : ""}Δ${drag.from - drag.originalFrom >= 0 ? "+" : ""}${drag.from - drag.originalFrom}f`
      : drag.mode === "trim-left"
        ? `in ${drag.from}f · ${drag.duration}f long`
        : `out ${drag.from + drag.duration}f · ${drag.duration}f long`
    : zoneDrag?.moved
      ? `render ${zoneDrag.from}f – ${zoneDrag.to}f · ${zoneDrag.to - zoneDrag.from}f out`
      : "";
  $: hudX = (drag?.clientX ?? zoneDrag?.clientX ?? 0) + 14;
  $: hudY = (drag?.clientY ?? zoneDrag?.clientY ?? 0) - 32;
</script>

<section class="timeline" aria-label="Timeline">
  <header class="timeline-header">
    <span>TIMELINE</span>
    <div class="tl-zoom">
      <button onclick={() => setZoom(ppf / 1.4)} title="Zoom out (or ⌘/Ctrl + scroll on the timeline)">−</button>
      <button onclick={zoomFit} title="Fit everything">FIT</button>
      <button onclick={() => setZoom(ppf * 1.4)} title="Zoom in (or ⌘/Ctrl + scroll on the timeline)">＋</button>
    </div>
    <span class="summary">renders {rw.from}–{rw.to}f · {time(rw.to - rw.from)} out · snap ⌥ off{#if $store.animations.length} · {$store.animations.length} motion{#if $store.unrollGroups.length} · {$store.unrollGroups.length} helper{/if}{#if $store.animationDiagnostics.length} · {$store.animationDiagnostics.length} note{/if}{/if}</span>
  </header>

  <div
    class="tl-scroll"
    class:composition-drop-target={compositionDropFrame != null}
    role="group"
    aria-label={acceptCompositionDrop ? "Timeline; drop a composition to add it at a frame" : "Timeline tracks"}
    bind:this={scroller}
    bind:clientWidth={viewportW}
    onwheel={onWheel}
    ondragover={dragCompositionOver}
    ondragleave={dragCompositionLeave}
    ondrop={dropComposition}
  >
    <div class="tl-canvas" style:width={`${LABEL_W + axisLen * ppf}px`}>
      <div class="render-row">
        <div class="render-row-label" title="Only the render window ships — output t0 is its left edge">RENDER</div>
        <div class="render-row-track">
          <div
            class="rz-bar"
            class:engaged={zoneDrag != null}
            style:left={`${(rw.from - axisStart) * ppf}px`}
            style:width={`${(rw.to - rw.from) * ppf}px`}
            role="presentation"
            title="Render window — what ships. Drag to slide; the left edge is the output's t0, the right edge is its end."
            onpointerdown={(event) => beginZoneDrag(event, "move")}
          >
            <i class="rz-handle left" role="presentation" title="Output starts here (t0)" onpointerdown={(event) => beginZoneDrag(event, "left")}></i>
            <i class="rz-handle right" role="presentation" title="Output ends here" onpointerdown={(event) => beginZoneDrag(event, "right")}></i>
          </div>
        </div>
      </div>

      <div
        class="ruler"
        style:margin-left={`${LABEL_W}px`}
        style:width={`${axisLen * ppf}px`}
        onpointerdown={beginScrub}
        onpointermove={moveScrub}
        onpointerup={endScrub}
        onpointercancel={endScrub}
        role="slider"
        aria-label="Playhead"
        aria-valuenow={$store.frame}
        aria-valuemin="0"
        aria-valuemax={$store.durationInFrames}
        tabindex="0"
      >
        {#each relTicks as rel (rel)}
          {@const inWindow = rel >= 0 && rel <= rw.to - rw.from}
          <span class="tick" class:origin={rel === 0} class:outside={!inWindow} style:left={`${(rw.from + rel - axisStart) * ppf}px`}>{inWindow ? tickLabel(rel) : ""}</span>
        {/each}
      </div>

      <!-- only [render.from, render.to) ships; everything else is staging space -->
      <div class="tl-offzone" style:left={`${LABEL_W}px`} style:width={`${(rw.from - axisStart) * ppf}px`}></div>
      <div class="tl-offzone" style:left={`${LABEL_W + (rw.to - axisStart) * ppf}px`} style:width={`${(axisEnd - rw.to) * ppf}px`}></div>
      <div class="render-zone" style:left={`${LABEL_W + (rw.from - axisStart) * ppf}px`} style:width={`${(rw.to - rw.from) * ppf}px`}></div>

      {#if $store.loading && !$store.lanes.length}
        <div class="timeline-empty">Reading the composition…</div>
      {:else if !$store.lanes.length}
        <div class="timeline-empty">No timeline items were discovered in this composition.</div>
      {/if}

      {#each $store.lanes as lane (lane.id)}
        <div
          class="lane"
          class:drop-target={drag?.targetLaneId === lane.id && drag.targetLaneId !== drag.originalLaneId}
          data-lane-id={lane.id}
          data-lane-kind={lane.kind}
          data-layer={lane.layer ?? 0}
        >
          <div class="lane-label" title={lane.authority === "explicit" ? `Source-backed layer ${lane.layer}` : "Legacy overlap packing — vertical drag materializes source layers"}>{lane.label}{lane.authority === "legacy" ? "·" : ""}</div>
          <div
            class="lane-track"
            style:width={`${axisLen * ppf}px`}
            onpointerdown={beginScrub}
            onpointermove={moveScrub}
            onpointerup={endScrub}
            onpointercancel={endScrub}
            role="presentation"
          >
            {#if drag && drag.moved && lane.items.some((item) => item.id === drag?.itemId)}
              <div class="clip-ghost" style:left={`${(drag.originalFrom - axisStart) * ppf}px`} style:width={`${drag.originalDuration * ppf}px`}></div>
            {/if}
            {#each lane.items as item (item.id)}
              {@const shownDur = drag?.itemId === item.id ? drag.duration : Number.isFinite(item.durationInFrames) ? item.durationInFrames : Math.max(1, duration - item.from)}
              {@const sourceLimit = $store.sourceLimits[item.id]}
              <button
                class="clip clip-{lane.kind}"
                data-item-id={item.id}
                class:selected={item.id === $store.selectedItemId}
                class:dragging={drag?.itemId === item.id && drag.moved}
                style:left={`${((drag?.itemId === item.id ? drag.from : item.from) - axisStart) * ppf}px`}
                style:width={`${(drag?.itemId === item.id ? drag.duration : Number.isFinite(item.durationInFrames) ? item.durationInFrames : Math.max(1, duration - item.from)) * ppf}px`}
                onpointerdown={(event) => beginDrag(event, item, "move", lane)}
                onclick={(event) => {
                  event.stopPropagation();
                  viewModel.select(item.id);
                  onselect();
                }}
                ondblclick={() => viewModel.enter(item.id)}
                title={`${timelineItemLabel(item)} · ${drag?.itemId === item.id ? drag.from : item.from}f · ${lane.authority} layer ${lane.layer ?? 0}${item.production?.availability ? ` · ${item.production.availability}${item.production.rendition ? ` ${item.production.rendition}` : ""}` : ""}${item.production?.pinnedTake != null ? ` · take ${item.production.pinnedTake}` : ""}${item.production?.artifactStatus ? ` · bake ${item.production.artifactStatus}` : ""}${item.production?.effects ? " · effects" : ""} · double-click to open`}
              >
                {#if item.editable?.from && item.editable?.duration}
                  <i class="trim-handle left" role="presentation" title="Trim in point — preserves the surviving source frame" onpointerdown={(event) => beginDrag(event, item, "trim-left", lane)}></i>
                {/if}
                <span>{timelineItemLabel(item)}</span>
                {#if item.production?.availability}{@const label = item.production.availability === "local" ? "Media available locally" : item.production.availability === "remote" ? "Media available remotely" : "Media is missing"}<b class="production-badge {item.production.availability}" role="img" aria-label={label} title={label}>{item.production.availability === "local" ? "●" : item.production.availability === "remote" ? "⇣" : "!"}</b>{/if}
                {#if item.production?.rendition === "proxy"}<b class="production-badge proxy" role="img" aria-label="Proxy rendition" title="Proxy rendition">proxy</b>{/if}
                {#if item.production?.pinnedTake != null}<b class="production-badge pinned" role="img" aria-label={`Pinned generation take ${item.production.pinnedTake}`} title={`Pinned generation take ${item.production.pinnedTake}`}>t{item.production.pinnedTake}</b>{/if}
                {#if item.production?.artifactStatus}{@const label = `Bake ${item.production.artifactStatus}`}<b class="production-badge artifact {item.production.artifactStatus}" role="img" aria-label={label} title={label}>{item.production.artifactStatus === "current" ? "✓" : item.production.artifactStatus === "stale" ? "~" : item.production.artifactStatus === "remote" ? "⇣" : "○"}</b>{/if}
                {#if item.production?.nestedCompositionKey}<b class="production-badge nested" role="img" aria-label="Nested composition" title={`Nested composition · ${item.production.nestedCompositionKey}`}>↳</b>{/if}
                {#if item.production?.effects}<b class="production-badge effects" role="img" aria-label="Effects applied" title="Effects applied">fx</b>{/if}
                {#if sourceLimit !== undefined && shownDur > sourceLimit}
                  <i
                    class="clip-overrun"
                    role="presentation"
                    style:left={`${sourceLimit * ppf}px`}
                    style:width={`${(shownDur - sourceLimit) * ppf}px`}
                    title="Past the source's end — the last frame holds"
                  ></i>
                {/if}
                {#if item.editable?.duration}
                  <i class="trim-handle right" role="presentation" title="Trim out point" onpointerdown={(event) => beginDrag(event, item, "trim-right", lane)}></i>
                {/if}
              </button>
            {/each}
          </div>
        </div>
      {/each}

      {#each $store.animations as animation (animation.id)}
        <div class="lane animation-lane" data-animation-id={animation.id}>
          <div
            class="lane-label"
            title={`${animation.target} · ${animation.authority} · ${animation.source.file ?? "source"}`}
          >◆ {animation.id}</div>
          <div class="lane-track" style:width={`${axisLen * ppf}px`} role="presentation">
            <button
              class="animation-span"
              class:editable={animation.editable}
              class:selected={animation.id === $store.selectedAnimationId}
              style:left={`${(animation.startFrame - axisStart) * ppf}px`}
              style:width={`${Math.max(2, animation.durationInFrames * ppf)}px`}
              title={`${animation.kind} · ${animation.startFrame}–${animation.startFrame + animation.durationInFrames}f · ${animation.ease ?? "default ease"} · ${animation.editable ? "frame-authored and editable" : `${animation.authority} / inspect only`}`}
              onclick={(event) => { event.stopPropagation(); viewModel.selectAnimation(animation.id); onselect(); }}
            >
              <span>{animation.kind} · {Object.keys(animation.bindings).join(", ")}</span>
            </button>
            {#each animationKeys(animation) as key (`${animation.id}:${key.frame}`)}
              {@const shownFrame = animationKeyDrag?.animationId === animation.id && animationKeyDrag.frame === key.frame ? animationKeyDrag.toFrame : key.frame}
              <button class="animation-key" class:dragging={shownFrame !== key.frame} style:left={`${(shownFrame - axisStart) * ppf}px`} title={`${key.properties.join(", ")} key at ${key.frame}f · drag to retime`} onpointerdown={(event) => beginAnimationKeyDrag(event, animation.id, key.properties, key.frame)}></button>
            {/each}
          </div>
        </div>
      {/each}

      {#each $store.unrollGroups as group (`unroll:${group.id}`)}
        {@const groupStart = group.operations.length ? Math.min(...group.operations.map((operation) => operation.startFrame)) : 0}
        {@const groupEnd = Math.max(...group.operations.map((operation) => operation.startFrame + operation.durationInFrames), groupStart + 1)}
        <div class="lane animation-lane unroll-lane" data-unroll-id={group.id}>
          <div class="lane-label" title={`${group.operations.length} runtime-traced operations · ${group.source.file ?? "source"}`}>ƒ {group.id}</div>
          <div class="lane-track" style:width={`${axisLen * ppf}px`} role="presentation">
            <button
              class="animation-span unroll-span"
              class:selected={group.id === $store.selectedAnimationId}
              class:unsafe={!group.safe}
              style:left={`${(groupStart - axisStart) * ppf}px`}
              style:width={`${Math.max(24, (groupEnd - groupStart) * ppf)}px`}
              title={group.safe ? `${group.operations.length} operations · safe to unroll` : group.issues.join(" · ")}
              onclick={(event) => { event.stopPropagation(); viewModel.selectAnimation(group.id); onselect(); }}
            >ƒ {group.operations.length} traced ops · {group.safe ? "ready" : "locked"}</button>
          </div>
        </div>
      {/each}

      <div class="playhead" style:left={`${LABEL_W + ($store.frame - axisStart) * ppf}px`}></div>
      {#if compositionDropFrame != null}
        <div class="composition-drop-guide" style:left={`${LABEL_W + (compositionDropFrame - axisStart) * ppf}px`}>
          <span>ADD COMP · {compositionDropFrame}f</span>
        </div>
      {/if}
      {#if activeSnap != null}
        <div class="snap-guide" style:left={`${LABEL_W + (activeSnap - axisStart) * ppf}px`}></div>
      {/if}
    </div>
  </div>

  {#if hud}
    <div class="drag-hud" style:left={`${hudX}px`} style:top={`${hudY}px`}>{hud}</div>
  {/if}
</section>
