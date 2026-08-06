<script lang="ts">
  import {
    COMPOSITION_TEMPLATE_CONTRACTS,
    type CompositionDescriptor,
    type CompositionOutputKind,
    type NewCompositionTemplate,
  } from "@framediff/studio-model";
  import { onMount } from "svelte";
  import type { OperationsViewModel } from "../viewmodels/Operations.ViewModel";

  export let current: CompositionDescriptor;
  export let viewModel: OperationsViewModel;
  export let onclose: () => void;
  export let oncreated: (compositionKey: string) => void = () => {};
  const operationsStore = viewModel.store;
  let name = "";
  let template: NewCompositionTemplate = "edit";
  let outputKind: CompositionOutputKind | "" = "";
  let seconds = 5;
  let nameInput: HTMLInputElement;
  const templates = COMPOSITION_TEMPLATE_CONTRACTS.map((contract) => ({
    value: contract.template,
    label: contract.label,
    help: contract.help,
  }));
  onMount(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameInput.focus();
    return () => returnFocus?.focus();
  });
  $: generate = template === "generate";
  $: nestsUnderCurrent = current.kind === "edit" && current.file?.endsWith(".html") === true;
  $: templateHelp = templates.find((option) => option.value === template)?.help ?? "";
  $: if (generate) seconds = Math.max(1, Math.round(seconds));
  $: frames = generate && outputKind === "image" ? 1 : Math.max(1, Math.round(seconds * current.fps));
  $: canCreate = !!name.trim() && (!generate || !!outputKind) && !$operationsStore.busy;

  async function create(): Promise<void> {
    if (!name.trim()) return;
    const compositionKey = await viewModel.create({
      name,
      template,
      durationInFrames: frames,
      ...(generate ? { outputKind: outputKind as CompositionOutputKind } : {}),
    });
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
      if (canCreate) void create();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="sheet-shade" role="presentation" onpointerdown={(event) => event.target === event.currentTarget && onclose()}>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="New composition">
    <header><strong>NEW COMPOSITION</strong><button onclick={onclose} aria-label="Close new composition">×</button></header>
    <label><span>Name</span><input bind:this={nameInput} bind:value={name} placeholder="TitleCard" /></label>
    <label><span>Template</span><select bind:value={template}>{#each templates as option}<option value={option.value}>{option.label}</option>{/each}</select><small>{templateHelp}</small></label>
    {#if generate}
      <fieldset class="output-kind-picker">
        <legend>OUTPUT TYPE <small>locked after creation</small></legend>
        {#each [
          { value: "image", label: "Image", help: "A single still frame", glyph: "▧" },
          { value: "video", label: "Video", help: "Moving picture, optional sound", glyph: "▷" },
          { value: "audio", label: "Audio", help: "Sound without a visual shape", glyph: "◒" },
        ] as option}
          <button
            type="button"
            class:selected={outputKind === option.value}
            aria-pressed={outputKind === option.value}
            onclick={() => outputKind = option.value as CompositionOutputKind}
          >
            <i>{option.glyph}</i><strong>{option.label}</strong><small>{option.help}</small>
          </button>
        {/each}
      </fieldset>
    {/if}
    {#if !generate || outputKind !== "image"}
      <label><span>Duration</span><input type="number" min={generate ? 1 : 0.5} step={generate ? 1 : 0.5} bind:value={seconds} /><small>{generate ? `${Math.max(1, Math.round(seconds))}s of ${outputKind || "generated media"}` : `${frames} frames`}</small></label>
    {/if}
    {#if generate}
      <div class="computed">
        {#if outputKind}
          {outputKind} contract · model choices stay within this type · output shape is optional in the workbench
        {:else}
          choose the media contract before creating this composition
        {/if}
      </div>
    {:else}
      <div class="computed">{current.width}×{current.height} · {current.fps.toFixed(3)}fps · inherited from {current.id}</div>
    {/if}
    <div class="computed">{nestsUnderCurrent ? `placed under ${current.id} at frame 0` : "placed at the top level"}</div>
    {#if $operationsStore.error}<div class="sheet-error">{$operationsStore.error}</div>{/if}
    <footer><button onclick={onclose}>Cancel</button><button class="primary" disabled={!canCreate} onclick={() => void create()}>Create</button></footer>
  </div>
</div>
