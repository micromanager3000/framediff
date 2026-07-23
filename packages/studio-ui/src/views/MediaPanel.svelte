<script lang="ts">
  import { FRAMEDIFF_ASSET_DRAG_MIME } from "@framediff/studio-model";
  import { assetMatchesFilter, type MediaKindFilter, type MediaViewModel } from "../viewmodels/Media.ViewModel";

  export let viewModel: MediaViewModel;
  export let onselect: () => void = () => {};
  const store = viewModel.store;
  let fileInput: HTMLInputElement;
  let query = "";
  let kind: MediaKindFilter = "all";

  const size = (bytes: number) => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1_000)} KB`;
  const assetUrl = (contentHash: string) => `/__framediff-cache/${encodeURIComponent(contentHash)}`;
  $: filteredAssets = $store.assets.filter((asset) => assetMatchesFilter(asset, query, kind));
</script>

<aside class="media-panel" aria-label="Media">
  <div class="media-actions">
    <input
      bind:this={fileInput}
      class="visually-hidden"
      type="file"
      multiple
      accept="video/*,audio/*,image/*,.cube,.gltf,.glb"
      onchange={(event) => {
        if (event.currentTarget.files?.length) void viewModel.upload(event.currentTarget.files);
        event.currentTarget.value = "";
      }}
    />
    <button onclick={() => fileInput.click()} disabled={$store.uploading}>
      {$store.uploading ? "IMPORTING…" : "+ IMPORT MEDIA"}
    </button>
    <button class="icon-button" onclick={() => void viewModel.refresh()} title="Refresh media">↻</button>
  </div>

  {#if $store.assets.length}
    <div class="media-tools">
      <label class="media-search"><span>⌕</span><input bind:value={query} type="search" placeholder="Find media…" aria-label="Find media" />{#if query}<button onclick={() => query = ""} aria-label="Clear media search">×</button>{/if}</label>
      <select bind:value={kind} aria-label="Filter media by type">
        <option value="all">ALL</option>
        <option value="video">VIDEO</option>
        <option value="audio">AUDIO</option>
        <option value="image">IMAGE</option>
        <option value="other">OTHER</option>
      </select>
      <output aria-label="Media result count">{filteredAssets.length}/{ $store.assets.length}</output>
    </div>
  {/if}

  {#if $store.loading && !$store.assets.length}
    <div class="panel-empty">Loading framediff.assets.json…</div>
  {:else if !$store.assets.length}
    <div class="panel-empty">Drop source media into the project by importing it here.</div>
  {:else}
    <div class="asset-list">
      {#each filteredAssets as asset (asset.id)}
        <button
          type="button"
          class="asset-row"
          class:selected={$store.selected?.id === asset.id}
          draggable="true"
          title={`Preview ${asset.name} · asset://${asset.id}`}
          aria-pressed={$store.selected?.id === asset.id}
          ondragstart={(event) => {
            event.dataTransfer?.setData(FRAMEDIFF_ASSET_DRAG_MIME, JSON.stringify({
              id: asset.id,
              name: asset.name,
              mime: asset.mime,
            }));
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
          }}
          onclick={() => {
            viewModel.select(asset.id);
            onselect();
          }}
        >
          <span class="asset-thumbnail">
            {#if asset.mime.startsWith("image/")}
              <img src={assetUrl(asset.previewContentHash ?? asset.contentHash)} alt="" loading="lazy" />
            {:else if asset.mime.startsWith("video/")}
              <video src={`${assetUrl(asset.previewContentHash ?? asset.contentHash)}#t=0.001`} muted playsinline preload="metadata" aria-hidden="true"></video>
            {:else}
              <span class="asset-icon">{asset.mime.startsWith("audio/") ? "♒" : "◆"}</span>
            {/if}
          </span>
          <span class="asset-name">{asset.name}<small>{asset.mime} · {size(asset.bytes)}</small></span>
          <code>{asset.id.slice(0, 6)}</code>
        </button>
      {:else}<div class="panel-empty">No media matches this search and type filter.</div>{/each}
    </div>
  {/if}
  {#if $store.error}<div class="message error">{$store.error}</div>{/if}
</aside>
