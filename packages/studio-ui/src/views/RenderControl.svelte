<script lang="ts">
  import type { RenderViewModel } from "../viewmodels/Render.ViewModel";

  export let viewModel: RenderViewModel;
  export let showTargets = true;
  const store = viewModel.store;
  let menuOpen = false;
  let control: HTMLDivElement;
  $: progress = $store.progress ? Math.round(($store.progress.completed / Math.max(1, $store.progress.total)) * 100) : 0;
  $: batchPrefix = $store.batch && $store.batch.total > 1
    ? `${$store.batch.current}/${$store.batch.total} · `
    : "";
  $: selectedName = $store.selectedTargetName ?? "MP4";

  function closeMenuFromOutside(event: PointerEvent): void {
    if (menuOpen && control && !control.contains(event.target as Node)) menuOpen = false;
  }

  function closeMenuFromKeyboard(event: KeyboardEvent): void {
    if (menuOpen && event.key === "Escape") {
      event.preventDefault();
      menuOpen = false;
    }
  }

  function selectTarget(compositionKey: string): void {
    viewModel.selectTarget(compositionKey);
    menuOpen = false;
  }

  function renderAll(): void {
    menuOpen = false;
    void viewModel.renderAll();
  }
</script>

<svelte:window onpointerdown={closeMenuFromOutside} onkeydown={closeMenuFromKeyboard} />

<div class="render-control" bind:this={control}>
  {#if $store.status === "rendering"}
    <span class="render-progress">{batchPrefix}{$store.progress?.phase ?? "prepare"} · {progress}%</span>
  {:else if $store.status === "done"}
    <span class="render-done">{$store.filename} · {($store.bytes / 1_000_000).toFixed(1)} MB</span>
  {:else if $store.status === "error"}
    <span class="render-error" title={$store.error ?? ""}>render failed</span>
  {/if}
  {#if showTargets}
    <div class="render-split">
      <button
        class="render render-primary"
        disabled={$store.status === "rendering" || !$store.selectedTargetKey}
        onclick={() => void viewModel.render()}
        title={`Render ${selectedName} as MP4`}
      >
        {$store.status === "rendering" ? "Rendering…" : `Render ${selectedName}`}
      </button>
      <button
        class="render render-menu-toggle"
        class:active={menuOpen}
        disabled={$store.status === "rendering"}
        onclick={() => menuOpen = !menuOpen}
        aria-label="Choose render target"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Choose render target or render all"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="m2 3.5 3 3 3-3"/></svg>
      </button>
      {#if menuOpen}
        <div class="render-menu" role="menu" aria-label="Render target">
          <div class="render-menu-label">RENDER TARGET</div>
          {#each $store.targets as target (target.key)}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={target.key === $store.selectedTargetKey}
              class:selected={target.key === $store.selectedTargetKey}
              onclick={() => selectTarget(target.key)}
            >
              <span>{target.name}</span>
              {#if target.key === $store.selectedTargetKey}<b>SELECTED</b>{/if}
            </button>
          {/each}
          {#if $store.targets.length > 1}
            <div class="render-menu-divider"></div>
            <button type="button" class="render-all" role="menuitem" onclick={renderAll}>
              <span>Render all</span>
              <b>{$store.targets.length} VIDEOS</b>
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <button class="render" disabled={$store.status === "rendering"} onclick={() => void viewModel.renderCurrentComposition()}>
      {$store.status === "rendering" ? "Rendering…" : "Render MP4"}
    </button>
  {/if}
</div>
