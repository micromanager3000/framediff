<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { StageAmbience } from "../design/ambience";
  import { feelPreferences } from "../design/preferences";

  /** 0–1. How lively the field should be. */
  export let energy = 0;
  /** Palette rotation in turns. */
  export let hue = 0;
  /** 0–1 render progress, or null for no sweep. */
  export let progress: number | null = null;
  /** 0–1 fault blend. */
  export let fault = 0;

  let canvas: HTMLCanvasElement;
  let ambience: StageAmbience | null = null;
  let usingGpu = false;
  let motion = true;

  const preferences = feelPreferences();

  function sync(): void {
    if (!ambience || !usingGpu) return;
    // With motion off the field still renders — it just holds a single calm frame, which keeps
    // the stage from reverting to the flat black void this component exists to replace.
    ambience.setState(motion ? { energy, hue, progress, fault } : { energy: 0, hue, progress: null, fault });
  }

  onMount(() => {
    ambience = new StageAmbience(canvas);
    usingGpu = ambience.start();
    if (!usingGpu) {
      // No WebGL2: drop the canvas and let the CSS gradient underneath do the work.
      ambience.dispose();
      ambience = null;
    }
    const unsubscribe = preferences.subscribe((value) => {
      motion = value.motion;
      if (!ambience) return;
      if (motion) ambience.start();
      sync();
      // A held frame needs no animation loop at all.
      if (!motion) queueMicrotask(() => ambience?.stop());
    });
    sync();
    return unsubscribe;
  });

  onDestroy(() => {
    ambience?.dispose();
    ambience = null;
  });

  $: energy, hue, progress, fault, sync();
</script>

<div class="stage-ambience" class:gpu={usingGpu} aria-hidden="true">
  <canvas bind:this={canvas}></canvas>
</div>
