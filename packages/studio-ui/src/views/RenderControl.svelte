<script lang="ts">
  import type { RenderViewModel } from "../viewmodels/Render.ViewModel";

  export let viewModel: RenderViewModel;
  const store = viewModel.store;
  $: progress = $store.progress ? Math.round(($store.progress.completed / Math.max(1, $store.progress.total)) * 100) : 0;
</script>

<div class="render-control">
  {#if $store.status === "rendering"}
    <span class="render-progress">{$store.progress?.phase ?? "prepare"} · {progress}%</span>
  {:else if $store.status === "done"}
    <span class="render-done">{$store.filename} · {($store.bytes / 1_000_000).toFixed(1)} MB</span>
  {:else if $store.status === "error"}
    <span class="render-error" title={$store.error ?? ""}>render failed</span>
  {/if}
  <button class="render" disabled={$store.status === "rendering"} onclick={() => void viewModel.render()}>
    {$store.status === "rendering" ? "Rendering…" : "Render MP4"}
  </button>
</div>
