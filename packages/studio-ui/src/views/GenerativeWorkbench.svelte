<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import {
    FRAMEDIFF_ASSET_DRAG_MIME,
    classifyVisualGeometry,
    cropRegionForTargetAspect,
    parseFramediffAssetDragPayload,
    retargetCropRegion,
    type StudioSession,
    type CompositionRuntimePort,
    type GenerativeWorkspaceSnapshot,
    type VisualAdaptation,
  } from "@framediff/studio-model";
  import {
    nextGenerationTake,
    referenceKindForMime,
    type GenerativeViewModel,
  } from "../viewmodels/Generative.ViewModel";
  import PreviewHost from "./PreviewHost.svelte";
  import VisualAdaptationEditor from "./VisualAdaptationEditor.svelte";

  export let viewModel: GenerativeViewModel;
  export let runtime: CompositionRuntimePort;
  export let session: StudioSession;
  export let onservices: () => void;
  const store = viewModel.store;
  let promptDraft = "";
  let negativeDraft = "";
  let previousRecipe = "";
  let assetId = "";
  let refKind = "image";
  let compDragOver = false;
  let previewCompositionKey = "";
  let previewTake: number | null = null;
  let failedDraftStarted = "";
  let selectedRefIndex: number | null = null;
  let outputWidth = 0;
  let outputHeight = 0;
  let outputAdaptation: VisualAdaptation | undefined;
  let outputDraftKey = "";
  let refAdaptation: VisualAdaptation | undefined;
  let refDraftKey = "";
  let outputSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let refSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let promptEditor: HTMLTextAreaElement | undefined;
  $: if ($store.workspace && $store.workspace.liveHash !== previousRecipe) {
    previousRecipe = $store.workspace.liveHash;
    promptDraft = $store.workspace.prompt;
    negativeDraft = $store.workspace.negativePrompt;
  }
  $: if ($store.workspace && $store.workspace.compositionKey !== previewCompositionKey) {
    previewCompositionKey = $store.workspace.compositionKey;
    previewTake = null;
    failedDraftStarted = "";
  }
  $: previewedTake = $store.workspace?.takes.find((take) => take.take === previewTake) ?? null;
  $: nextTake = nextGenerationTake($store.workspace);
  $: latestJobId = $store.workspace?.jobs.at(-1)?.id ?? "";
  $: latestFailedTake = $store.failedTakes.find((take) => take.id === latestJobId) ?? null;
  $: failedAttemptBlocksDraft = !!latestFailedTake
    && latestFailedTake.matchesCurrentRecipe
    && failedDraftStarted !== latestFailedTake.id;
  $: selectedRef = selectedRefIndex == null ? undefined : $store.workspace?.refs[selectedRefIndex];
  $: currentOutputKey = JSON.stringify($store.workspace?.desiredOutput ?? null);
  $: if ($store.workspace && currentOutputKey !== outputDraftKey) {
    outputDraftKey = currentOutputKey;
    outputWidth = $store.workspace.desiredOutput?.width ?? $store.workspace.nativeWidth ?? 0;
    outputHeight = $store.workspace.desiredOutput?.height ?? $store.workspace.nativeHeight ?? 0;
    outputAdaptation = $store.workspace.desiredOutput?.adaptation;
  }
  $: currentRefKey = `${selectedRefIndex ?? "none"}:${JSON.stringify(selectedRef?.adaptation ?? null)}`;
  $: if (currentRefKey !== refDraftKey) {
    refDraftKey = currentRefKey;
    refAdaptation = selectedRef?.adaptation;
  }
  const converted = (raw: string, original: unknown) => typeof original === "boolean" ? raw === "true" : typeof original === "number" ? Number(raw) : raw;
  // A comp:// ref is a link into its source composition — but only while that comp still exists.
  function inputCompositionKey(workspace: GenerativeWorkspaceSnapshot, src: string): string | null {
    if (!src.startsWith("comp://")) return null;
    const key = src.slice("comp://".length);
    return workspace.compositions.some((candidate) => candidate.key === key) ? key : null;
  }
  const takeUrl = (contentHash: string) => `/__framediff-cache/${encodeURIComponent(contentHash)}`;
  const takeExtension = (kind: "video" | "image" | "audio") => kind === "video" ? "mp4" : kind === "audio" ? "mp3" : "jpg";
  const COMP_DRAG_MIME = "application/x-framediff-comp";
  const defaultAdaptation = (sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): VisualAdaptation => {
    const geometry = classifyVisualGeometry(sourceWidth, sourceHeight, targetWidth, targetHeight);
    return {
      fit: geometry.recommendedFit,
      ...(geometry.recommendedFit === "cover"
        ? { crop: cropRegionForTargetAspect(sourceWidth, sourceHeight, targetWidth, targetHeight) }
        : {}),
      ...(geometry.recommendedFit === "contain" ? { matte: "#000000" } : {}),
    };
  };
  function desiredOutputValue(workspace: GenerativeWorkspaceSnapshot, width = outputWidth, height = outputHeight, adaptation = outputAdaptation) {
    if (!workspace.nativeWidth || !workspace.nativeHeight || !adaptation) return undefined;
    const geometry = classifyVisualGeometry(workspace.nativeWidth, workspace.nativeHeight, width, height);
    const fit = geometry.allowedFits.includes(adaptation.fit) ? adaptation.fit : geometry.recommendedFit;
    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      ...adaptation,
      fit,
      ...(fit === "cover" && adaptation.fit !== "cover"
        ? { crop: cropRegionForTargetAspect(workspace.nativeWidth, workspace.nativeHeight, width, height) }
        : {}),
    };
  }
  function enableDesiredOutput(workspace: GenerativeWorkspaceSnapshot): void {
    if (!workspace.nativeWidth || !workspace.nativeHeight) return;
    outputWidth = workspace.nativeWidth;
    outputHeight = workspace.nativeHeight;
    outputAdaptation = defaultAdaptation(workspace.nativeWidth, workspace.nativeHeight, outputWidth, outputHeight);
    void viewModel.update({ desiredOutput: desiredOutputValue(workspace) });
  }
  function saveDesiredOutput(workspace: GenerativeWorkspaceSnapshot, adaptation = outputAdaptation): void {
    if (!adaptation) return;
    outputAdaptation = adaptation;
    clearTimeout(outputSaveTimer);
    outputSaveTimer = setTimeout(() => {
      void viewModel.update({ desiredOutput: desiredOutputValue(workspace, outputWidth, outputHeight, outputAdaptation) });
    }, 180);
  }
  function changeDesiredDimensions(workspace: GenerativeWorkspaceSnapshot): void {
    if (!workspace.nativeWidth || !workspace.nativeHeight || !outputAdaptation) return;
    const geometry = classifyVisualGeometry(workspace.nativeWidth, workspace.nativeHeight, outputWidth, outputHeight);
    const previousWidth = workspace.desiredOutput?.width ?? workspace.nativeWidth;
    const previousHeight = workspace.desiredOutput?.height ?? workspace.nativeHeight;
    const fit = geometry.allowedFits.includes(outputAdaptation.fit)
      ? outputAdaptation.fit
      : geometry.recommendedFit;
    const crop = fit === "cover"
      ? outputAdaptation.fit === "cover" && outputAdaptation.crop
        ? retargetCropRegion(
            outputAdaptation.crop,
            workspace.nativeWidth,
            workspace.nativeHeight,
            previousWidth,
            previousHeight,
            workspace.nativeWidth,
            workspace.nativeHeight,
            outputWidth,
            outputHeight,
          )
        : cropRegionForTargetAspect(workspace.nativeWidth, workspace.nativeHeight, outputWidth, outputHeight)
      : outputAdaptation.crop;
    outputAdaptation = {
      ...outputAdaptation,
      fit,
      ...(crop ? { crop } : {}),
    };
    saveDesiredOutput(workspace);
  }
  function setDesiredPreset(workspace: GenerativeWorkspaceSnapshot, width: number, height: number): void {
    outputWidth = width;
    outputHeight = height;
    changeDesiredDimensions(workspace);
  }
  function enableRefAdaptation(): void {
    if (!selectedRef?.sourceWidth || !selectedRef.sourceHeight || !selectedRef.targetWidth || !selectedRef.targetHeight || selectedRefIndex == null) return;
    refAdaptation = defaultAdaptation(selectedRef.sourceWidth, selectedRef.sourceHeight, selectedRef.targetWidth, selectedRef.targetHeight);
    void viewModel.updateRefAdaptation(selectedRefIndex, refAdaptation);
  }
  function saveRefAdaptation(adaptation: VisualAdaptation): void {
    if (selectedRefIndex == null) return;
    const index = selectedRefIndex;
    refAdaptation = adaptation;
    clearTimeout(refSaveTimer);
    refSaveTimer = setTimeout(() => void viewModel.updateRefAdaptation(index, refAdaptation), 180);
  }
  onDestroy(() => {
    clearTimeout(outputSaveTimer);
    clearTimeout(refSaveTimer);
  });
  function dragReferenceOver(event: DragEvent): void {
    if (
      !event.dataTransfer?.types.includes(COMP_DRAG_MIME) &&
      !event.dataTransfer?.types.includes(FRAMEDIFF_ASSET_DRAG_MIME)
    ) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    compDragOver = true;
  }
  function dropReference(event: DragEvent): void {
    compDragOver = false;
    if (!$store.workspace) return;
    const asset = parseFramediffAssetDragPayload(
      event.dataTransfer?.getData(FRAMEDIFF_ASSET_DRAG_MIME) ?? "",
    );
    if (asset) {
      event.preventDefault();
      void viewModel.addAssetRef(asset.id, referenceKindForMime(asset.mime) ?? refKind);
      return;
    }
    const key = event.dataTransfer?.getData(COMP_DRAG_MIME);
    if (!key) return;
    event.preventDefault();
    const composition = $store.workspace.compositions.find((candidate) => candidate.key === key);
    if (!composition) return;
    void viewModel.addCompositionRef(key, composition.outputKind);
  }
  function addSelectedInput(workspace: NonNullable<typeof $store.workspace>): void {
    if (!assetId) return;
    if (assetId.startsWith("comp://")) void viewModel.addCompositionRef(assetId.slice("comp://".length), refKind);
    else void viewModel.addAssetRef(assetId, refKind);
    assetId = "";
  }
  async function startFromSelectedTake(): Promise<void> {
    if (!previewedTake) return;
    if (await viewModel.startFrom(previewedTake.take)) await editDraft();
  }
  async function editDraft(): Promise<void> {
    previewTake = null;
    await tick();
    promptEditor?.focus();
  }
  async function addTake(workspace: NonNullable<typeof $store.workspace>): Promise<void> {
    const latest = workspace.takes.at(-1);
    if (!latest) {
      await editDraft();
      return;
    }
    if (await viewModel.startFrom(latest.take)) await editDraft();
  }
  async function startFromFailedTake(id: string): Promise<void> {
    if (await viewModel.startFromJob(id)) {
      failedDraftStarted = id;
      await editDraft();
    }
  }
</script>

<section class="gen-workbench">
  {#if $store.loading && !$store.workspace}<div class="panel-empty">Loading generative recipe…</div>
  {:else if !$store.workspace}<div class="panel-empty">This composition declares kind "generate" but has no generative() recipe — rebuild it with generative() from framediff, or create a fresh one (＋ in the comp panel, kind GENERATE).</div>
  {:else}
    {@const workspace = $store.workspace}
    <header class="gen-header">
      {#if previewedTake}
        <div>
          <span>HISTORICAL TAKE {previewedTake.take}</span>
          <strong>{previewedTake.settings?.modelName ?? "Saved take"}</strong>
          <small>{previewedTake.settings?.mode ?? previewedTake.endpoint} · read only</small>
        </div>
        <button class="draft-button" disabled={$store.generationActive} onclick={() => void editDraft()}>Back to current draft</button>
      {:else}
        <div><span>GENERATIVE COMPOSITION · {workspace.outputKind}</span><strong>{workspace.modelName}</strong><small class:failed-status={workspace.status === "failed"}>{workspace.mode} · ${workspace.costUsd.toFixed(2)} · {workspace.status}</small></div>
        <select disabled={$store.generationActive || failedAttemptBlocksDraft || $store.busy} aria-label="Generation model" value={workspace.model} onchange={(event) => void viewModel.update({ model: event.currentTarget.value })}>
          {#each workspace.models as model}<option value={model.id}>{model.name} · {model.baseline}</option>{/each}
        </select>
      {/if}
    </header>
    <div class="gen-grid">
      <div
        class="gen-form"
        class:generation-active={$store.generationActive}
        class:failed-history={failedAttemptBlocksDraft}
        aria-busy={$store.generationActive}
        inert={$store.generationActive || failedAttemptBlocksDraft}
      >
        {#if previewedTake}
          <section class="take-inspector">
            {#if previewedTake.settings}
              {@const settings = previewedTake.settings}
              <div class="take-inspector-heading">
                <div><span>TAKE {previewedTake.take} RECIPE</span><strong>Generation settings</strong></div>
                <small>{previewedTake.at ? new Date(previewedTake.at).toLocaleString() : `seed ${previewedTake.seed ?? "—"}`}</small>
              </div>
              <label class="gen-prompt historical"><span>PROMPT</span><textarea value={settings.prompt} readonly></textarea></label>
              {#if settings.acceptsNegativePrompt}
                <label class="gen-prompt historical"><span>NEGATIVE PROMPT</span><textarea value={settings.negativePrompt} readonly></textarea></label>
              {/if}
              <h3>SETTINGS</h3>
              <div class="take-settings">
                <div><span>MODEL</span><strong>{settings.modelName}</strong></div>
                <div><span>MODE</span><strong>{settings.mode}</strong></div>
                {#each settings.params.filter((param) => param.enabled) as param (param.key)}
                  <div><span>{param.label}</span><strong>{String(param.value)}</strong></div>
                {/each}
                <div class="take-endpoint"><span>ENDPOINT</span><code title={settings.endpoint}>{settings.endpoint}</code></div>
              </div>
              <h3>INPUT REFERENCES</h3>
              <div class="take-inputs">
                {#each settings.refs as ref (`${ref.kind}:${ref.src}`)}
                  {@const inputKey = inputCompositionKey(workspace, ref.src)}
                  <div>
                    <b>{ref.kind}</b>
                    {#if inputKey}
                      <button class="ref-link" aria-label={`Open composition ${ref.label}`} title={`Open composition ${ref.label}`} onclick={() => session.navigate(inputKey)}>
                        <span>{ref.label}</span><i aria-hidden="true">↗</i>
                      </button>
                    {:else}
                      <span title={ref.src}>{ref.label}</span>
                    {/if}
                    {#if ref.contentHash}<code title={ref.contentHash}>{ref.contentHash.slice(0, 10)}…</code>{/if}
                  </div>
                {:else}
                  <p>No input references were used.</p>
                {/each}
              </div>
            {:else}
              <div class="take-unavailable">
                <strong>Saved settings unavailable</strong>
                <span>This take predates recipe snapshots and can only be previewed or used as output.</span>
              </div>
            {/if}
            <button class="generate-button" disabled={$store.generationActive || $store.busy || !previewedTake.settings} onclick={() => void startFromSelectedTake()}>{$store.busy ? "Working…" : "Add Take from This"}</button>
            {#if $store.error}<div class="message error">{$store.error}</div>{/if}
          </section>
        {:else}
          <label class="gen-prompt"><span>PROMPT</span><textarea bind:this={promptEditor} bind:value={promptDraft} onblur={() => promptDraft !== workspace.prompt && void viewModel.update({ prompt: promptDraft })}></textarea></label>
          {#if workspace.acceptsNegativePrompt}
            <label class="gen-prompt"><span>NEGATIVE PROMPT</span><textarea bind:value={negativeDraft} onblur={() => negativeDraft !== workspace.negativePrompt && void viewModel.update({ negativePrompt: negativeDraft || undefined })}></textarea></label>
          {/if}
          <div class="gen-params">
            {#each workspace.params as param (param.key)}
              <label><span>{param.label}</span>
                {#if param.type === "enum"}
                  <select disabled={!param.enabled || $store.busy} value={String(param.value)} onchange={(event) => void viewModel.update({ [param.key]: converted(event.currentTarget.value, param.value) })}>
                    {#each param.options ?? [] as option}<option value={String(option)}>{String(option)}</option>{/each}
                  </select>
                {:else}
                  <input type="number" value={Number(param.value)} min={param.min} max={param.max} step={param.step} disabled={!param.enabled || $store.busy} onchange={(event) => void viewModel.update({ [param.key]: Number(event.currentTarget.value) })} />
                {/if}
              </label>
            {/each}
          </div>
          {#if workspace.outputKind !== "audio" && workspace.nativeWidth && workspace.nativeHeight}
            <section class="output-shape">
              <div class="shape-heading">
                <div><h3>OUTPUT SHAPE <small>optional</small></h3><p>Model choices are never filtered by dimensions.</p></div>
                {#if workspace.desiredOutput}
                  <button type="button" onclick={() => void viewModel.update({ desiredOutput: undefined })}>Use model output</button>
                {:else}
                  <button type="button" onclick={() => enableDesiredOutput(workspace)}>Set desired shape</button>
                {/if}
              </div>
              {#if workspace.desiredOutput && outputAdaptation}
                <div class="shape-dimensions">
                  <label><span>WIDTH</span><input type="number" min="1" step="2" bind:value={outputWidth} onblur={() => changeDesiredDimensions(workspace)} /></label>
                  <i>×</i>
                  <label><span>HEIGHT</span><input type="number" min="1" step="2" bind:value={outputHeight} onblur={() => changeDesiredDimensions(workspace)} /></label>
                  <div class="shape-presets">
                    {#each [[1920, 1080], [1080, 1920], [1024, 1024], [1280, 720]] as [width, height]}
                      <button type="button" onclick={() => setDesiredPreset(workspace, width, height)}>{width}×{height}</button>
                    {/each}
                  </div>
                </div>
                <VisualAdaptationEditor
                  sourceWidth={workspace.nativeWidth}
                  sourceHeight={workspace.nativeHeight}
                  targetWidth={Math.max(1, outputWidth)}
                  targetHeight={Math.max(1, outputHeight)}
                  value={outputAdaptation}
                  onchange={(adaptation) => saveDesiredOutput(workspace, adaptation)}
                />
              {:else}
                <div class="shape-native"><strong>{workspace.nativeWidth}×{workspace.nativeHeight}</strong><span>The composition follows whatever shape {workspace.modelName} produces.</span></div>
              {/if}
            </section>
          {/if}
          <section
            role="group"
            aria-label="Generation input references; drop media or a composition to add it"
            class:drag-over={compDragOver}
            class="gen-refs"
            ondragover={dragReferenceOver}
            ondragleave={() => compDragOver = false}
            ondrop={dropReference}
          >
            <h3>INPUT REFERENCES <small>drag media or a composition here</small></h3>
            {#each workspace.refs as ref, index (`${ref.kind}:${ref.src}`)}
              {@const inputKey = inputCompositionKey(workspace, ref.src)}
              <div class:selected={selectedRefIndex === index}>
                <b>{ref.kind}</b>
                {#if inputKey}
                  <span class="ref-body">
                    <button class="ref-link" aria-label={`Open composition ${ref.label}`} title={`Open composition ${ref.label}`} onclick={() => session.navigate(inputKey)}>
                      <span>{ref.label}</span><i aria-hidden="true">↗</i>
                    </button>
                    {#if ref.geometry}
                      <button
                        class="ref-geometry"
                        aria-pressed={selectedRefIndex === index}
                        aria-label={`Adjust how ${ref.label} is adapted for the model`}
                        title={`Adjust how ${ref.label} is adapted for the model`}
                        onclick={() => selectedRefIndex = selectedRefIndex === index ? null : index}
                      >{ref.sourceWidth}×{ref.sourceHeight} → {ref.targetWidth}×{ref.targetHeight} · {ref.adaptation ? ref.adaptation.fit : "pass through"}</button>
                    {/if}
                  </span>
                {:else}
                  <button class="ref-select" aria-pressed={selectedRefIndex === index} onclick={() => selectedRefIndex = selectedRefIndex === index ? null : index}>
                    <span>{ref.label}</span>
                    {#if ref.geometry}<small>{ref.sourceWidth}×{ref.sourceHeight} → {ref.targetWidth}×{ref.targetHeight} · {ref.adaptation ? ref.adaptation.fit : "pass through"}</small>{/if}
                  </button>
                {/if}
                <button aria-label={`Remove ${ref.kind} reference ${ref.label}`} title={`Remove ${ref.label}`} onclick={() => { selectedRefIndex = null; void viewModel.removeRef(index); }}>×</button>
              </div>
            {/each}
            <div class="add-ref">
              <select aria-label="Reference type" bind:value={refKind}>{#each ["image", "endImage", "video", "audio"] as kind}<option value={kind}>{kind}</option>{/each}</select>
              <select
                aria-label="Reference source"
                value={assetId}
                onchange={(event) => {
                  assetId = event.currentTarget.value;
                  const composition = workspace.compositions.find((candidate) => `comp://${candidate.key}` === assetId);
                  if (composition) refKind = composition.outputKind;
                  const asset = $store.assets.find((candidate) => candidate.id === assetId);
                  if (asset) refKind = referenceKindForMime(asset.mime) ?? refKind;
                }}
              >
                <option value="">Select media or composition…</option>
                <optgroup label="Media">{#each $store.assets as asset}<option value={asset.id}>{asset.name}</option>{/each}</optgroup>
                <optgroup label="Compositions">{#each workspace.compositions as composition}<option value={`comp://${composition.key}`}>{composition.id} · {composition.outputKind}</option>{/each}</optgroup>
              </select>
              <button aria-label="Add input reference" disabled={!assetId} onclick={() => addSelectedInput(workspace)}>Add</button>
            </div>
            {#if selectedRef?.geometry && selectedRef.sourceWidth && selectedRef.sourceHeight && selectedRef.targetWidth && selectedRef.targetHeight && selectedRefIndex != null}
              <div class="input-adaptation">
                <div class="shape-heading">
                  <div><h3>INPUT HANDLING</h3><p>Applies only when {selectedRef.label} feeds this recipe.</p></div>
                  {#if refAdaptation}
                    <button type="button" onclick={() => { refAdaptation = undefined; void viewModel.updateRefAdaptation(selectedRefIndex!, undefined); }}>Pass through</button>
                  {:else}
                    <button type="button" onclick={enableRefAdaptation}>Adapt to model</button>
                  {/if}
                </div>
                {#if refAdaptation}
                  <VisualAdaptationEditor
                    sourceWidth={selectedRef.sourceWidth}
                    sourceHeight={selectedRef.sourceHeight}
                    targetWidth={selectedRef.targetWidth}
                    targetHeight={selectedRef.targetHeight}
                    value={refAdaptation}
                    onchange={saveRefAdaptation}
                  />
                {:else}
                  <div class="shape-native"><strong>Source as-is</strong><span>No preprocessing. The provider receives the composition's native bytes.</span></div>
                {/if}
              </div>
            {/if}
          </section>
          {#if !workspace.providerReady}
            <div class="provider-missing">
              <div><strong>{workspace.providerName} credentials required</strong><span>Add the matching API key in Services before running this generation.</span></div>
              <button onclick={onservices}>Open Services</button>
            </div>
          {/if}
          {#if workspace.blockedReason}<div class="message notice">{workspace.blockedReason}</div>{/if}
          <button class="generate-button" disabled={$store.generationActive || failedAttemptBlocksDraft || $store.busy || !workspace.providerReady || !!workspace.blockedReason} onclick={() => void viewModel.generate()}>{$store.busy ? "Working…" : `Generate · $${workspace.costUsd.toFixed(2)}`}</button>
          {#if $store.error}<div class="message error">{$store.error}</div>{/if}
        {/if}
      </div>
      <div class="gen-output">
        <div class="gen-preview">
          {#if previewedTake}
            {#if previewedTake.outputKind === "image"}
              <img src={takeUrl(previewedTake.contentHash)} alt={`Preview of take ${previewedTake.take}`} />
            {:else if previewedTake.outputKind === "audio"}
              <div class="audio-take-preview">
                <span>SEED AUDIO PERFORMANCE</span>
                <strong>Take {previewedTake.take}</strong>
                <!-- svelte-ignore a11y_media_has_caption -->
                <audio src={takeUrl(previewedTake.contentHash)} controls autoplay aria-label={`Preview of take ${previewedTake.take}`}></audio>
              </div>
            {:else}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video
                src={takeUrl(previewedTake.contentHash)}
                controls
                autoplay
                playsinline
                aria-label={`Preview of take ${previewedTake.take}`}
              ></video>
            {/if}
            <span class="preview-label">PREVIEWING TAKE {previewedTake.take}</span>
          {:else}
            <PreviewHost {runtime} {session} interactive={false} />
          {/if}
        </div>
        <div class="takes-heading">
          <h3>TAKES</h3>
          <button
            disabled={$store.generationActive || failedAttemptBlocksDraft || $store.busy || (!!workspace.takes.length && !workspace.takes.at(-1)?.settings)}
            title="Start the next take with the latest generated take's settings"
            onclick={() => void addTake(workspace)}
          >Add Take</button>
        </div>
        {#if $store.message}<div class="message notice">{$store.message}</div>{/if}
        {#each $store.generatingTakes as generatingTake (generatingTake.id)}
          <div class="gen-take generating" role="status" aria-live="polite">
            <div class="take-preview">
              <b>take {generatingTake.take} · generating</b>
              <span>{generatingTake.status === "queued" ? "queued with provider" : "generation in progress"} · {generatingTake.id.slice(0, 8)}…</span>
            </div>
            <div class="take-generating-state">
              <i aria-hidden="true"></i>
              <span>{generatingTake.status}</span>
            </div>
          </div>
        {/each}
        {#each $store.failedTakes.slice().reverse() as failedTake (failedTake.id)}
          <div class="gen-take failed" role="alert">
            <div class="take-preview">
              <b>take {failedTake.take} · failed</b>
              <strong>{failedTake.policyRejection ? "Provider content policy" : "Provider error"}</strong>
              <span>{failedTake.error}</span>
              <small>Attempt saved in framediff.generations.json.</small>
            </div>
            <div class="failed-take-actions">
              <code title={failedTake.id}>{failedTake.id.slice(0, 8)}…</code>
              {#if failedTake.id !== failedDraftStarted}
                <button onclick={() => void startFromFailedTake(failedTake.id)}>Start take {nextTake} from this</button>
              {:else}
                <small>take {nextTake} draft started</small>
              {/if}
            </div>
          </div>
        {/each}
        {#if !$store.generationActive && !failedAttemptBlocksDraft}
          <button
            type="button"
            class="gen-take draft draft-take"
            class:selected={!previewedTake}
            aria-pressed={!previewedTake}
            aria-label={`Edit the draft for take ${nextTake}`}
            onclick={() => void editDraft()}
          >
            <span class="take-preview">
              <b>take {nextTake} · draft</b>
              <span>{previewedTake ? "back to the editable draft" : `editing now — Generate runs it · $${workspace.costUsd.toFixed(2)}`}</span>
            </span>
          </button>
        {/if}
        {#each workspace.takes.slice().reverse() as take (take.take)}
          <div class:pinned={take.take === workspace.pinnedTake} class:selected={take.take === previewTake} class="gen-take">
            <button
              class="take-preview"
              aria-pressed={take.take === previewTake}
              aria-label={`Preview take ${take.take}`}
              onclick={() => previewTake = take.take}
            >
              <b>take {take.take}</b>
              <span>{(take.bytes / 1_000_000).toFixed(1)} MB · seed {take.seed ?? "—"}</span>
            </button>
            <button
              class="take-use"
              disabled={$store.busy || take.take === workspace.pinnedTake}
              aria-label={take.take === workspace.pinnedTake ? `Take ${take.take} in use` : `Use take ${take.take}`}
              title={take.take === workspace.pinnedTake ? "This take is used by the composition" : `Use take ${take.take} in the composition`}
              onclick={() => { previewTake = take.take; void viewModel.pin(take.take); }}
            >{take.take === workspace.pinnedTake ? "In use" : "Use take"}</button>
            <a
              class="take-download"
              href={takeUrl(take.contentHash)}
              download={`${workspace.recipeId}-take-${take.take}.${takeExtension(take.outputKind)}`}
              aria-label={`Download take ${take.take}`}
              title={`Download take ${take.take}`}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15.5h12" /></svg>
              <span>Download</span>
            </a>
          </div>
        {/each}
        {#if !workspace.takes.length && !$store.generatingTakes.length && !$store.failedTakes.length}
          <div class="panel-empty">Generated takes land here and are pinned into source.</div>
        {/if}
      </div>
    </div>
  {/if}
</section>
