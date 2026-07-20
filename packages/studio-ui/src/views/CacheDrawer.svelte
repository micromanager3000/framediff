<script lang="ts">
  import { cacheEntryMatchesSearch, type OperationsViewModel } from "../viewmodels/Operations.ViewModel";
  export let viewModel: OperationsViewModel;
  export let onclose: () => void;
  const store = viewModel.store;
  let search = "";
  const size = (bytes: number) => bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;
  $: filteredCache = $store.cache.filter((entry) => cacheEntryMatchesSearch(entry, search));
</script>

<aside class="cache-drawer" aria-label="Cache">
  <header><strong>CACHE</strong><button onclick={onclose} aria-label="Close cache">×</button></header>
  <div class="cache-actions">
    <button onclick={() => void viewModel.bakeCurrent()} disabled={$store.busy}>{$store.busy ? "Baking…" : "Bake current"}</button>
    <button onclick={() => void viewModel.refreshCache()}>Refresh</button>
  </div>
  <label class="cache-filter"><span>⌕</span><input bind:value={search} type="search" placeholder="Find an artifact…" aria-label="Find cached artifact" />{#if search}<button onclick={() => search = ""} aria-label="Clear cache search">×</button>{/if}<output>{filteredCache.length}/{$store.cache.length}</output></label>
  {#if $store.progress}<div class="cache-progress">{$store.progress.phase} · {Math.round($store.progress.completed / Math.max(1, $store.progress.total) * 100)}%</div>{/if}
  <div class="cache-list">
    {#each filteredCache as entry (entry.name)}
      <div><code>{(entry.filename ?? entry.name).slice(0, 24)}…</code><span>{entry.label ?? entry.compId ?? "artifact"}<small>{size(entry.size)}</small></span></div>
    {:else}<div class="panel-empty">{search ? "No cached artifacts match that search." : "No cached artifacts."}</div>{/each}
  </div>
  {#if $store.error}<div class="message error">{$store.error}</div>{/if}
</aside>
