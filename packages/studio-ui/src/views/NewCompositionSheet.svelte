<script lang="ts">
  import type { CompositionDescriptor, NewCompositionKind } from "@framediff/studio-model";
  import { onMount } from "svelte";
  import type { OperationsViewModel } from "../viewmodels/Operations.ViewModel";

  export let current: CompositionDescriptor;
  export let viewModel: OperationsViewModel;
  export let onclose: () => void;
  export let oncreated: (compositionKey: string) => void = () => {};
  const operationsStore = viewModel.store;
  let name = "";
  let kind: NewCompositionKind = "edit";
  let seconds = 5;
  let nameInput: HTMLInputElement;
  onMount(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameInput.focus();
    return () => returnFocus?.focus();
  });
  $: generate = kind === "generate";
  $: nestsUnderCurrent = current.kind !== "generate" && current.file?.endsWith(".html") === true;
  $: if (generate) seconds = Math.max(1, Math.round(seconds));
  $: frames = Math.max(1, Math.round(seconds * current.fps));

  async function create(): Promise<void> {
    if (!name.trim()) return;
    const compositionKey = await viewModel.create({ name, kind, durationInFrames: frames });
    if (compositionKey) {
      oncreated(compositionKey);
      onclose();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onclose();
    } else if (event.key === "Enter" && event.target instanceof HTMLElement && event.target.matches("input, select")) {
      event.preventDefault();
      if (name.trim() && !$operationsStore.busy) void create();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="sheet-shade" role="presentation" onpointerdown={(event) => event.target === event.currentTarget && onclose()}>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="New composition">
    <header><strong>NEW COMPOSITION</strong><button onclick={onclose} aria-label="Close new composition">×</button></header>
    <label><span>Name</span><input bind:this={nameInput} bind:value={name} placeholder="TitleCard" /></label>
    <label><span>Kind</span><select bind:value={kind}>{#each ["edit", "3d", "generate", "audio"] as option}<option value={option}>{option.toUpperCase()}</option>{/each}</select></label>
    <label><span>Duration</span><input type="number" min={generate ? 1 : 0.5} step={generate ? 1 : 0.5} bind:value={seconds} /><small>{generate ? `${Math.max(1, Math.round(seconds))}s of video` : `${frames} frames`}</small></label>
    {#if generate}
      <div class="computed">generative recipe · 720p · aspect nearest {current.width}×{current.height} · prompt, model & refs live in the workbench</div>
    {:else}
      <div class="computed">{current.width}×{current.height} · {current.fps.toFixed(3)}fps · inherited from {current.id}</div>
    {/if}
    <div class="computed">{nestsUnderCurrent ? `placed under ${current.id} at frame 0` : "placed at the top level"}</div>
    {#if $operationsStore.error}<div class="sheet-error">{$operationsStore.error}</div>{/if}
    <footer><button onclick={onclose}>Cancel</button><button class="primary" disabled={!name.trim() || $operationsStore.busy} onclick={() => void create()}>Create</button></footer>
  </div>
</div>
