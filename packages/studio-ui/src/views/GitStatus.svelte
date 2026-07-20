<script lang="ts">
  import type { GitViewModel } from "../viewmodels/Git.ViewModel";

  export let viewModel: GitViewModel;
  export let statusLabel: string | null = null;
  const store = viewModel.store;
  let open = false;
  let message = "Update FrameDiff project";
  $: connectedStatus = statusLabel?.startsWith("github ·") && !statusLabel.includes("error");

  async function checkpoint(): Promise<void> {
    if (await viewModel.commit(message)) open = false;
  }
</script>

<div class="git-status">
  <button
    class:clean={statusLabel === null ? $store.dirty?.length === 0 : connectedStatus}
    class="git-chip"
    title={statusLabel ?? ($store.dirty?.length ? `${$store.dirty.length} uncommitted files — click to review and commit` : "Working tree is clean")}
    onclick={() => { if (statusLabel === null) open = !open; }}
  >
    <span></span>
    {statusLabel ?? ($store.dirty == null ? "local git unavailable" : $store.dirty.length ? `${$store.dirty.length} changed` : "synced")}
  </button>
  {#if open && statusLabel === null}
    <div class="git-popover">
      <strong>CHECKPOINT</strong>
      <small>{$store.dirty?.length ?? 0} project files changed</small>
      <input bind:value={message} aria-label="Commit message" />
      <div>
        <button onclick={() => { open = false; }}>Cancel</button>
        <button class="primary" onclick={() => void checkpoint()} disabled={$store.committing || !$store.dirty?.length}>
          {$store.committing ? "Committing…" : "Commit"}
        </button>
      </div>
      {#if $store.error}<p>{$store.error}</p>{/if}
    </div>
  {/if}
</div>
