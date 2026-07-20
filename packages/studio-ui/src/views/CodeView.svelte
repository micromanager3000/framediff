<script lang="ts">
  import type { CodeViewModel } from "../viewmodels/Code.ViewModel";

  export let viewModel: CodeViewModel;
  const store = viewModel.store;
</script>

<aside class="code-panel" aria-label="Source code">
  <header class="code-header">
    <span title={$store.file ?? ""}>{$store.file?.split("/").pop() ?? "NO SOURCE"}</span>
    <button onclick={() => void viewModel.refresh()} title="Refresh source">↻</button>
  </header>
  {#if $store.loading && !$store.text}
    <div class="panel-empty">Reading source…</div>
  {:else if $store.error}
    <div class="message error">{$store.error}</div>
  {:else if $store.text}
    <pre><code>{$store.text}</code></pre>
  {:else}
    <div class="panel-empty">This composition does not declare a source file.</div>
  {/if}
</aside>
