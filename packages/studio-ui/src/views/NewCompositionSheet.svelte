<script lang="ts">
  import {
    COMPOSITION_KIND_CONTRACTS,
    compositionStarterContract,
    compositionStartersForKind,
    type CompositionDescriptor,
    type CompositionKind,
    type CompositionOutputKind,
    type NewCompositionRequest,
    type NewCompositionStarter,
  } from "@framediff/studio-model";
  import { onMount } from "svelte";
  import type { OperationsViewModel } from "../viewmodels/Operations.ViewModel";

  export let current: CompositionDescriptor;
  export let viewModel: OperationsViewModel;
  export let onclose: () => void;
  export let oncreated: (compositionKey: string) => void = () => {};
  const operationsStore = viewModel.store;
  let name = "";
  let kind: CompositionKind = "edit";
  let starter: NewCompositionStarter = "blank";
  let outputKind: CompositionOutputKind | "" = "";
  let seconds = 5;
  let nameInput: HTMLInputElement;

  const kindGlyph: Record<CompositionKind, string> = {
    edit: "⌗",
    scene: "▣",
    audio: "♒",
    plan: "▤",
    doc: "¶",
    script: "☰",
    board: "▢",
    locations: "⌖",
    cast: "♟",
  };

  onMount(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameInput.focus();
    return () => returnFocus?.focus();
  });

  $: starters = compositionStartersForKind(kind);
  $: starterContract = compositionStarterContract(starter);
  $: generated = starter === "generative";
  $: nestsUnderCurrent = current.kind === "edit" && current.file?.endsWith(".html") === true;
  $: if (generated) seconds = Math.max(1, Math.round(seconds));
  $: frames = generated && outputKind === "image" ? 1 : Math.max(1, Math.round(seconds * current.fps));
  $: canCreate = !!name.trim() && (!generated || !!outputKind) && !$operationsStore.busy;

  function chooseKind(nextKind: CompositionKind): void {
    kind = nextKind;
    starter = "blank";
    outputKind = "";
  }

  function chooseStarter(nextStarter: NewCompositionStarter): void {
    starter = nextStarter;
    outputKind = nextStarter === "generative" ? (kind === "audio" ? "audio" : "video") : "";
  }

  async function create(): Promise<void> {
    if (!name.trim()) return;
    const base = { name, durationInFrames: frames };
    let request: NewCompositionRequest;
    if (starter === "generative") {
      request = kind === "audio"
        ? { ...base, kind: "audio", starter, outputKind: "audio" }
        : { ...base, kind: "scene", starter, outputKind: outputKind as "image" | "video" };
    } else if (starter === "processing") {
      request = { ...base, kind: "scene", starter };
    } else if (starter === "moodboard") {
      request = { ...base, kind: "board", starter };
    } else if (starter === "code" || starter === "three") {
      request = { ...base, kind: "scene", starter };
    } else {
      request = { ...base, kind, starter: "blank" };
    }
    const compositionKey = await viewModel.create(request);
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
  <div class="sheet composition-sheet" role="dialog" aria-modal="true" aria-label="New composition">
    <header><strong>ADD COMPOSITION</strong><button onclick={onclose} aria-label="Close new composition">×</button></header>
    <label><span>Name</span><input bind:this={nameInput} bind:value={name} placeholder="TitleCard" /></label>

    <fieldset class="composition-choice-grid kind-choice-grid">
      <legend>KIND <small>what are you making?</small></legend>
      {#each COMPOSITION_KIND_CONTRACTS as option}
        <button
          type="button"
          class:selected={kind === option.kind}
          aria-pressed={kind === option.kind}
          onclick={() => chooseKind(option.kind)}
        >
          <i>{kindGlyph[option.kind]}</i><strong>{option.label}</strong><small>{option.help}</small>
        </button>
      {/each}
    </fieldset>

    {#if starters.length > 1}
      <fieldset class="composition-choice-grid starter-choice-grid">
        <legend>START WITH <small>only compatible options are shown</small></legend>
        {#each starters as option}
          <button
            type="button"
            class:selected={starter === option.starter}
            aria-pressed={starter === option.starter}
            onclick={() => chooseStarter(option.starter)}
          >
            <strong>{option.label}</strong><small>{option.help}</small>
          </button>
        {/each}
      </fieldset>
    {/if}

    {#if generated && kind === "scene"}
      <fieldset class="composition-choice-grid output-kind-picker">
        <legend>MEDIA <small>locked after creation</small></legend>
        {#each [
          { value: "video", label: "Video", help: "Moving picture, optional sound", glyph: "▷" },
          { value: "image", label: "Image", help: "A single still frame", glyph: "▧" },
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

    {#if !generated || outputKind !== "image"}
      <label><span>Duration</span><input type="number" min={generated ? 1 : 0.5} step={generated ? 1 : 0.5} bind:value={seconds} /><small>{generated ? `${Math.max(1, Math.round(seconds))}s of ${outputKind}` : `${frames} frames`}</small></label>
    {/if}

    <div class="creation-summary">
      <strong>{COMPOSITION_KIND_CONTRACTS.find((option) => option.kind === kind)?.label} · {starterContract.label}</strong>
      <small>{generated ? `${outputKind} media contract · model and take choices remain editable` : `${current.width}×${current.height} · ${current.fps.toFixed(3)}fps · inherited from ${current.id}`}</small>
      <small>{nestsUnderCurrent ? `Placed under ${current.id} at frame 0` : "Placed at the top level"}</small>
    </div>
    {#if $operationsStore.error}<div class="sheet-error">{$operationsStore.error}</div>{/if}
    <footer><button onclick={onclose}>Cancel</button><button class="primary" disabled={!canCreate} onclick={() => void create()}>Create</button></footer>
  </div>
</div>
