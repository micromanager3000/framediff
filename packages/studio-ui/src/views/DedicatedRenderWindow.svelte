<script lang="ts">
  import type { RenderViewModel } from "../viewmodels/Render.ViewModel";
  import RenderControl from "./RenderControl.svelte";

  export let viewModel: RenderViewModel;
  export let compositionName: string;
  const store = viewModel.store;
</script>

<svelte:head><title>FrameDiff — {$store.status === "done" ? "Render complete" : "Rendering"}</title></svelte:head>

<main class="dedicated-render-window">
  <header><span class="mark"></span><strong>FRAMEDIFF</strong><small>DEDICATED RENDERER</small></header>
  <section>
    <div>
      <span>{$store.status === "done" ? "COMPLETE" : $store.status === "error" ? "FAILED" : "RENDERING"}</span>
      <strong>{compositionName || "Composition"}</strong>
      <p>
        {#if $store.status === "done"}
          The MP4 download has started. You can close this window.
        {:else if $store.status === "error"}
          {$store.error ?? "The render failed."}
        {:else}
          Keep this window open. It stays separate so Chrome can keep frame capture active in the background.
        {/if}
      </p>
    </div>
    <RenderControl {viewModel} />
  </section>
  {#if $store.status === "done" || $store.status === "error"}
    <button class="render-window-close" onclick={() => window.close()}>Close window</button>
  {/if}
</main>
