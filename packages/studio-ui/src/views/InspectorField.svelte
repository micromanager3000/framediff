<script lang="ts">
  import type { AssetDescriptor, InspectorControlSnapshot, InspectorFieldSnapshot } from "@framediff/studio-model";

  export let field: InspectorFieldSnapshot;
  export let assets: AssetDescriptor[] = [];
  export let disabled = false;
  export let oncommit: (fieldId: string, value: number | string | boolean) => void;

  let numberDraft = field.control?.type === "number" ? field.control.value : field.value ?? 0;
  let textDraft = typeof field.control?.value === "string" ? field.control.value : field.text ?? "";
  let booleanDraft = field.control?.type === "boolean" ? field.control.value : field.boolean ?? false;
  let vectorDraft = field.control?.type === "vector" ? parseVector(field.control.value, field.control.labels.length) : [];
  let previousControlValue = field.control?.value;
  let previousNumber = field.value;
  let previousText = field.text;
  let previousBoolean = field.boolean;

  function parseVector(value: string, length: number): number[] {
    const values = value.trim().split(/[ ,]+/).filter(Boolean).map(Number);
    if (values.length === 1) return Array.from({ length }, () => values[0]);
    if (values.length === 2 && length === 4) return [values[0], values[1], values[0], values[1]];
    if (values.length === 3 && length === 4) return [values[0], values[1], values[2], values[1]];
    return Array.from({ length }, (_, index) => Number.isFinite(values[index]) ? values[index] : 0);
  }

  function gradientCss(value: string, type: "linear" | "radial"): string {
    const stops = value.split("|").map((stop) => {
      const [color, position] = stop.split("@");
      const amount = Number(position);
      return `${color} ${Number.isFinite(amount) ? `${amount * 100}%` : position ?? ""}`.trim();
    }).join(",");
    return type === "linear" ? `linear-gradient(90deg,${stops})` : `radial-gradient(circle,${stops})`;
  }

  function datalistId(): string {
    return `fd-font-${field.id.replace(/[^a-z0-9_-]/gi, "-")}`;
  }

  function acceptedAssets(control: Extract<InspectorControlSnapshot, { type: "asset" }>): AssetDescriptor[] {
    if (!control.accept || control.accept === "any") return assets;
    return assets.filter((asset) => asset.mime.startsWith(`${control.accept}/`));
  }

  $: if (field.control?.value !== previousControlValue) {
    previousControlValue = field.control?.value;
    if (field.control?.type === "number") numberDraft = field.control.value;
    else if (field.control?.type === "boolean") booleanDraft = field.control.value;
    else if (field.control && typeof field.control.value === "string") {
      textDraft = field.control.value;
      if (field.control.type === "vector") vectorDraft = parseVector(field.control.value, field.control.labels.length);
    }
  }
  $: if (!field.control && field.value !== previousNumber) {
    previousNumber = field.value;
    numberDraft = field.value ?? 0;
  }
  $: if (!field.control && field.text !== previousText) {
    previousText = field.text;
    textDraft = field.text ?? "";
  }
  $: if (!field.control && field.boolean !== previousBoolean) {
    previousBoolean = field.boolean;
    booleanDraft = field.boolean ?? false;
  }

  function commitNumber(): void {
    const current = field.control?.type === "number" ? field.control.value : field.value;
    if (field.editable && current !== undefined && numberDraft !== current) oncommit(field.id, Number(numberDraft));
  }

  function commitText(): void {
    const current = field.control && typeof field.control.value === "string" ? field.control.value : field.text ?? "";
    if (field.editable && textDraft !== current) oncommit(field.id, textDraft);
  }

  function commitBoolean(): void {
    const current = field.control?.type === "boolean" ? field.control.value : field.boolean ?? false;
    if (field.editable && booleanDraft !== current) oncommit(field.id, booleanDraft);
  }

  function commitVector(): void {
    if (!field.editable) return;
    const value = vectorDraft.map((entry) => Number(entry) || 0).join(" ");
    if (field.control?.type !== "vector" || value !== field.control.value) oncommit(field.id, value);
  }
</script>

<label class:rich={!!field.control} title={field.source ?? field.label}>
  <span>{field.label}</span>
  {#if field.control?.type === "boolean"}
    <input type="checkbox" bind:checked={booleanDraft} disabled={disabled || !field.editable} onchange={commitBoolean} />
  {:else if field.control?.type === "text"}
    {#if field.control.multiline}
      <textarea bind:value={textDraft} rows="3" disabled={disabled || !field.editable} onblur={commitText}></textarea>
    {:else}
      <input type="text" bind:value={textDraft} placeholder={field.control.placeholder} disabled={disabled || !field.editable} onblur={commitText} onchange={commitText} />
    {/if}
  {:else if field.control?.type === "number"}
    <div class="number-control" class:with-slider={field.control.slider}>
      {#if field.control.slider}
        <input type="range" bind:value={numberDraft} min={field.control.min} max={field.control.max} step={field.control.step ?? 0.01} disabled={disabled || !field.editable} onchange={commitNumber} />
      {/if}
      <input aria-label={`${field.label} number`} type="number" bind:value={numberDraft} min={field.control.min} max={field.control.max} step={field.control.step ?? 0.01} disabled={disabled || !field.editable} onblur={commitNumber} onchange={commitNumber} />
      {#if field.control.unit}<i>{field.control.unit}</i>{/if}
    </div>
  {:else if field.control?.type === "color"}
    <div class="color-control">
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(textDraft) ? textDraft : "#000000"} disabled={disabled || !field.editable} oninput={(event) => { textDraft = event.currentTarget.value; }} onchange={commitText} />
      <input type="text" bind:value={textDraft} disabled={disabled || !field.editable} onblur={commitText} onchange={commitText} />
    </div>
  {:else if field.control?.type === "select"}
    <select bind:value={textDraft} disabled={disabled || !field.editable} onchange={commitText}>
      {#each field.control.options as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
    </select>
  {:else if field.control?.type === "font"}
    <div>
      <input type="text" list={datalistId()} bind:value={textDraft} style={`font-family:${textDraft}`} disabled={disabled || !field.editable} onblur={commitText} onchange={commitText} />
      <datalist id={datalistId()}>{#each field.control.suggestions ?? [] as font}<option value={font}></option>{/each}</datalist>
    </div>
  {:else if field.control?.type === "asset"}
    <select bind:value={textDraft} disabled={disabled || !field.editable} onchange={commitText}>
      {#if textDraft && !acceptedAssets(field.control).some((asset) => `asset://${asset.id}` === textDraft)}<option value={textDraft}>{textDraft}</option>{/if}
      <option value="">No asset</option>
      {#each acceptedAssets(field.control) as asset (asset.id)}<option value={`asset://${asset.id}`}>{asset.name}</option>{/each}
    </select>
  {:else if field.control?.type === "gradient"}
    <div class="gradient-control">
      <span class="gradient-preview" style={`background:${gradientCss(textDraft, field.control.gradientType)}`}></span>
      <input type="text" bind:value={textDraft} placeholder="#754cff@0|#ff4fa3@1" disabled={disabled || !field.editable} onblur={commitText} onchange={commitText} />
    </div>
  {:else if field.control?.type === "alignment"}
    <div class="alignment-control">
      {#each field.control.options as option (option.value)}
        <button type="button" class:active={textDraft === option.value} disabled={disabled || !field.editable} title={option.label} onclick={() => { textDraft = option.value; commitText(); }}>{option.label.slice(0, 1).toUpperCase()}</button>
      {/each}
    </div>
  {:else if field.control?.type === "vector"}
    <div class="vector-control">
      {#each field.control.labels as vectorLabel, index (vectorLabel)}
        <div title={vectorLabel}><span>{vectorLabel.slice(0, 1).toUpperCase()}</span><input aria-label={vectorLabel} type="number" bind:value={vectorDraft[index]} disabled={disabled || !field.editable} onblur={commitVector} onchange={commitVector} /></div>
      {/each}
    </div>
  {:else if field.valueType === "boolean" || field.boolean !== undefined}
    <input type="checkbox" bind:checked={booleanDraft} disabled={disabled || !field.editable} onchange={commitBoolean} />
  {:else if field.valueType === "text" || (field.text !== undefined && field.value === undefined)}
    <input type="text" bind:value={textDraft} disabled={disabled || !field.editable} onblur={commitText} onchange={commitText} />
  {:else if field.value !== undefined}
    <input type="number" step={field.step ?? 0.01} bind:value={numberDraft} disabled={disabled || !field.editable} onblur={commitNumber} onchange={commitNumber} />
  {:else}
    <output>{field.text ?? "—"}</output>
  {/if}
  <small>{field.editable ? field.control?.type ?? "literal" : "computed"}</small>
</label>
