<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { StudioApplication } from "@framediff/studio-model";
  import initialDocument from "../compositions/KineticCloth.comp.json";

  export let application: StudioApplication;

  type PinMode = "none" | "top" | "corners";
  type ClothSettings = {
    gravityY: number;
    windBase: number;
    windGust: number;
    windSpeed: number;
    flutter: number;
    damping: number;
    stiffness: number;
    shearStiffness: number;
    bendStiffness: number;
    substeps: number;
    iterations: number;
    pins: PinMode;
    roughness: number;
    metalness: number;
    iridescence: number;
    clearcoat: number;
    clearcoatRoughness: number;
    sheen: number;
    cameraFov: number;
  };

  const documentFile = "src/compositions/KineticCloth.comp.json";
  const presets: Array<{ id: string; label: string; note: string; values: Partial<ClothSettings> }> = [
    {
      id: "holo",
      label: "Holo",
      note: "Prismatic film",
      values: { gravityY: -2.35, windBase: 3.4, windGust: 2.2, windSpeed: 1, flutter: .55, damping: .044, bendStiffness: .28, roughness: .34, metalness: .18, iridescence: .82, clearcoat: .76, clearcoatRoughness: .18, sheen: .24, pins: "corners" },
    },
    {
      id: "float",
      label: "Float",
      note: "Slow and airy",
      values: { gravityY: -.7, windBase: 1.7, windGust: 1.1, windSpeed: .55, flutter: .2, damping: .06, bendStiffness: .18, roughness: .5, metalness: .08, iridescence: .5, clearcoat: .48, clearcoatRoughness: .28, sheen: .38, pins: "corners" },
    },
    {
      id: "banner",
      label: "Banner",
      note: "Taut fabric",
      values: { gravityY: -4.8, windBase: 5.4, windGust: 1.4, windSpeed: 1.35, flutter: .82, damping: .032, bendStiffness: .62, roughness: .68, metalness: .02, iridescence: .08, clearcoat: .12, clearcoatRoughness: .66, sheen: .12, pins: "top" },
    },
    {
      id: "liquid",
      label: "Liquid",
      note: "Heavy chrome",
      values: { gravityY: -1.5, windBase: 2.6, windGust: 3.8, windSpeed: .8, flutter: .35, damping: .085, bendStiffness: .08, roughness: .16, metalness: .72, iridescence: 1, clearcoat: .92, clearcoatRoughness: .06, sheen: .08, pins: "none" },
    },
  ];

  let settings = { ...(initialDocument.cloth as ClothSettings) };
  let currentKey = "";
  let busy = false;
  let collapsed = false;
  let activePreset = "holo";
  let error = "";
  let unsubscribe: (() => void) | null = null;

  const fieldId = (key: keyof ClothSettings) =>
    `json:${encodeURIComponent(documentFile)}:${encodeURIComponent(`/cloth/${key}`)}`;

  async function write(next: ClothSettings, keys: Array<keyof ClothSettings>, label: string): Promise<void> {
    if (busy) return;
    const previous = settings;
    settings = next;
    busy = true;
    error = "";
    try {
      const edits = keys.map((key) => ({ fieldId: fieldId(key), value: next[key] }));
      const request = {
        compositionKey: "kinetic-cloth",
        itemId: "KineticCloth",
        edits,
        label,
        groupId: "cloth-workbench",
      };
      const result = application.runtime.editInspectorFields
        ? await application.runtime.editInspectorFields(request)
        : await (async () => {
            for (const edit of edits) {
              const item = await application.runtime.editInspectorField({ ...request, ...edit });
              if (!item.ok) return item;
            }
            return { ok: true };
          })();
      if (!result.ok) {
        settings = previous;
        error = result.message ?? "The material settings could not be saved.";
      }
    } catch (cause) {
      settings = previous;
      error = cause instanceof Error ? cause.message : "The material settings could not be saved.";
    } finally {
      busy = false;
    }
  }

  function setValue(key: keyof ClothSettings, value: number | PinMode): void {
    activePreset = "";
    void write({ ...settings, [key]: value }, [key], `Tune cloth ${key}`);
  }

  function applyPreset(preset: (typeof presets)[number]): void {
    activePreset = preset.id;
    const next = { ...settings, ...preset.values };
    void write(next, Object.keys(preset.values) as Array<keyof ClothSettings>, `Apply ${preset.label} cloth preset`);
  }

  onMount(() => {
    unsubscribe = application.session.state.subscribe((state) => {
      currentKey = state.currentKey;
    });
  });

  onDestroy(() => unsubscribe?.());
</script>

{#if currentKey === "kinetic-cloth"}
  <aside class="cloth-controls" class:collapsed aria-label="Material Lab controls">
    <header>
      <div class="lab-title">
        <span>Material lab</span>
        <strong>Cloth surface</strong>
      </div>
      <span class="status" class:busy>{busy ? "Applying…" : "Live"}</span>
      <button class="collapse" onclick={() => collapsed = !collapsed} aria-label={collapsed ? "Expand Material Lab controls" : "Collapse Material Lab controls"}>{collapsed ? "＋" : "−"}</button>
    </header>

    {#if !collapsed}
      <button class="input-comp" onclick={() => application.session.navigate("material-poster")}>
        <span class="input-icon">COMP</span>
        <span><small>Input composition</small><strong>Material Poster</strong></span>
        <i>944 × 560</i>
        <b>Open ↗</b>
      </button>

      <section class="preset-section">
        <div class="section-label"><span>Motion recipe</span><small>Start with a feel</small></div>
        <div class="presets">
          {#each presets as preset (preset.id)}
            <button class:active={activePreset === preset.id} disabled={busy} onclick={() => applyPreset(preset)}>
              <strong>{preset.label}</strong><small>{preset.note}</small>
            </button>
          {/each}
        </div>
      </section>

      <section class="sliders">
        <label>
          <span><b>Motion</b><output>{settings.windBase.toFixed(1)}</output></span>
          <input aria-label="Motion strength" type="range" min="0" max="12" step=".1" value={settings.windBase} disabled={busy} onchange={(event) => setValue("windBase", Number(event.currentTarget.value))} />
        </label>
        <label>
          <span><b>Tempo</b><output>{settings.windSpeed.toFixed(2)}</output></span>
          <input aria-label="Motion tempo" type="range" min=".15" max="3" step=".05" value={settings.windSpeed} disabled={busy} onchange={(event) => setValue("windSpeed", Number(event.currentTarget.value))} />
        </label>
        <label>
          <span><b>Drape</b><output>{Math.abs(settings.gravityY).toFixed(1)}</output></span>
          <input aria-label="Drape gravity" type="range" min="-10" max="0" step=".1" value={settings.gravityY} disabled={busy} onchange={(event) => setValue("gravityY", Number(event.currentTarget.value))} />
        </label>
        <label>
          <span><b>Holo</b><output>{Math.round(settings.iridescence * 100)}%</output></span>
          <input aria-label="Holographic iridescence" type="range" min="0" max="1" step=".01" value={settings.iridescence} disabled={busy} onchange={(event) => setValue("iridescence", Number(event.currentTarget.value))} />
        </label>
      </section>

      <section class="pin-section">
        <div class="section-label"><span>Attach</span><small>Choose the anchor behavior</small></div>
        <div class="pins" role="group" aria-label="Cloth attachment">
          {#each [["none", "Free"], ["corners", "Corners"], ["top", "Top edge"]] as option (option[0])}
            <button class:active={settings.pins === option[0]} disabled={busy} onclick={() => setValue("pins", option[0] as PinMode)}>{option[1]}</button>
          {/each}
        </div>
      </section>

      {#if error}
        <div class="error" role="alert"><span>{error}</span><button onclick={() => { error = ""; }}>Dismiss</button></div>
      {/if}
    {/if}
  </aside>
{/if}

<style>
  .cloth-controls {
    --panel: rgba(11, 14, 12, .93);
    position: fixed;
    z-index: 54;
    left: 252px;
    top: 102px;
    width: 430px;
    overflow: hidden;
    color: #f3f1e8;
    border: 1px solid rgba(232, 238, 221, .16);
    border-radius: 14px;
    background: var(--panel);
    box-shadow: 0 24px 80px rgba(0, 0, 0, .5);
    backdrop-filter: blur(20px);
    font-family: Inter, "Helvetica Neue", Arial, sans-serif;
  }
  .cloth-controls.collapsed { width: 236px; }
  header {
    min-height: 52px;
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 10px;
    padding: 0 11px 0 15px;
    border-bottom: 1px solid rgba(232, 238, 221, .1);
  }
  .collapsed header { border-bottom: 0; }
  .lab-title { display: grid; gap: 2px; }
  .lab-title span, .section-label span {
    color: #d9ff43;
    font: 800 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .16em;
    text-transform: uppercase;
  }
  .lab-title strong { font-size: 13px; letter-spacing: -.01em; }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: rgba(243, 241, 232, .55);
    font: 800 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .1em;
    text-transform: uppercase;
  }
  .status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #d9ff43; box-shadow: 0 0 10px rgba(217, 255, 67, .72); }
  .status.busy::before { background: #ffb45f; box-shadow: 0 0 10px rgba(255, 180, 95, .7); }
  button { color: inherit; font: inherit; cursor: pointer; }
  button:disabled { cursor: wait; opacity: .48; }
  .collapse {
    width: 27px;
    height: 27px;
    padding: 0;
    border: 1px solid rgba(232, 238, 221, .14);
    border-radius: 8px;
    background: rgba(255, 255, 255, .03);
    color: rgba(243, 241, 232, .7);
    font-size: 15px;
  }
  .input-comp {
    width: calc(100% - 22px);
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 10px;
    margin: 11px;
    padding: 9px 10px;
    text-align: left;
    border: 1px solid rgba(217, 255, 67, .18);
    border-radius: 10px;
    background: linear-gradient(110deg, rgba(217, 255, 67, .08), rgba(255, 98, 67, .035));
  }
  .input-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 30px;
    border-radius: 7px;
    background: #d9ff43;
    color: #10120e;
    font: 900 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .08em;
  }
  .input-comp > span:nth-child(2) { display: grid; gap: 3px; }
  .input-comp small, .input-comp i {
    color: rgba(243, 241, 232, .46);
    font: 700 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .input-comp strong { font-size: 11px; }
  .input-comp i { font-style: normal; }
  .input-comp b { color: #d9ff43; font: 800 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
  section { padding: 11px 14px; border-top: 1px solid rgba(232, 238, 221, .08); }
  .section-label { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
  .section-label small { color: rgba(243, 241, 232, .37); font: 600 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .presets button {
    min-width: 0;
    display: grid;
    gap: 4px;
    padding: 9px 7px;
    text-align: left;
    border: 1px solid rgba(232, 238, 221, .11);
    border-radius: 8px;
    background: rgba(255, 255, 255, .025);
  }
  .presets button.active { color: #11130e; border-color: #d9ff43; background: #d9ff43; }
  .presets strong { font-size: 10px; }
  .presets small { overflow: hidden; color: rgba(243, 241, 232, .42); font: 600 7px/1.15 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; text-overflow: ellipsis; }
  .presets button.active small { color: rgba(17, 19, 14, .6); }
  .sliders { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 18px; }
  .sliders label { display: grid; gap: 6px; }
  .sliders label > span { display: flex; justify-content: space-between; align-items: center; }
  .sliders b { font-size: 9px; }
  .sliders output { color: rgba(243, 241, 232, .48); font: 700 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
  input[type="range"] { width: 100%; height: 14px; margin: 0; accent-color: #d9ff43; cursor: ew-resize; }
  .pins { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .pins button {
    padding: 8px;
    border: 1px solid rgba(232, 238, 221, .11);
    border-radius: 8px;
    background: rgba(255, 255, 255, .025);
    color: rgba(243, 241, 232, .58);
    font: 800 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    text-transform: uppercase;
  }
  .pins button.active { color: #d9ff43; border-color: rgba(217, 255, 67, .42); background: rgba(217, 255, 67, .1); }
  .error {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    color: #ffc6bb;
    background: rgba(255, 98, 67, .12);
    font: 700 8px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .error button { padding: 5px 7px; border: 1px solid rgba(255, 198, 187, .24); border-radius: 6px; background: transparent; text-transform: uppercase; }
  @media (max-width: 1050px) {
    .cloth-controls { left: 14px; top: 112px; width: min(410px, calc(100vw - 28px)); }
  }
  @media (max-width: 620px) {
    .cloth-controls { top: 104px; }
    .presets { grid-template-columns: 1fr 1fr; }
  }
</style>
