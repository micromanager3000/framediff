<script lang="ts">
  import type { ProjectRenderSnapshot } from "@framediff/studio-model";
  import type { RenderViewModel } from "../viewmodels/Render.ViewModel";

  export let viewModel: RenderViewModel;
  export let onClose: () => void;
  const store = viewModel.store;
  let copiedId = "";
  let copyError = "";

  const activeStates = new Set(["queued", "starting", "rendering", "uploading"]);

  function stateLabel(state: ProjectRenderSnapshot["state"]): string {
    if (state === "succeeded") return "READY";
    if (state === "failed") return "FAILED";
    if (state === "cancelled") return "CANCELLED";
    if (state === "uploading") return "PUBLISHING";
    return state.toUpperCase();
  }

  function renderedAt(entry: ProjectRenderSnapshot): string {
    const date = new Date(entry.completedAt ?? entry.updatedAt ?? entry.createdAt);
    if (!Number.isFinite(date.valueOf())) return "unknown time";
    const seconds = Math.round((date.valueOf() - Date.now()) / 1_000);
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
    return formatter.format(Math.round(hours / 24), "day");
  }

  function fileSize(bytes: number): string {
    if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
    return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`;
  }

  function artifactDetails(entry: ProjectRenderSnapshot): string[] {
    const artifact = entry.artifact;
    if (!artifact) return [];
    return [
      artifact.width && artifact.height ? `${artifact.width}×${artifact.height}` : "",
      artifact.durationSeconds ? `${artifact.durationSeconds.toFixed(1)}s` : "",
      fileSize(artifact.bytes),
    ].filter(Boolean);
  }

  function progressPercent(entry: ProjectRenderSnapshot): number | null {
    const progress = entry.progress;
    if (!progress || progress.total <= 1) return null;
    return Math.max(0, Math.min(100, Math.round(progress.completed / progress.total * 100)));
  }

  async function copyManifest(renderId: string): Promise<void> {
    const manifest = viewModel.manifest(renderId);
    if (!manifest) return;
    copyError = "";
    try {
      await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
      copiedId = renderId;
      window.setTimeout(() => { if (copiedId === renderId) copiedId = ""; }, 1_800);
    } catch (error) {
      copyError = error instanceof Error ? error.message : "Could not copy the render manifest.";
    }
  }
</script>

<div class="render-library" role="dialog" aria-label="Project render library">
  <header>
    <div>
      <strong>RENDER LIBRARY</strong>
      <span>durable project history · latest {$store.library.entries.length} render{$store.library.entries.length === 1 ? "" : "s"}</span>
    </div>
    <div class="render-library-header-actions">
      <button
        class:spinning={$store.library.loading}
        onclick={() => void viewModel.refreshLibrary()}
        disabled={$store.library.loading}
        aria-label="Refresh render library"
        title="Refresh render library"
      ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-2-4.24"/><path d="M13.7 2.3v3.2h-3.2"/></svg></button>
      <button onclick={onClose} aria-label="Close render library" title="Close render library">×</button>
    </div>
  </header>

  {#if $store.library.error || copyError}
    <div class="render-library-error" role="alert">
      <span>{$store.library.error ?? copyError}</span>
      <button onclick={() => { if (copyError) copyError = ""; else void viewModel.refreshLibrary(); }}>{copyError ? "DISMISS" : "TRY AGAIN"}</button>
    </div>
  {/if}

  {#if $store.library.loading && !$store.library.entries.length}
    <div class="render-library-empty"><span class="render-library-loader"></span><strong>Loading renders…</strong><small>Reading this project’s cloud render history.</small></div>
  {:else if !$store.library.entries.length}
    <div class="render-library-empty"><span class="render-library-empty-mark">◇</span><strong>No cloud renders yet</strong><small>Your next render will stay here with its artifact, provenance, and JSON manifest.</small></div>
  {:else}
    <div class="render-library-list">
      {#each $store.library.entries as entry (entry.id)}
        {@const percent = progressPercent(entry)}
        {@const busy = $store.library.action?.id === entry.id}
        <article class:active={activeStates.has(entry.state)} class:failed={entry.state === "failed"}>
          <div class="render-library-row">
            <div class="render-library-identity">
              <span class="render-library-state state-{entry.state}">{stateLabel(entry.state)}</span>
              <div>
                <strong>{entry.compositionKey}</strong>
                <span>{renderedAt(entry)} · {entry.id.slice(0, 8)}</span>
              </div>
            </div>
            {#if entry.parentRenderId}<span class="render-library-retry-badge">RETRY {entry.attempt}</span>{/if}
          </div>

          {#if entry.artifact}
            <div class="render-library-artifact">
              <div><span class="render-library-file-icon">▶</span><strong>{entry.artifact.filename}</strong></div>
              <span>{artifactDetails(entry).join(" · ")}</span>
            </div>
          {:else if activeStates.has(entry.state)}
            <div class="render-library-progress">
              <div><span>{entry.progress?.message || (entry.state === "rendering" ? "AWS is rendering the artifact" : `${stateLabel(entry.state).toLowerCase()}…`)}</span>{#if percent != null}<b>{percent}%</b>{/if}</div>
              <span class:indeterminate={percent == null}><i style:width={percent == null ? "34%" : `${percent}%`}></i></span>
            </div>
          {:else if entry.failure}
            <div class="render-library-failure"><strong>{entry.failure.code.replace(/_/g, " ")}</strong><span>{entry.failure.message}</span></div>
          {/if}

          <footer>
            <button class="manifest" onclick={() => void copyManifest(entry.id)} disabled={busy}>{copiedId === entry.id ? "COPIED JSON" : "COPY JSON"}</button>
            <span></span>
            {#if entry.state === "succeeded" && entry.artifact}
              <button class="primary" onclick={() => void viewModel.download(entry.id)} disabled={busy}>{busy ? "PREPARING…" : "DOWNLOAD"}</button>
            {:else if entry.state === "failed" && entry.failure?.retryable}
              <button class="primary" onclick={() => void viewModel.retry(entry.id)} disabled={busy}>{busy ? "RETRYING…" : "RETRY"}</button>
            {:else if activeStates.has(entry.state)}
              <button onclick={() => void viewModel.cancel(entry.id)} disabled={busy}>{busy ? "CANCELLING…" : "CANCEL"}</button>
            {/if}
          </footer>
        </article>
      {/each}
    </div>
  {/if}
</div>
