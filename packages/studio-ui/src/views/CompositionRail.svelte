<script lang="ts">
  import type { CompositionKind } from "@framediff/studio-model";
  import { compositionMatchesSearch, type CompositionRailViewModel } from "../viewmodels/CompositionRail.ViewModel";

  export let viewModel: CompositionRailViewModel;
  export let onnewcomposition: () => void;
  export let onduplicate: (compositionKey: string) => void;
  export let oncopytolibrary: (compositionKey: string) => void;
  export let onnest: (targetKey: string, sourceKey: string) => void;
  export let ondelete: (compositionKey: string) => void;
  export let onopen: () => void = () => {};
  const store = viewModel.store;

  const glyph: Record<CompositionKind, string> = {
    edit: "⌗",
    custom: "⌘",
    "3d": "◇",
    generate: "✦",
    audio: "♒",
    doc: "¶",
    plan: "▤",
    scene: "▣",
    board: "▢",
    moodboard: "▦",
    script: "☰",
    storyboard: "⊞",
    locations: "⌖",
    cast: "♟",
  };
  const COMP_DRAG_MIME = "application/x-framediff-comp";
  // dataTransfer payloads are sealed until drop — the key rides here for dragover feedback
  let draggedKey: string | null = null;
  let nestTargetKey: string | null = null;
  let libraryDragDepth = 0;
  // delete is two clicks: the first arms the button, leaving the row disarms
  let confirmDeleteKey: string | null = null;
  let search = "";

  $: filteredPrimary = $store.primary.filter((row) => compositionMatchesSearch(row.composition, search));
  $: filteredLibrary = $store.library.filter((composition) => compositionMatchesSearch(composition, search));

  function requestDelete(key: string): void {
    if (confirmDeleteKey === key) {
      confirmDeleteKey = null;
      ondelete(key);
    } else {
      confirmDeleteKey = key;
    }
  }

  function disarmDelete(key: string): void {
    if (confirmDeleteKey === key) confirmDeleteKey = null;
  }

  function startCompositionDrag(event: DragEvent, key: string): void {
    event.dataTransfer?.setData(COMP_DRAG_MIME, key);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    draggedKey = key;
  }

  function endCompositionDrag(): void {
    draggedKey = null;
    nestTargetKey = null;
    libraryDragDepth = 0;
  }

  function isCompositionDrag(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes(COMP_DRAG_MIME) ?? false;
  }

  function rowDragOver(event: DragEvent, targetKey: string): void {
    if (!isCompositionDrag(event) || !draggedKey) return;
    event.preventDefault();
    event.stopPropagation();
    const allowed = viewModel.canNest(draggedKey, targetKey);
    if (event.dataTransfer) event.dataTransfer.dropEffect = allowed ? "copy" : "none";
    nestTargetKey = allowed ? targetKey : null;
  }

  function rowDragLeave(event: DragEvent, targetKey: string): void {
    const item = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && item.contains(event.relatedTarget)) return;
    if (nestTargetKey === targetKey) nestTargetKey = null;
  }

  function rowDrop(event: DragEvent, targetKey: string): void {
    if (!isCompositionDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceKey = event.dataTransfer?.getData(COMP_DRAG_MIME) || draggedKey;
    endCompositionDrag();
    if (sourceKey && viewModel.canNest(sourceKey, targetKey)) onnest(targetKey, sourceKey);
  }

  function libraryDragEnter(event: DragEvent): void {
    if (isCompositionDrag(event)) libraryDragDepth += 1;
  }

  function libraryDragOver(event: DragEvent): void {
    if (!isCompositionDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function libraryDragLeave(event: DragEvent): void {
    if (isCompositionDrag(event)) libraryDragDepth = Math.max(0, libraryDragDepth - 1);
  }

  function libraryDrop(event: DragEvent): void {
    if (!isCompositionDrag(event)) return;
    event.preventDefault();
    const key = event.dataTransfer?.getData(COMP_DRAG_MIME) || draggedKey;
    endCompositionDrag();
    if (key) oncopytolibrary(key);
  }
</script>

<aside class="rail" aria-label="Compositions">
  <div class="section-title">
    COMPOSITIONS <span>{search ? `${filteredPrimary.length}/${$store.primary.length}` : $store.primary.length}</span>
    <button class="rail-new" onclick={onnewcomposition} title="Create a new composition" aria-label="Create a new composition">＋</button>
  </div>
  <label class="composition-search"><span>⌕</span><input bind:value={search} type="search" placeholder="Find a composition or feature…" aria-label="Find a composition" />{#if search}<button onclick={() => search = ""} aria-label="Clear composition search">×</button>{/if}</label>
  <div class="composition-list" role="list">
      {#each filteredPrimary as row (row.composition.key)}
        {@const composition = row.composition}
      <div
        class="composition-item"
        role="listitem"
        class:nest-target={nestTargetKey === composition.key}
        ondragover={(event) => rowDragOver(event, composition.key)}
        ondragleave={(event) => rowDragLeave(event, composition.key)}
        ondrop={(event) => rowDrop(event, composition.key)}
        onpointerleave={() => disarmDelete(composition.key)}
      >
        <button
          data-composition-key={composition.key}
          draggable="true"
          ondragstart={(event) => startCompositionDrag(event, composition.key)}
          ondragend={endCompositionDrag}
          class:active={composition.key === $store.currentKey}
          class="composition-row kind-{composition.kind}"
          onclick={() => { viewModel.open(composition.key); onopen(); }}
          title={composition.file ?? composition.id}
          style:padding-left={`${7 + row.depth * 15}px`}
        >
          <span class="glyph">{glyph[composition.kind]}</span>
          <span class="name">{composition.id}</span>
          {#if composition.guide}<span class="tour-badge">START</span>{/if}
          <span class="kind">{composition.kind}</span>
          {#if composition.kind === "generate"}<span class="out-badge out-{composition.outputKind}">{composition.outputKind}</span>{/if}
        </button>
        <div class="row-actions">
          <button class="row-action" onclick={() => onduplicate(composition.key)} title="Duplicate {composition.id}" aria-label="Duplicate {composition.id}">⧉</button>
          <button
            class="row-action row-delete"
            class:armed={confirmDeleteKey === composition.key}
            onclick={() => requestDelete(composition.key)}
            title={confirmDeleteKey === composition.key ? `Click again to delete ${composition.id}` : `Delete ${composition.id}`}
            aria-label="Delete {composition.id}"
          >×</button>
        </div>
      </div>
    {/each}
    {#if search && !filteredPrimary.length}<div class="composition-empty">No project compositions match “{search}”.</div>{/if}
  </div>

  <div
    class="library-zone"
    class:drop-target={libraryDragDepth > 0}
    role="group"
    aria-label="Library"
    ondragenter={libraryDragEnter}
    ondragover={libraryDragOver}
    ondragleave={libraryDragLeave}
    ondrop={libraryDrop}
  >
    <div class="section-title library-title">LIBRARY <span>{search ? `${filteredLibrary.length}/${$store.library.length}` : $store.library.length}</span></div>
    {#if filteredLibrary.length}
      <div class="composition-list" role="list">
        {#each filteredLibrary as composition (composition.key)}
          <div
            class="composition-item"
            role="listitem"
            class:nest-target={nestTargetKey === composition.key}
            ondragover={(event) => rowDragOver(event, composition.key)}
            ondragleave={(event) => rowDragLeave(event, composition.key)}
            ondrop={(event) => rowDrop(event, composition.key)}
            onpointerleave={() => disarmDelete(composition.key)}
          >
            <button
              data-composition-key={composition.key}
              draggable="true"
              ondragstart={(event) => startCompositionDrag(event, composition.key)}
              ondragend={endCompositionDrag}
              class:active={composition.key === $store.currentKey}
              class="composition-row kind-{composition.kind}"
              onclick={() => { viewModel.open(composition.key); onopen(); }}
              title={composition.file ?? composition.id}
            >
              <span class="glyph">{glyph[composition.kind]}</span>
              <span class="name">{composition.id}</span>
              <span class="kind">{composition.kind}</span>
              {#if composition.kind === "generate"}<span class="out-badge out-{composition.outputKind}">{composition.outputKind}</span>{/if}
            </button>
            <div class="row-actions">
              <button class="row-action" onclick={() => onduplicate(composition.key)} title="Duplicate {composition.id}" aria-label="Duplicate {composition.id}">⧉</button>
              <button
                class="row-action row-delete"
                class:armed={confirmDeleteKey === composition.key}
                onclick={() => requestDelete(composition.key)}
                title={confirmDeleteKey === composition.key ? `Click again to delete ${composition.id}` : `Delete ${composition.id}`}
                aria-label="Delete {composition.id}"
              >×</button>
            </div>
          </div>
        {/each}
      </div>
    {:else if search}
      <div class="library-hint">no library compositions match “{search}”</div>
    {:else}
      <div class="library-hint">drag a composition here to copy it into the library</div>
    {/if}
  </div>

  <div class="rail-footer">
    FrameDiff studio<br />drop a comp on another to nest it
  </div>
</aside>
