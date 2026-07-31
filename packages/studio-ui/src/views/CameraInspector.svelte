<script lang="ts">
  import { onMount } from "svelte";
  import type { InspectorFieldSnapshot, InspectorSectionSnapshot } from "@framediff/studio-model";
  import {
    cameraFieldMap,
    cameraFieldValue,
    cameraPoseAtFrame,
    cameraVectorEdits,
    cameraVectorKeys,
    type CameraEndpoint,
    type CameraRigHandle,
    type CameraVector,
  } from "../viewmodels/CameraInspector.ViewModel";

  export let section: InspectorSectionSnapshot;
  export let frame: number;
  export let disabled = false;
  export let planePreviewUrl: string | undefined;
  export let planePreviewTime = 0;
  export let oncommit: (fieldId: string, value: number) => void;
  export let oncommitmany: (
    edits: Array<{ fieldId: string; value: number }>,
    options?: { label?: string; groupId?: string },
  ) => void | boolean | Promise<boolean>;
  export let onseek: (frame: number) => void;

  let endpoint: CameraEndpoint = "start";
  let rigOpen = false;
  let rigLoading = false;
  let rigLoadError = "";
  let RigEditor: typeof import("./CameraRigEditor.svelte").default | undefined;
  let inlineSvg: SVGSVGElement;
  let inlineDrag: { pointerId: number; handle: CameraRigHandle; x: number; z: number } | null = null;
  const axes = ["X", "Y", "Z"] as const;
  const endpointRows = [
    { label: "Camera", suffix: "Camera", hint: "position" },
    { label: "Look at", suffix: "Target", hint: "target" },
  ] as const;
  const planeRows = [
    { label: "Size", keys: ["planeW", "planeH"], axes: ["W", "H"] },
    { label: "Position", keys: ["planeX", "planeY", "planeZ"], axes: ["X", "Y", "Z"] },
    { label: "Rotation", keys: ["planeRotXDeg", "planeRotYDeg", "planeRotZDeg"], axes: ["X°", "Y°", "Z°"] },
  ] as const;

  $: fields = cameraFieldMap(section);
  $: pose = cameraPoseAtFrame(section, frame);
  $: endpointTitle = endpoint === "start" ? "Start" : "End";
  $: endpointFrame = cameraFieldValue(fields, `${endpoint}Frame`);

  let value: (key: string, fallback?: number) => number;
  $: value = (key: string, fallback = 0) => cameraFieldValue(fields, key, fallback);
  const field = (key: string): InspectorFieldSnapshot | undefined => fields.get(key);
  const keyFor = (side: CameraEndpoint, suffix: string, axis?: string): string => `${side}${suffix}${axis ?? ""}`;
  const rounded = (amount: number, digits = 2): string => Number.isFinite(amount) ? amount.toFixed(digits) : "—";
  const clamp = (amount: number, min: number, max: number): number => Math.max(min, Math.min(max, amount));
  let shownValue: (key: string, fallback?: number) => number;
  $: shownValue = (key: string, fallback = 0): number => {
    if (!inlineDrag) return value(key, fallback);
    const [xKey, , zKey] = cameraVectorKeys(endpoint, inlineDrag.handle);
    if (key === xKey) return inlineDrag.x;
    if (key === zKey) return inlineDrag.z;
    return value(key, fallback);
  };
  const plotX = (amount: number): number => 14 + clamp((amount + 2.5) / 5, 0, 1) * 212;
  const plotZ = (amount: number): number => 112 - clamp((amount + 0.5) / 3.5, 0, 1) * 94;
  const rigStateKey = (): string => `framediff:camera-rig:${section.id}`;

  function saveRigState(): void {
    try { sessionStorage.setItem(rigStateKey(), JSON.stringify({ open: rigOpen, endpoint })); } catch { /* static and privacy-restricted previews can omit UI persistence */ }
  }

  async function setRigOpen(open: boolean): Promise<void> {
    if (open && !RigEditor) {
      rigLoading = true;
      rigLoadError = "";
      try {
        RigEditor = (await import("./CameraRigEditor.svelte")).default;
      } catch (error) {
        rigLoadError = error instanceof Error ? error.message : "The editor module could not be loaded.";
        return;
      } finally {
        rigLoading = false;
      }
    }
    rigOpen = open;
    saveRigState();
  }

  function setEndpoint(next: CameraEndpoint): void {
    endpoint = next;
    saveRigState();
  }

  function commitNumber(sourceField: InspectorFieldSnapshot | undefined, event: Event): void {
    if (!sourceField?.editable) return;
    const next = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(next) && next !== sourceField.value) oncommit(sourceField.id, next);
  }

  function diagramPoint(event: PointerEvent): { x: number; z: number } {
    const bounds = inlineSvg.getBoundingClientRect();
    const px = (event.clientX - bounds.left) / Math.max(1, bounds.width) * 240;
    const py = (event.clientY - bounds.top) / Math.max(1, bounds.height) * 126;
    return {
      x: clamp((px - 14) / 212 * 5 - 2.5, -2.5, 2.5),
      z: clamp((112 - py) / 94 * 3.5 - 0.5, -0.5, 3),
    };
  }

  function beginDiagramDrag(event: PointerEvent, handle: CameraRigHandle): void {
    if (disabled) return;
    const point = diagramPoint(event);
    inlineSvg.setPointerCapture(event.pointerId);
    inlineDrag = { pointerId: event.pointerId, handle, ...point };
    event.preventDefault();
    event.stopPropagation();
  }

  function moveDiagramHandle(event: PointerEvent): void {
    if (!inlineDrag || inlineDrag.pointerId !== event.pointerId) return;
    inlineDrag = { ...inlineDrag, ...diagramPoint(event) };
  }

  async function finishDiagramDrag(event: PointerEvent, cancel = false): Promise<void> {
    if (!inlineDrag || inlineDrag.pointerId !== event.pointerId) return;
    const completed = inlineDrag;
    inlineDrag = null;
    if (inlineSvg.hasPointerCapture(event.pointerId)) inlineSvg.releasePointerCapture(event.pointerId);
    if (cancel) return;
    const keys = cameraVectorKeys(endpoint, completed.handle);
    const vector = [completed.x, value(keys[1]), completed.z] as CameraVector;
    const edits = cameraVectorEdits(section, endpoint, completed.handle, vector);
    if (!edits.length) return;
    const label = completed.handle === "plane"
      ? "Move video plane in top view"
      : `Move ${endpointTitle.toLowerCase()} ${completed.handle === "target" ? "look target" : completed.handle} in top view`;
    await oncommitmany(edits, { label, groupId: globalThis.crypto?.randomUUID?.() ?? `camera-top-${Date.now()}` });
  }

  function nudgeDiagramHandle(event: KeyboardEvent, handle: CameraRigHandle): void {
    if (disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const keys = cameraVectorKeys(endpoint, handle);
    const amount = event.shiftKey ? 0.1 : 0.01;
    const vector = [
      value(keys[0]) + (event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0),
      value(keys[1]),
      value(keys[2]) + (event.key === "ArrowDown" ? -amount : event.key === "ArrowUp" ? amount : 0),
    ] as CameraVector;
    const edits = cameraVectorEdits(section, endpoint, handle, vector);
    if (edits.length) void oncommitmany(edits, { label: `Nudge ${endpointTitle.toLowerCase()} ${handle} in top view` });
  }

  onMount(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(rigStateKey()) ?? "null") as { open?: boolean; endpoint?: CameraEndpoint } | null;
      if (saved?.endpoint === "start" || saved?.endpoint === "end") endpoint = saved.endpoint;
      if (saved?.open === true) void setRigOpen(true);
    } catch { /* ignore malformed or unavailable transient UI state */ }
  });
</script>

<section class="camera-inspector" aria-label="3D camera rig">
  <div class="camera-authority">
    <span>IMPORTED RIG · SOURCE BACKED</span>
    <small>Every enabled control rewrites one literal and stays deterministic.</small>
  </div>

  <div class="camera-view interactive" aria-label="Interactive top view of authored camera endpoints">
    <svg bind:this={inlineSvg} viewBox="0 0 240 126" role="application" aria-label="Drag the camera, look target, focus point or video plane in X and Z" onpointermove={moveDiagramHandle} onpointerup={(event) => void finishDiagramDrag(event)} onpointercancel={(event) => void finishDiagramDrag(event, true)}>
      <path class="camera-grid" d="M14 18V112H226M14 65H226M67 18V112M120 18V112M173 18V112" />
      <line class="camera-plane" x1={plotX(shownValue("planeX")) - 24} x2={plotX(shownValue("planeX")) + 24} y1={plotZ(shownValue("planeZ"))} y2={plotZ(shownValue("planeZ"))} />
      <line class="camera-plane-hit" role="button" tabindex="0" aria-label="Drag video plane in X and Z" x1={plotX(shownValue("planeX")) - 27} x2={plotX(shownValue("planeX")) + 27} y1={plotZ(shownValue("planeZ"))} y2={plotZ(shownValue("planeZ"))} onpointerdown={(event) => beginDiagramDrag(event, "plane")} onkeydown={(event) => nudgeDiagramHandle(event, "plane")} />
      <line class="camera-path" x1={plotX(value("startCameraX"))} y1={plotZ(value("startCameraZ"))} x2={plotX(value("endCameraX"))} y2={plotZ(value("endCameraZ"))} />
      <line class="camera-sight" x1={plotX(shownValue(keyFor(endpoint, "Camera", "X")))} y1={plotZ(shownValue(keyFor(endpoint, "Camera", "Z")))} x2={plotX(shownValue(keyFor(endpoint, "Target", "X")))} y2={plotZ(shownValue(keyFor(endpoint, "Target", "Z")))} />
      <line class="camera-focus-line" x1={plotX(shownValue(keyFor(endpoint, "Camera", "X")))} y1={plotZ(shownValue(keyFor(endpoint, "Camera", "Z")))} x2={plotX(shownValue(keyFor(endpoint, "Focus", "X")))} y2={plotZ(shownValue(keyFor(endpoint, "Focus", "Z")))} />
      <circle class="camera-endpoint" cx={plotX(value("startCameraX"))} cy={plotZ(value("startCameraZ"))} r="4" />
      <circle class="camera-endpoint ghost" cx={plotX(value("endCameraX"))} cy={plotZ(value("endCameraZ"))} r="4" />
      <circle class="camera-current drag-handle" role="button" tabindex="0" aria-label={`Drag ${endpointTitle.toLowerCase()} camera in X and Z`} cx={plotX(shownValue(keyFor(endpoint, "Camera", "X")))} cy={plotZ(shownValue(keyFor(endpoint, "Camera", "Z")))} r="5" onpointerdown={(event) => beginDiagramDrag(event, "camera")} onkeydown={(event) => nudgeDiagramHandle(event, "camera")} />
      <circle class="camera-target-hit drag-handle" role="button" tabindex="0" aria-label={`Drag ${endpointTitle.toLowerCase()} look target in X and Z`} cx={plotX(shownValue(keyFor(endpoint, "Target", "X")))} cy={plotZ(shownValue(keyFor(endpoint, "Target", "Z")))} r="7" onpointerdown={(event) => beginDiagramDrag(event, "target")} onkeydown={(event) => nudgeDiagramHandle(event, "target")} />
      <path class="camera-target" d={`M${plotX(shownValue(keyFor(endpoint, "Target", "X"))) - 5},${plotZ(shownValue(keyFor(endpoint, "Target", "Z")))}h10M${plotX(shownValue(keyFor(endpoint, "Target", "X")))},${plotZ(shownValue(keyFor(endpoint, "Target", "Z"))) - 5}v10`} />
      <circle class="camera-focus-hit drag-handle" role="button" tabindex="0" aria-label={`Drag ${endpointTitle.toLowerCase()} focus point in X and Z`} cx={plotX(shownValue(keyFor(endpoint, "Focus", "X")))} cy={plotZ(shownValue(keyFor(endpoint, "Focus", "Z")))} r="7" onpointerdown={(event) => beginDiagramDrag(event, "focus")} onkeydown={(event) => nudgeDiagramHandle(event, "focus")} />
      <circle class="camera-focus" cx={plotX(shownValue(keyFor(endpoint, "Focus", "X")))} cy={plotZ(shownValue(keyFor(endpoint, "Focus", "Z")))} r="3.2" />
      <text x="18" y="29">TOP · X/Z</text>
      <text x={plotX(shownValue("planeX")) + 27} y={plotZ(shownValue("planeZ")) + 3}>PLANE</text>
      <text x={plotX(shownValue(keyFor(endpoint, "Camera", "X"))) + 7} y={plotZ(shownValue(keyFor(endpoint, "Camera", "Z"))) - 5}>{endpoint === "start" ? "A" : "B"} CAMERA</text>
      <text class="camera-drag-copy" x="222" y="29" text-anchor="end">DRAG HANDLES</text>
    </svg>
  </div>

  <button class="camera-open-rig" disabled={rigLoading} onclick={() => void setRigOpen(true)}>
    <span>{rigLoading ? "LOADING 3D EDITOR…" : "OPEN 3D RIG EDITOR"}</span><small>video plane · camera · look direction · focus</small><b>↗</b>
  </button>
  {#if rigLoadError}
    <div class="camera-rig-load-error" role="alert">
      <span>Could not load the 3D editor: {rigLoadError}</span>
      <button onclick={() => location.reload()}>Reload Studio</button>
    </div>
  {/if}

  <div class="camera-readout">
    <div><span>FRAME</span><strong>{rounded(frame, 0)}f</strong></div>
    <div><span>MIX</span><strong>{rounded(pose.progress * 100, 0)}%</strong></div>
    <div><span>LENS*</span><strong>{rounded(pose.focalLength, 1)}mm</strong></div>
    <div><span>FOV*</span><strong>{rounded(pose.fieldOfView, 1)}°</strong></div>
  </div>

  <div class="camera-segment" aria-label="Camera endpoint">
    <button class:active={endpoint === "start"} aria-pressed={endpoint === "start"} onclick={() => setEndpoint("start")}>A · START</button>
    <button class:active={endpoint === "end"} aria-pressed={endpoint === "end"} onclick={() => setEndpoint("end")}>B · END</button>
  </div>
  {#key endpoint}
  <button class="camera-jump" onclick={() => onseek(endpointFrame)}>Jump preview to {endpointTitle.toLowerCase()} · {rounded(endpointFrame, 2)}f</button>

  <details class="camera-group" open>
    <summary>LENS / ZOOM <span>{rounded(value(keyFor(endpoint, "FocalLength")), 1)}mm</span></summary>
    {#if field(keyFor(endpoint, "FocalLength"))}
      {@const lensField = field(keyFor(endpoint, "FocalLength"))!}
      <label class="camera-slider">
        <span>{endpointTitle} focal length</span>
        <input aria-label={`${endpointTitle} focal length slider`} type="range" min="10" max="200" step="0.1" value={value(keyFor(endpoint, "FocalLength"))} disabled={disabled || !lensField.editable} onchange={(event) => commitNumber(lensField, event)} />
        <input aria-label={`${endpointTitle} focal length`} type="number" min="1" step="0.01" value={value(keyFor(endpoint, "FocalLength"))} disabled={disabled || !lensField.editable} onblur={(event) => commitNumber(lensField, event)} onchange={(event) => commitNumber(lensField, event)} />
      </label>
    {/if}
    <p class="camera-help">Longer lenses zoom in; shorter lenses widen the view. *The {rounded(pose.fieldOfView, 1)}° readout is a linear endpoint guide; the canvas shows the exact fitted interpolation.</p>
  </details>

  <details class="camera-group" open>
    <summary>CAMERA POSE <span>{endpointTitle}</span></summary>
    <div class="camera-vector camera-vector-head"><span></span>{#each axes as axis}<b>{axis}</b>{/each}</div>
    {#each endpointRows as row (row.suffix)}
      <div class="camera-vector">
        <span title={row.hint}>{row.label}</span>
        {#each axes as axis}
          {@const sourceField = field(keyFor(endpoint, row.suffix, axis))}
          {#if sourceField}<input aria-label={`${endpointTitle} ${row.label.toLowerCase()} ${axis}`} type="number" step="0.0001" value={value(keyFor(endpoint, row.suffix, axis))} disabled={disabled || !sourceField.editable} onblur={(event) => commitNumber(sourceField, event)} onchange={(event) => commitNumber(sourceField, event)} />{/if}
        {/each}
      </div>
    {/each}
  </details>

  <details class="camera-group">
    <summary>FOCUS + DEPTH <span>{rounded(pose.focusDistance, 2)}u</span></summary>
    <div class="camera-vector camera-vector-head"><span></span>{#each axes as axis}<b>{axis}</b>{/each}</div>
    <div class="camera-vector">
      <span>Focus point</span>
      {#each axes as axis}
        {@const sourceField = field(keyFor(endpoint, "Focus", axis))}
        {#if sourceField}<input aria-label={`${endpointTitle} focus point ${axis}`} type="number" step="0.0001" value={value(keyFor(endpoint, "Focus", axis))} disabled={disabled || !sourceField.editable} onblur={(event) => commitNumber(sourceField, event)} onchange={(event) => commitNumber(sourceField, event)} />{/if}
      {/each}
    </div>
    {#each [{ label: "Focus distance", suffix: "FocusDistance", step: 0.0001, unit: "world units" }, { label: "Depth of field", suffix: "DepthOfField", step: 0.01, unit: "aperture" }] as row (row.suffix)}
      {@const sourceField = field(keyFor(endpoint, row.suffix))}
      {#if sourceField}
        <label class="camera-number"><span>{endpointTitle} {row.label.toLowerCase()}</span><input aria-label={`${endpointTitle} ${row.label.toLowerCase()}`} type="number" min="0" step={row.step} value={value(keyFor(endpoint, row.suffix))} disabled={disabled || !sourceField.editable} onblur={(event) => commitNumber(sourceField, event)} onchange={(event) => commitNumber(sourceField, event)} /><small>{row.unit}</small></label>
      {/if}
    {/each}
  </details>
  {/key}

  <details class="camera-group">
    <summary>SHOT TIMING <span>{rounded(pose.startFrame, 1)}–{rounded(pose.endFrame, 1)}f</span></summary>
    {#each [{ label: "Start frame", key: "startFrame" }, { label: "End frame", key: "endFrame" }] as row (row.key)}
      {@const sourceField = field(row.key)}
      {#if sourceField}<label class="camera-number"><span>{row.label}</span><input aria-label={row.label} type="number" step="0.001" value={value(row.key)} disabled={disabled || !sourceField.editable} onblur={(event) => commitNumber(sourceField, event)} onchange={(event) => commitNumber(sourceField, event)} /><small>frames</small></label>{/if}
    {/each}
    <p class="camera-help">These are animation-key frames inside the shot, so they may extend beyond its visible edit.</p>
  </details>

  <details class="camera-group">
    <summary>VIDEO PLANE <span>{rounded(value("planeW"), 2)} × {rounded(value("planeH"), 2)}</span></summary>
    {#each planeRows as row (row.label)}
      <div class="camera-vector plane-vector" style={`grid-template-columns:52px repeat(${row.keys.length},1fr)`}>
        <span>{row.label}</span>
        {#each row.keys as key, index (key)}
          {@const sourceField = field(key)}
          {#if sourceField}<label><b>{row.axes[index]}</b><input aria-label={`Plane ${row.label.toLowerCase()} ${row.axes[index]}`} type="number" step="0.0001" value={value(key)} disabled={disabled || !sourceField.editable} onblur={(event) => commitNumber(sourceField, event)} onchange={(event) => commitNumber(sourceField, event)} /></label>{/if}
        {/each}
      </div>
    {/each}
    {#if field("planeScale")}
      {@const scaleField = field("planeScale")!}
      <label class="camera-number"><span>Scale</span><input aria-label="Plane scale" type="number" min="0.001" step="0.001" value={value("planeScale")} disabled={disabled || !scaleField.editable} onblur={(event) => commitNumber(scaleField, event)} onchange={(event) => commitNumber(scaleField, event)} /><small>×</small></label>
    {/if}
  </details>

  <details class="camera-group">
    <summary>FINISHING <span>{rounded(value("shutterAngle"), 0)}° shutter</span></summary>
    {#each [
      { label: "Maximum blur", key: "maxBlur", step: 0.001, unit: "normalized" },
      { label: "Shutter angle", key: "shutterAngle", step: 1, unit: "degrees" },
      { label: "Motion samples", key: "motionBlurSamples", step: 1, unit: "samples" },
    ] as row (row.key)}
      {@const sourceField = field(row.key)}
      {#if sourceField}<label class="camera-number"><span>{row.label}</span><input aria-label={row.label} type="number" min="0" step={row.step} value={value(row.key)} disabled={disabled || !sourceField.editable} onblur={(event) => commitNumber(sourceField, event)} onchange={(event) => commitNumber(sourceField, event)} /><small>{row.unit}</small></label>{/if}
    {/each}
    <p class="camera-help">The shot's fitted LUT remains visible in local preview and exact render. Its look is managed by the per-shot grade pipeline.</p>
  </details>

  <p class="camera-footnote">Drag the top-view handles for quick X/Z moves, or open the 3D editor for full XYZ, look-direction, focus and plane control. The fitted canvas remains authoritative between the source-backed endpoints.</p>
</section>

{#if rigOpen && RigEditor}
  <RigEditor
    {section}
    {endpoint}
    {disabled}
    {planePreviewUrl}
    {planePreviewTime}
    onclose={() => void setRigOpen(false)}
    onendpoint={setEndpoint}
    {oncommit}
    {oncommitmany}
  />
{/if}
