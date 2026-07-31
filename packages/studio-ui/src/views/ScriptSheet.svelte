<script lang="ts">
  import { FRAMEDIFF_ASSET_DRAG_MIME, parseFramediffAssetDragPayload } from "@framediff/studio-model";
  import type { CompositionRuntimePort, ScriptSheetRowSnapshot } from "@framediff/studio-model";
  import type { ScriptViewModel } from "../viewmodels/Script.ViewModel";
  import ScriptSourcePreview from "./ScriptSourcePreview.svelte";

  export let viewModel: ScriptViewModel;
  export let runtime: CompositionRuntimePort;

  const store = viewModel.store;
  let tab: "script" | "preview" = "script";
  let draggingId: string | null = null;

  $: fps = $store.composition?.fps ?? 30;
  $: rows = $store.sheet?.rows ?? [];
  $: totalFrames = rows.reduce((total, row) => Math.max(total, row.from + row.durationInFrames), 0);
  $: activeIndex = Math.max(0, rows.findIndex((row) =>
    $store.frame >= row.from && $store.frame < row.from + row.durationInFrames));
  $: activeRow = rows[activeIndex];

  const time = (frames: number): string => {
    const seconds = Math.max(0, frames / Math.max(1, fps));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  };
  const duration = (frames: number): string => (frames / Math.max(1, fps)).toFixed(1);
  const sourceLabel = (row: ScriptSheetRowSnapshot): string => {
    if (!row.source) return "No source";
    if (row.source.type === "nested") {
      return $store.compositions.find((entry) =>
        entry.key === row.source?.compId || entry.id === row.source?.compId)?.id ?? row.source.compId ?? "Composition";
    }
    const assetId = row.source.src?.startsWith("asset://") ? row.source.src.slice("asset://".length) : "";
    return $store.assets.find((asset) => asset.id === assetId)?.name ?? row.source.src ?? row.source.type;
  };
  const sourceSelection = (row: ScriptSheetRowSnapshot): string => {
    if (row.source?.type !== "nested" || !row.source.compId) return "";
    return $store.compositions.find((entry) =>
      entry.key === row.source?.compId || entry.id === row.source?.compId)?.key ?? row.source.compId;
  };

  function commitDuration(row: ScriptSheetRowSnapshot, raw: string): void {
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    void viewModel.retime(row.id, Math.max(1, Math.round(seconds * fps)));
  }

  function moveDown(index: number): void {
    const row = rows[index];
    if (!row || index >= rows.length - 1) return;
    void viewModel.move(row.id, rows[index + 2]?.id ?? null);
  }

  function attachAsset(rowId: string, raw: string): void {
    const payload = parseFramediffAssetDragPayload(raw);
    if (!payload) return;
    const type = payload.mime.startsWith("image/")
      ? "image"
      : payload.mime.startsWith("audio/")
        ? "audio"
        : payload.mime.startsWith("video/")
          ? "video"
          : null;
    if (type) void viewModel.setSource(rowId, { type, src: `asset://${payload.id}` });
  }

  function previewRow(row: ScriptSheetRowSnapshot): void {
    viewModel.setFrame(row.from);
    tab = "preview";
  }
</script>

<section class="script-workbench" aria-label="Script sheet">
  <nav class="script-tabs" aria-label="Script views">
    <button class:active={tab === "script"} onclick={() => tab = "script"}>SCRIPT</button>
    <button class:active={tab === "preview"} onclick={() => tab = "preview"}>PREVIEW</button>
    <span>{rows.length} SCENES · {time(totalFrames)}</span>
  </nav>

  {#if tab === "script"}
    <div class="script-scroll">
      <article class="script-sheet">
        <header class="script-sheet-header">
          <div>
            <span class="script-kicker">SCRIPT · TIMING TRUTH</span>
            <h1>{$store.composition?.id ?? "Script"}</h1>
            {#if $store.sheet?.summary}
              <textarea
                class="script-summary"
                aria-label="Script notes"
                rows="2"
                value={$store.sheet.summary.text}
                placeholder="Logline, intent, constraints…"
                onblur={(event) => {
                  const field = $store.sheet?.summary;
                  if (field && event.currentTarget.value !== field.text) void viewModel.editText(field.elementId, event.currentTarget.value);
                }}
              ></textarea>
            {/if}
          </div>
          <div class="script-running-time"><strong>{time(totalFrames)}</strong><span>TOTAL RUNNING TIME</span><small>{rows.length} scene{rows.length === 1 ? "" : "s"} · {totalFrames}f @ {fps}</small></div>
        </header>

        <div class="script-columns" aria-hidden="true">
          <span></span><span>TIME</span><span>DURATION</span><span>NARRATION / DIALOG</span><span>VISUAL / SFX</span><span>SOURCE</span>
        </div>

        <div class="script-rows" role="list" aria-label="Script scenes">
          {#each rows as row, index (row.id)}
            <section
              class="script-row"
              role="listitem"
              class:active={$store.frame >= row.from && $store.frame < row.from + row.durationInFrames}
              draggable="true"
              ondragstart={(event) => {
                draggingId = row.id;
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
              }}
              ondragover={(event) => {
                if (draggingId && draggingId !== row.id) event.preventDefault();
              }}
              ondrop={(event) => {
                event.preventDefault();
                if (draggingId && draggingId !== row.id) void viewModel.move(draggingId, row.id);
                draggingId = null;
              }}
              ondragend={() => draggingId = null}
            >
              <div class="script-row-actions">
                <button class="script-grip" title="Drag to reorder" aria-label={`Reorder ${row.fields.title.text || row.name || row.id}`}>⠿</button>
                <button onclick={() => previewRow(row)} title="Preview scene" aria-label="Preview scene">▶</button>
                <button onclick={() => void viewModel.move(row.id, rows[index - 1]?.id ?? row.id)} disabled={index === 0} title="Move up">↑</button>
                <button onclick={() => moveDown(index)} disabled={index === rows.length - 1} title="Move down">↓</button>
                <button class="danger" onclick={() => void viewModel.remove(row.id)} title="Delete scene" aria-label="Delete scene">×</button>
              </div>
              <button class="script-time" onclick={() => viewModel.setFrame(row.from)} title="Move playhead to scene">
                <strong>{time(row.from)}</strong><span>→ {time(row.from + row.durationInFrames)}</span>
              </button>
              <label class="script-duration">
                <input
                  aria-label={`Duration for ${row.fields.title.text || row.id} in seconds`}
                  type="number"
                  min={1 / fps}
                  step="0.1"
                  value={duration(row.durationInFrames)}
                  onkeydown={(event) => {
                    if (event.key === "Enter") {
                      commitDuration(row, event.currentTarget.value);
                      event.currentTarget.blur();
                    }
                  }}
                  onblur={(event) => commitDuration(row, event.currentTarget.value)}
                />
                <span>SEC · {row.durationInFrames}f</span>
              </label>
              <div class="script-prose">
                <input
                  class="script-scene-title"
                  aria-label="Scene title"
                  value={row.fields.title.text}
                  placeholder={row.name ?? "Untitled scene"}
                  onblur={(event) => {
                    if (event.currentTarget.value !== row.fields.title.text) void viewModel.editText(row.fields.title.elementId, event.currentTarget.value);
                  }}
                />
                <textarea
                  aria-label="Narration or dialog"
                  rows="3"
                  value={row.fields.narration.text}
                  placeholder="Narration or dialog…"
                  onblur={(event) => {
                    if (event.currentTarget.value !== row.fields.narration.text) void viewModel.editText(row.fields.narration.elementId, event.currentTarget.value);
                  }}
                ></textarea>
              </div>
              <div class="script-prose script-visual">
                <textarea
                  aria-label="Visual"
                  rows="3"
                  value={row.fields.visual.text}
                  placeholder="Describe the visual…"
                  onblur={(event) => {
                    if (event.currentTarget.value !== row.fields.visual.text) void viewModel.editText(row.fields.visual.elementId, event.currentTarget.value);
                  }}
                ></textarea>
                <label><span>SFX</span><input
                  aria-label="Sound effects"
                  value={row.fields.sfx.text}
                  placeholder="Sound effects…"
                  onblur={(event) => {
                    if (event.currentTarget.value !== row.fields.sfx.text) void viewModel.editText(row.fields.sfx.elementId, event.currentTarget.value);
                  }}
                /></label>
              </div>
              <div
                class="script-source"
                role="group"
                aria-label="Scene source"
                ondragover={(event) => {
                  if (event.dataTransfer?.types.includes(FRAMEDIFF_ASSET_DRAG_MIME)) event.preventDefault();
                }}
                ondrop={(event) => {
                  event.stopPropagation();
                  attachAsset(row.id, event.dataTransfer?.getData(FRAMEDIFF_ASSET_DRAG_MIME) ?? "");
                }}
              >
                <span>{sourceLabel(row)}</span>
                <select
                  aria-label={`Source for ${row.fields.title.text || row.id}`}
                  value={sourceSelection(row)}
                  onchange={(event) => {
                    if (event.currentTarget.value) void viewModel.setSource(row.id, { type: "nested", compId: event.currentTarget.value });
                  }}
                >
                  <option value="">ATTACH COMP…</option>
                  {#each $store.compositions.filter((composition) => composition.key !== $store.compositionKey && composition.kind !== "script") as composition (composition.key)}
                    <option value={composition.key}>{composition.id} · {composition.kind}</option>
                  {/each}
                </select>
                <small>Choose a comp or drop media from the Media panel</small>
              </div>
            </section>
          {/each}
        </div>

        <button class="script-add" onclick={() => void viewModel.insert(null, Math.round(fps * 3))}>＋ SCENE</button>
      </article>
    </div>
  {:else}
    <div class="script-preview">
      {#if activeRow}
        <div class="script-monitor">
          <ScriptSourcePreview
            {runtime}
            source={activeRow.source}
            compositions={$store.compositions}
            assets={$store.assets}
            frame={Math.max(0, $store.frame - activeRow.from)}
            {fps}
            playing={$store.playing}
          />
          <div class="script-preview-slate"><span>{time(activeRow.from)} · {activeRow.fields.title.text}</span><p>{activeRow.fields.visual.text}</p>{#if activeRow.fields.sfx.text}<small>SFX · {activeRow.fields.sfx.text}</small>{/if}</div>
          {#if activeRow.fields.narration.text}<div class="script-preview-caption">{activeRow.fields.narration.text}</div>{/if}
        </div>
        <div class="script-preview-transport">
          <button onclick={() => viewModel.setFrame(rows[Math.max(0, activeIndex - 1)]?.from ?? 0)} aria-label="Previous scene">⏮</button>
          <button onclick={() => viewModel.togglePlaying()} aria-label={$store.playing ? "Pause" : "Play"}>{$store.playing ? "❚❚" : "▶"}</button>
          <button onclick={() => viewModel.setFrame(rows[Math.min(rows.length - 1, activeIndex + 1)]?.from ?? 0)} aria-label="Next scene">⏭</button>
          <span>{time($store.frame)}</span>
          <input
            type="range"
            min="0"
            max={Math.max(0, totalFrames - 1)}
            value={$store.frame}
            aria-label="Script preview frame"
            oninput={(event) => viewModel.setFrame(Number(event.currentTarget.value))}
          />
          <span>{time(totalFrames)}</span>
        </div>
      {:else}
        <div class="script-empty">Add a scene to preview the script.</div>
      {/if}
    </div>
  {/if}

  {#if $store.loading}<div class="script-status">LOADING SCRIPT…</div>{/if}
  {#if $store.error}<div class="script-status error">{$store.error}</div>{/if}
</section>
