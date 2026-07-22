<script lang="ts">
  import { motionPathToSvg, type AnimationLiteral, type CubicMotionSegment, type InspectorFieldSnapshot, type ParamBinding } from "@framediff/studio-model";
  import type { InspectorViewModel } from "../viewmodels/Inspector.ViewModel";
  import type { MediaViewModel } from "../viewmodels/Media.ViewModel";
  import CameraInspector from "./CameraInspector.svelte";
  import EffectEditorModal from "./EffectEditorModal.svelte";
  import InspectorField from "./InspectorField.svelte";

  export let viewModel: InspectorViewModel;
  export let mediaViewModel: MediaViewModel;
  const store = viewModel.store;
  const mediaStore = mediaViewModel.store;

  let draftFrom = 0;
  let draftDuration = 1;
  let previousItemId: string | undefined;
  let arcCurvature = 0.28;
  let arcDirection: "clockwise" | "counterclockwise" = "clockwise";
  let editorSectionId: string | null = null;

  $: editorSection = editorSectionId ? $store.sections.find((section) => section.id === editorSectionId) : undefined;
  $: documentBacked = $store.sections.some((section) => section.id.startsWith("document:"));

  $: if ($store.item?.id !== previousItemId) {
    previousItemId = $store.item?.id;
    draftFrom = $store.item?.from ?? 0;
    draftDuration = $store.item?.durationInFrames ?? 1;
  }

  function commitFrom(): void {
    if ($store.item?.editable?.from && draftFrom !== $store.item.from) void viewModel.edit("from", draftFrom);
  }

  function commitDuration(): void {
    if ($store.item?.editable?.duration && draftDuration !== $store.item.durationInFrames) {
      void viewModel.edit("durationInFrames", draftDuration);
    }
  }

  function clearSelection(): void {
    if ($mediaStore.selected) mediaViewModel.clearSelection();
    else viewModel.clearSelection();
  }

  const size = (bytes: number) => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1_000)} KB`;
  const assetUrl = (contentHash: string) => `/__framediff-cache/${encodeURIComponent(contentHash)}`;
  const cameraPlaneUrl = (): string | undefined => {
    const hash = $store.item?.production?.proxyContentHash ?? $store.item?.production?.contentHash;
    return hash ? assetUrl(hash) : undefined;
  };
  const cameraPlaneTime = (): number => {
    const item = $store.item;
    const fps = $store.composition?.fps ?? 24;
    if (!item || (item.content.type !== "video" && item.content.type !== "nested")) return 0;
    const localFrame = $store.frame - item.from;
    return (item.content.trimStart ?? 0) + ((localFrame + 0.5) / fps) * (item.content.playbackRate ?? 1);
  };
  async function revealOnDisk(contentHash: string): Promise<void> {
    await fetch(`/__framediff/cache/reveal?hash=${encodeURIComponent(contentHash)}`, { method: "POST" });
  }

  const motionProperty = (field: InspectorFieldSnapshot): string | undefined => {
    const attribute = field.id.startsWith("html:") ? field.id.slice("html:".length) : "";
    return ({
      "data-fd-x": "x",
      "data-fd-y": "y",
      "data-fd-width": "width",
      "data-fd-height": "height",
      "data-fd-opacity": "opacity",
      "data-fd-scale": "scale",
      "data-fd-rotation": "rotation",
    } as Record<string, string>)[attribute];
  };
  const numericFieldValue = (field: InspectorFieldSnapshot): number | undefined =>
    field.control?.type === "number" ? field.control.value : field.value;
  const existingMotion = (property: string) => $store.elementAnimations.find((animation) => animation.bindings[property]);
  const allAnimationFrames = () => $store.animation ? [...new Set(Object.values($store.animation.bindings).flatMap(
    (binding) => binding.kind === "keyframes" ? binding.keys.map((key) => key.frame) : [],
  ))].sort((left, right) => left - right) : [];
  function goKey(direction: -1 | 1): void {
    const frames = allAnimationFrames();
    const target = direction < 0 ? [...frames].reverse().find((frame) => frame < $store.frame) : frames.find((frame) => frame > $store.frame);
    if (target != null) viewModel.seek(target);
  }
  const keysOf = (binding: ParamBinding<AnimationLiteral>) => binding.kind === "keyframes" ? binding.keys : [];
  function addKey(property: string, binding: ParamBinding<AnimationLiteral>): void {
    if (!$store.animation) return;
    const keys = keysOf(binding);
    const value = [...keys].reverse().find((key) => key.frame <= $store.frame)?.value ?? keys[0]?.value ?? 0;
    void viewModel.editAnimation($store.animation.id, { type: "upsert-key", property, frame: $store.frame, value }, `Add ${property} key`);
  }
  function easePath(ease: string | undefined): string {
    const valueAt = (t: number) => {
      if (ease?.startsWith("power3")) return 1 - Math.pow(1 - t, 4);
      if (ease?.startsWith("power2")) return 1 - Math.pow(1 - t, 3);
      if (ease?.startsWith("power1")) return 1 - Math.pow(1 - t, 2);
      if (ease?.startsWith("sine")) return -(Math.cos(Math.PI * t) - 1) / 2;
      if (ease?.startsWith("back")) { const c = 2.7; return 1 + c * Math.pow(t - 1, 3) + (c - 1) * Math.pow(t - 1, 2); }
      return t;
    };
    return Array.from({ length: 33 }, (_, index) => {
      const t = index / 32;
      return `${index ? "L" : "M"}${(8 + t * 204).toFixed(1)},${(68 - valueAt(t) * 56).toFixed(1)}`;
    }).join(" ");
  }
  const animationEase = () => $store.animation?.ease ?? ($store.animation
    ? Object.values($store.animation.bindings).flatMap((binding) => binding.kind === "keyframes" ? binding.keys.map((key) => key.ease) : []).find(Boolean)
    : undefined);
  const canMakeArc = () => $store.animation?.bindings.x?.kind === "keyframes"
    && $store.animation.bindings.y?.kind === "keyframes"
    && $store.animation.bindings.x.keys.length >= 2
    && $store.animation.bindings.y.keys.length >= 2;
  function editPathPoint(segmentIndex: number, handle: keyof CubicMotionSegment, axis: "x" | "y", value: number): void {
    const animation = $store.animation;
    if (!animation?.motionPath) return;
    const segments = animation.motionPath.segments.map((segment) => ({
      from: { ...segment.from }, control1: { ...segment.control1 }, control2: { ...segment.control2 }, to: { ...segment.to },
    }));
    segments[segmentIndex][handle][axis] = value;
    void viewModel.editMotionPath(animation.id, motionPathToSvg(segments), `Edit ${animation.id} ${handle}`);
  }
</script>

<aside class="inspector" aria-label="Inspector">
  <header>
    <div>
      <span class="eyebrow">{$mediaStore.selected ? "MEDIA" : "INSPECTOR"}</span>
      <strong>{$mediaStore.selected?.name ?? $store.itemLabel ?? $store.composition?.id ?? "Nothing selected"}</strong>
    </div>
    {#if $mediaStore.selected || $store.item || $store.elementId || $store.animation || $store.unrollGroup}<button class="close" onclick={clearSelection} aria-label="Clear selection">×</button>{/if}
  </header>

  {#if $mediaStore.selected}
    {@const asset = $mediaStore.selected}
    {@const src = assetUrl(asset.previewContentHash ?? asset.contentHash)}
    {@const originalSrc = assetUrl(asset.contentHash)}
    <section class="media-preview-section">
      <div class="media-preview" class:audio={asset.mime.startsWith("audio/")}>
        {#if asset.mime.startsWith("video/")}
          <!-- svelte-ignore a11y_media_has_caption -- imported assets do not necessarily include a captions track -->
          <video src={src} controls playsinline preload="metadata"></video>
        {:else if asset.mime.startsWith("image/")}
          <img src={src} alt={asset.name} />
        {:else if asset.mime.startsWith("audio/")}
          <span class="audio-glyph">♒</span>
          <audio src={src} controls preload="metadata"></audio>
        {:else}
          <span class="unsupported-preview">No inline preview for {asset.mime}</span>
        {/if}
      </div>
      <a class="open-media" href={originalSrc} target="_blank" rel="noreferrer">Open original ↗</a>
    </section>

    <section class="inspector-section">
      <h3>MEDIA</h3>
      <dl>
        <div><dt>Type</dt><dd>{asset.mime}</dd></div>
        <div><dt>Size</dt><dd>{size(asset.bytes)}</dd></div>
        <div>
          <dt>Disk</dt>
          <dd>
            <button class="disk-link" title={asset.filename ?? "Reveal cached asset on disk"} onclick={() => void revealOnDisk(asset.contentHash)}>
              {asset.filename ?? "Reveal on disk"} ↗
            </button>
          </dd>
        </div>
        <div><dt>Asset</dt><dd title={`asset://${asset.id}`}>asset://{asset.id}</dd></div>
        <div><dt>Hash</dt><dd title={asset.contentHash}>{asset.contentHash}</dd></div>
      </dl>
    </section>
  {:else if !$store.item && !$store.elementId && !$store.animation && !$store.unrollGroup && !$store.detailsLoading && !$store.sections.length}
    <div class="empty inspector-onboarding">
      <span class="empty-icon">⌁</span>
      {#if $store.composition?.kind === "scene" || $store.composition?.kind === "3d"}
        <strong>Select something in the scene</strong>
        <p>The Inspector follows your canvas selection and edits its declared JSON or source authority.</p>
        <ul>
          <li><b>CANVAS</b><span>Click an element to see its properties; drag or resize it directly when handles appear.</span></li>
          <li><b>TIME</b><span>Scrub the compact time control to inspect procedural motion at any frame.</span></li>
          <li><b>MOTION</b><span>Animate a numeric property or record a gesture path from the selected element.</span></li>
          <li><b>MEDIA</b><span>Open Media to inspect or choose portable project assets.</span></li>
        </ul>
        <small>Scene-wide controls appear here automatically when the composition declares them.</small>
      {:else}
        <strong>Choose what you want to edit</strong>
        <p>Canvas, timeline, motion and media all resolve to the same Inspector and declared data authority.</p>
        <ul>
          <li><b>CANVAS</b><span>Click a stable element to move, resize, edit text or animate it.</span></li>
          <li><b>TIMELINE</b><span>Select a clip for timing, trim, layers, grade and production state.</span></li>
          <li><b>MOTION</b><span>Select a ◆ lane or key for tween, ease, path and gesture tools.</span></li>
          <li><b>MEDIA</b><span>Open Media to inspect portable asset identity, proxy and hash.</span></li>
        </ul>
        <small>Double-click a nested clip to edit inside it · open GUIDE for a hands-on route.</small>
      {/if}
    </div>
  {:else}
    {#if $store.unrollGroup}
      {@const group = $store.unrollGroup}
      <section class="inspector-section unroll-editor">
        <h3>COMPUTED HELPER · RUNTIME TRACE</h3>
        <div class="unroll-status" class:safe={group.safe}>{group.safe ? "✓ serializable + deterministic" : "locked"}</div>
        <dl>
          <div><dt>Group</dt><dd>{group.id}</dd></div>
          <div><dt>Operations</dt><dd>{group.operations.length}</dd></div>
          <div><dt>Call site</dt><dd>{group.source.file ?? "source"}:{group.source.start}</dd></div>
        </dl>
        {#if group.issues.length}<div class="gesture-note">{group.issues.join(" · ")}</div>{/if}
        <button class="unroll-action" disabled={!group.safe || $store.editing} onclick={() => void viewModel.unrollGroup(group.id)}>Unroll to edit</button>
        <p class="unroll-explainer">Replaces only this call site, reloads source, and commits only if the explicit frame trace is identical.</p>
      </section>
      {#each group.operations as operation, index (`${operation.target}:${index}`)}
        <section class="inspector-section trace-operation">
          <h3>{index + 1} · {operation.kind.toUpperCase()}</h3>
          <dl><div><dt>Target</dt><dd>{operation.target}</dd></div><div><dt>Frames</dt><dd>{operation.startFrame}–{operation.startFrame + operation.durationInFrames}</dd></div><div><dt>Values</dt><dd>{Object.keys(operation.to).join(", ")}</dd></div></dl>
        </section>
      {/each}
    {:else if $store.animation}
      {@const animation = $store.animation}
      <section class="inspector-section motion-editor">
        <h3>MOTION · {animation.kind.toUpperCase()}</h3>
        <div class="motion-transport">
          <button onclick={() => goKey(-1)} title="Previous key">◀◆</button>
          <button onclick={() => goKey(1)} title="Next key">◆▶</button>
          <label class="auto-key"><input type="checkbox" checked={$store.autoKey} onchange={(event) => viewModel.setAutoKey(event.currentTarget.checked)} /> AUTO-KEY</label>
        </div>
        <label>
          <span>Start</span>
          <input type="number" value={animation.startFrame} disabled={!animation.editable || $store.editing} onchange={(event) => void viewModel.editAnimation(animation.id, { type: "timing", startFrame: Number(event.currentTarget.value) }, "Move animation")} />
          <small>frames</small>
        </label>
        <label>
          <span>Duration</span>
          <input type="number" min="0" value={animation.durationInFrames} disabled={!animation.editable || $store.editing} onchange={(event) => void viewModel.editAnimation(animation.id, { type: "timing", durationInFrames: Number(event.currentTarget.value) }, "Retiming animation")} />
          <small>frames</small>
        </label>
        <div class="authority">
          <span class:literal={animation.editable}>{animation.editable ? "literal frame source" : `${animation.authority} · inspect only`}</span>
          <span>{animation.source.file ?? "runtime"}</span>
        </div>
        <svg class="motion-curve" viewBox="0 0 220 76" role="img" aria-label={`${animationEase() ?? "linear"} easing curve`}>
          <path class="curve-grid" d="M8 12V68H212M8 40H212M110 12V68" />
          <path class="curve-line" d={easePath(animationEase())} />
          <circle cx="8" cy="68" r="3" /><circle cx="212" cy="12" r="3" />
        </svg>
      </section>

      <section class="inspector-section path-editor">
        <h3>SPATIAL PATH</h3>
        {#if canMakeArc()}
          <label><span>Curvature</span><input type="range" min="-0.8" max="0.8" step="0.02" bind:value={arcCurvature} /><output>{Number(arcCurvature).toFixed(2)}</output></label>
          <label><span>Direction</span><select bind:value={arcDirection}><option value="clockwise">clockwise</option><option value="counterclockwise">counter</option></select><small></small></label>
          <button class="path-action" disabled={!animation.editable || $store.editing} onclick={() => void viewModel.makeArc(animation.id, Number(arcCurvature), arcDirection)}>⌒ Make arc</button>
        {/if}
        <button class="path-action record" disabled={$store.editing || $store.gestureDraft?.status === "recording"} onclick={() => viewModel.armGesture()}>● Record gesture</button>
        {#if $store.gestureDraft?.status === "armed"}<div class="gesture-note">Drag in the canvas to begin. Playback starts from {$store.gestureDraft.startFrame}f.</div>{/if}
        {#if $store.gestureDraft?.status === "recording"}<div class="gesture-note live">● recording · {$store.gestureDraft.samples.length} frame samples</div>{/if}
        {#if $store.gestureDraft?.status === "preview"}
          <div class="gesture-note">Preview · {$store.gestureDraft.samples.length} samples · commit is one undo entry</div>
          <div class="gesture-actions"><button onclick={() => void viewModel.commitGesture()} disabled={!$store.gestureDraft.path}>Commit path</button><button onclick={() => viewModel.cancelGesture()}>Cancel</button></div>
        {/if}
      </section>

      {#if animation.motionPath}
        <section class="inspector-section path-points">
          <h3>ANCHORS + TANGENTS</h3>
          {#each animation.motionPath.segments as segment, index (index)}
            {#each [["from", segment.from], ["control1", segment.control1], ["control2", segment.control2], ["to", segment.to]] as entry (`${index}:${entry[0]}`)}
              {@const handle = entry[0] as keyof CubicMotionSegment}
              {@const value = entry[1] as CubicMotionSegment[typeof handle]}
              <div class="path-point-row"><span>{index + 1}.{handle}</span><input aria-label={`${handle} x`} type="number" step="1" value={value.x} onchange={(event) => editPathPoint(index, handle, "x", Number(event.currentTarget.value))} /><input aria-label={`${handle} y`} type="number" step="1" value={value.y} onchange={(event) => editPathPoint(index, handle, "y", Number(event.currentTarget.value))} /></div>
            {/each}
          {/each}
        </section>
      {/if}

      {#each Object.entries(animation.bindings) as [property, binding] (property)}
        <section class="inspector-section motion-property">
          <h3>{property.toUpperCase()} <button class="add-key" onclick={() => addKey(property, binding)} disabled={!animation.editable || $store.editing} title={`Add or update a key at frame ${$store.frame}`}>＋ ◆ {$store.frame}f</button></h3>
          {#if binding.kind === "keyframes"}
            {#each binding.keys as key (`${property}:${key.frame}`)}
              <div class="keyframe-row">
                <button class="key-goto" onclick={() => viewModel.seek(key.frame)} title="Go to key">◆</button>
                <input aria-label={`${property} key frame`} type="number" value={key.frame} disabled={!animation.editable || $store.editing} onchange={(event) => void viewModel.editAnimation(animation.id, { type: "move-key", property, frame: key.frame, toFrame: Number(event.currentTarget.value) }, `Move ${property} key`)} />
                {#if typeof key.value === "number"}
                  <input aria-label={`${property} key value`} type="number" step="0.01" value={key.value} disabled={!animation.editable || $store.editing} onchange={(event) => void viewModel.editAnimation(animation.id, { type: "upsert-key", property, frame: key.frame, value: Number(event.currentTarget.value), ease: key.ease }, `Edit ${property} key`)} />
                {:else}
                  <input aria-label={`${property} key value`} type="text" value={String(key.value)} disabled={!animation.editable || $store.editing} onchange={(event) => void viewModel.editAnimation(animation.id, { type: "upsert-key", property, frame: key.frame, value: event.currentTarget.value, ease: key.ease }, `Edit ${property} key`)} />
                {/if}
                <select aria-label={`${property} key easing`} value={key.ease ?? "none"} disabled={!animation.editable || $store.editing} onchange={(event) => void viewModel.editAnimation(animation.id, { type: "set-ease", property, frame: key.frame, ease: event.currentTarget.value === "none" ? undefined : event.currentTarget.value }, `Edit ${property} easing`)}>
                  {#each ["none", "linear", "power1.out", "power2.out", "power3.out", "sine.inOut", "back.out(1.35)"] as ease}
                    <option value={ease}>{ease}</option>
                  {/each}
                </select>
                <button class="delete-key" aria-label={`Delete ${property} key at ${key.frame}`} disabled={!animation.editable || $store.editing || binding.keys.length <= 1} onclick={() => void viewModel.editAnimation(animation.id, { type: "delete-key", property, frame: key.frame }, `Delete ${property} key`)}>×</button>
              </div>
            {/each}
          {:else if binding.kind === "const"}
            <div class="keyframe-row const"><span>constant</span><strong>{String(binding.value)}</strong></div>
          {:else}
            <div class="panel-empty">{binding.kind} binding · inspect only</div>
          {/if}
        </section>
      {/each}
    {:else if $store.item}
      {#if $store.elementId}
        <section class="inspector-section">
          <h3>ELEMENT</h3>
          <dl>
            <div><dt>Stable ID</dt><dd>{$store.elementId}</dd></div>
            <div><dt>Authority</dt><dd>{documentBacked ? "composition JSON" : "source-backed HTML"}</dd></div>
          </dl>
          {#if $store.canRecordGesture}<button class="path-action record" onclick={() => viewModel.armGesture()} disabled={$store.editing}>● Record gesture path</button>{/if}
        </section>
      {/if}
      <section class="inspector-section">
        <h3>PLACEMENT</h3>
        <label>
          <span>Start</span>
          <input type="number" bind:value={draftFrom} disabled={!$store.item.editable?.from || $store.editing} onblur={commitFrom} onchange={commitFrom} />
          <small>frames</small>
        </label>
        <label>
          <span>Duration</span>
          <input type="number" min="1" bind:value={draftDuration} disabled={!$store.item.editable?.duration || $store.editing} onblur={commitDuration} onchange={commitDuration} />
          <small>frames</small>
        </label>
        <div class="authority">
          <span class:literal={$store.item.editable?.from}>start · {$store.item.editable?.from ? "literal" : "computed"}</span>
          <span class:literal={$store.item.editable?.duration}>duration · {$store.item.editable?.duration ? "literal" : "computed"}</span>
        </div>
      </section>

      <section class="inspector-section">
        <h3>CONTENT</h3>
        <dl>
          <div><dt>Type</dt><dd>{$store.item.content.type}</dd></div>
          <div><dt>Origin</dt><dd>{$store.item.origin}</dd></div>
          {#if $store.item.content.type === "video" || $store.item.content.type === "audio"}
            <div><dt>Source</dt><dd title={$store.item.content.src}>{$store.item.content.src}</dd></div>
          {:else if $store.item.content.type === "nested"}
            <div><dt>Composition</dt><dd>{$store.item.content.compId}</dd></div>
            <div><dt>Trim start</dt><dd>{$store.item.content.trimStart.toFixed(3)}s</dd></div>
          {/if}
        </dl>
        {#if $store.item.content.type === "nested"}<button class="open-nested" onclick={() => viewModel.enterNested()}>OPEN NESTED COMPOSITION <span>→</span></button>{/if}
      </section>

      {#if $store.item.production}
        {@const production = $store.item.production}
        <section class="inspector-section production-details">
          <h3>PRODUCTION</h3>
          <dl>
            {#if production.availability}<div><dt>Media</dt><dd><span class="state-pill {production.availability}">{production.availability}</span>{production.rendition ? ` · ${production.rendition}` : ""}</dd></div>{/if}
            {#if production.assetId}<div><dt>Asset</dt><dd title={`asset://${production.assetId}`}>asset://{production.assetId}</dd></div>{/if}
            {#if production.contentHash}<div><dt>Content</dt><dd title={production.contentHash}>{production.contentHash}</dd></div>{/if}
            {#if production.proxyContentHash}<div><dt>Proxy</dt><dd title={production.proxyContentHash}>{production.proxyContentHash}</dd></div>{/if}
            {#if production.pinnedTake != null}<div><dt>Take</dt><dd>pinned take {production.pinnedTake}</dd></div>{/if}
            {#if production.artifactStatus}<div><dt>Bake</dt><dd><span class="state-pill {production.artifactStatus}">{production.artifactStatus}</span></dd></div>{/if}
            {#if production.nestedCompositionKey}<div><dt>Nested</dt><dd>{production.nestedCompositionKey}</dd></div>{/if}
            <div><dt>Effects</dt><dd>{production.effects ? "present" : "none"}</dd></div>
          </dl>
          <p>These values are derived from source, the asset manifest, local CAS and artifact input hashes.</p>
        </section>
      {/if}
    {:else if $store.elementId}
      <section class="inspector-section">
        <h3>ELEMENT</h3>
        <dl>
          <div><dt>Stable ID</dt><dd>{$store.elementId}</dd></div>
          <div><dt>Authority</dt><dd>{documentBacked ? "composition JSON" : "source-backed HTML"}</dd></div>
        </dl>
        {#if $store.canRecordGesture}<button class="path-action record" onclick={() => viewModel.armGesture()} disabled={$store.editing}>● Record gesture path</button>{/if}
        {#if $store.gestureDraft?.status === "preview"}
          <div class="gesture-actions"><button onclick={() => void viewModel.commitGesture()} disabled={!$store.gestureDraft.path}>Commit path</button><button onclick={() => viewModel.cancelGesture()}>Cancel</button></div>
        {/if}
      </section>
    {/if}

    {#if $store.detailsLoading}<div class="panel-empty">Resolving authored controls…</div>{/if}
    {#each $store.sections as section (section.id)}
      {#if section.kind === "camera"}
        <CameraInspector
          {section}
          frame={$store.frame}
          disabled={$store.editing}
          planePreviewUrl={cameraPlaneUrl()}
          planePreviewTime={cameraPlaneTime()}
          oncommit={(fieldId, value) => viewModel.editField(fieldId, value)}
          oncommitmany={(edits, options) => viewModel.editFields(edits, options)}
          onseek={(targetFrame) => viewModel.seek(targetFrame)}
        />
      {:else}
        <section class="inspector-section advanced kind-{section.kind ?? 'data'}">
          <div class="inspector-section-heading">
            <h3>{section.title}</h3>
            {#if section.editor}<button class="open-effect-editor" onclick={() => editorSectionId = section.id}>{section.editor.label} <b>↗</b></button>{/if}
          </div>
          {#if section.presets?.length}
            <div class="preset-grid">
              {#each section.presets as preset (preset.id)}
                <button onclick={() => void viewModel.applyPreset(preset.id)} disabled={$store.editing}>{preset.label}</button>
              {/each}
            </div>
          {/if}
          {#each section.fields as field (field.id)}
            <InspectorField {field} assets={$mediaStore.assets} disabled={$store.editing} oncommit={(fieldId, value) => void viewModel.editField(fieldId, value)} />
            {@const property = motionProperty(field)}
            {@const value = numericFieldValue(field)}
            {#if $store.elementId && property && value != null}
              {@const motion = existingMotion(property)}
              <button class="stopwatch" class:active={!!motion} disabled={$store.editing || !field.editable} onclick={() => motion ? viewModel.selectAnimation(motion.id) : void viewModel.createAnimation(property, value)} title={motion ? `Open ${motion.id}` : `Convert ${property} to a registered frame-authored tween`}>{motion ? "◆" : "◷"} {motion ? "Animated" : `Animate ${property}`}</button>
            {/if}
          {/each}
        </section>
      {/if}
    {/each}

    {#if $store.error}<div class="message error">{$store.error}</div>{/if}
    {#if $store.notice}<div class="message notice">{$store.notice}</div>{/if}
  {/if}
</aside>

{#if editorSection}
  <EffectEditorModal
    section={editorSection}
    assets={$mediaStore.assets}
    disabled={$store.editing}
    onclose={() => editorSectionId = null}
    oncommit={(fieldId, value) => void viewModel.editField(fieldId, value)}
    onpreset={(presetId) => void viewModel.applyPreset(presetId)}
  />
{/if}
