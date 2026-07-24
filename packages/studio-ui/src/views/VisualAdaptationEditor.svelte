<script lang="ts">
  import {
    classifyVisualGeometry,
    cropRegionForTargetAspect,
    normalizeCropRegion,
    type NormalizedCropRegion,
    type VisualAdaptation,
    type VisualFitMode,
  } from "@framediff/studio-model";

  export let sourceWidth: number;
  export let sourceHeight: number;
  export let targetWidth: number;
  export let targetHeight: number;
  export let value: VisualAdaptation;
  export let onchange: (adaptation: VisualAdaptation) => void;

  let drag:
    | { pointerId: number; startX: number; startY: number; crop: NormalizedCropRegion }
    | undefined;

  $: geometry = classifyVisualGeometry(sourceWidth, sourceHeight, targetWidth, targetHeight);
  $: defaultCrop = cropRegionForTargetAspect(sourceWidth, sourceHeight, targetWidth, targetHeight);
  $: crop = value.crop ?? defaultCrop;
  $: maximumCrop = cropRegionForTargetAspect(sourceWidth, sourceHeight, targetWidth, targetHeight);
  $: cropCenterX = crop.x + crop.width / 2;
  $: cropCenterY = crop.y + crop.height / 2;
  $: cropZoom = Math.min(crop.width / maximumCrop.width, crop.height / maximumCrop.height);
  const fitLabel: Record<VisualFitMode, { title: string; detail: string }> = {
    native: { title: "Use as-is", detail: "No preprocessing" },
    resize: { title: "Resize", detail: "Aspect already matches" },
    cover: { title: "Crop to fill", detail: "Keep aspect + choose crop" },
    contain: { title: "Fit inside", detail: "Keep aspect + letterbox" },
    stretch: { title: "Stretch", detail: "Resize to exact target" },
  };

  function chooseFit(fit: VisualFitMode): void {
    onchange({
      ...value,
      fit,
      ...(fit === "cover" ? { crop: value.crop ?? defaultCrop } : {}),
      ...(fit === "contain" ? { matte: value.matte ?? "#000000" } : {}),
    });
  }

  function setCrop(next: NormalizedCropRegion): void {
    onchange({ ...value, fit: "cover", crop: normalizeCropRegion(next) });
  }

  function setCropCenter(axis: "x" | "y", next: number): void {
    setCrop({
      ...crop,
      x: axis === "x" ? next - crop.width / 2 : crop.x,
      y: axis === "y" ? next - crop.height / 2 : crop.y,
    });
  }

  function setCropZoom(zoom: number): void {
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;
    setCrop(cropRegionForTargetAspect(
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      centerX,
      centerY,
      zoom,
    ));
  }

  function beginCropDrag(event: PointerEvent): void {
    if (value.fit !== "cover") return;
    event.currentTarget instanceof HTMLElement && event.currentTarget.setPointerCapture(event.pointerId);
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      crop: { ...crop },
    };
  }

  function moveCrop(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId || !(event.currentTarget instanceof HTMLElement)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setCrop({
      ...drag.crop,
      x: drag.crop.x + (event.clientX - drag.startX) / Math.max(1, rect.width),
      y: drag.crop.y + (event.clientY - drag.startY) / Math.max(1, rect.height),
    });
  }

  function endCropDrag(event: PointerEvent): void {
    if (drag?.pointerId === event.pointerId) drag = undefined;
  }
</script>

<section class="visual-adaptation">
  <div class="geometry-readout">
    <div><span>SOURCE</span><strong>{sourceWidth}×{sourceHeight}</strong></div>
    <i>→</i>
    <div><span>TARGET</span><strong>{targetWidth}×{targetHeight}</strong></div>
    <div class="geometry-class">
      <b>{geometry.label}</b>
      <small>{geometry.detail}{geometry.aspectMatches ? " Aspect ratio matches." : " Aspect ratio differs."}</small>
    </div>
  </div>

  <div class="fit-options" style={`--fit-count:${geometry.allowedFits.length}`}>
    {#each geometry.allowedFits as fit}
      <button type="button" class:selected={value.fit === fit} aria-pressed={value.fit === fit} onclick={() => chooseFit(fit)}>
        <strong>{fitLabel[fit].title}</strong>
        <small>{fitLabel[fit].detail}</small>
        {#if geometry.recommendedFit === fit}<em>recommended</em>{/if}
      </button>
    {/each}
  </div>

  {#if value.fit === "cover"}
    <div class="crop-editor">
      <div
        class:dragging={!!drag}
        class="crop-stage"
        style={`aspect-ratio:${sourceWidth}/${sourceHeight}`}
        role="application"
        aria-label="Drag the crop region"
        onpointerdown={beginCropDrag}
        onpointermove={moveCrop}
        onpointerup={endCropDrag}
        onpointercancel={endCropDrag}
      >
        <div class="crop-media"><span>source frame</span></div>
        <div
          class="crop-region"
          style={`left:${crop.x * 100}%;top:${crop.y * 100}%;width:${crop.width * 100}%;height:${crop.height * 100}%`}
        >
          <i></i><i></i><i></i><i></i>
          <span>{targetWidth}:{targetHeight} crop</span>
        </div>
      </div>
      <div class="crop-controls">
        <label><span>Horizontal</span><input type="range" min={crop.width / 2} max={1 - crop.width / 2} step="0.001" value={cropCenterX} oninput={(event) => setCropCenter("x", Number(event.currentTarget.value))} /><output>{Math.round(cropCenterX * 100)}%</output></label>
        <label><span>Vertical</span><input type="range" min={crop.height / 2} max={1 - crop.height / 2} step="0.001" value={cropCenterY} oninput={(event) => setCropCenter("y", Number(event.currentTarget.value))} /><output>{Math.round(cropCenterY * 100)}%</output></label>
        <label><span>Crop size</span><input type="range" min="0.15" max="1" step="0.001" value={cropZoom} oninput={(event) => setCropZoom(Number(event.currentTarget.value))} /><output>{Math.round(cropZoom * 100)}%</output></label>
      </div>
      <code>x {crop.x.toFixed(3)} · y {crop.y.toFixed(3)} · w {crop.width.toFixed(3)} · h {crop.height.toFixed(3)}</code>
    </div>
  {:else if value.fit === "contain"}
    <label class="matte-control">
      <span>LETTERBOX MATTE</span>
      <input type="color" value={value.matte ?? "#000000"} oninput={(event) => onchange({ ...value, matte: event.currentTarget.value })} />
      <code>{value.matte ?? "#000000"}</code>
    </label>
  {/if}

  {#if geometry.scaling !== "none"}
    <p class="scaling-note">{geometry.scaling === "up" ? "This target scales the selected source region up." : geometry.scaling === "down" ? "This target scales the selected source region down." : "One axis scales up while the other scales down."}</p>
  {/if}
</section>
