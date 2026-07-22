<script lang="ts">
  import type { AssetDescriptor, InspectorSectionSnapshot } from "@framediff/studio-model";
  import InspectorField from "./InspectorField.svelte";

  export let section: InspectorSectionSnapshot;
  export let assets: AssetDescriptor[] = [];
  export let disabled = false;
  export let onclose: () => void;
  export let oncommit: (fieldId: string, value: number | string | boolean) => void;
  export let onpreset: (presetId: string) => void;

  function closeBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) onclose();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="effect-editor-backdrop" role="presentation" onclick={closeBackdrop}>
  <div class="effect-editor" role="dialog" aria-modal="true" aria-label={`${section.title} editor`}>
    <header>
      <div><span>EFFECT WORKSPACE</span><strong>{section.title}</strong></div>
      <button onclick={onclose} aria-label="Close effect editor">×</button>
    </header>
    {#if section.editor?.description}<p class="effect-editor-intro">{section.editor.description}</p>{/if}
    {#if section.presets?.length}
      <div class="effect-editor-presets" aria-label="Effect presets">
        <span>LOOK PRESETS</span>
        <div>
          {#each section.presets as preset (preset.id)}
            <button onclick={() => onpreset(preset.id)} disabled={disabled}>{preset.label}</button>
          {/each}
        </div>
      </div>
    {/if}
    <div class="effect-editor-fields">
      {#each section.fields as field (field.id)}
        <InspectorField {field} {assets} {disabled} {oncommit} />
      {/each}
    </div>
    <footer><span>Edits use the same guarded source transaction as the inline Inspector.</span><button onclick={onclose}>Done</button></footer>
  </div>
</div>
