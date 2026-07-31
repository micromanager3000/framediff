<script lang="ts">
  import { onDestroy } from "svelte";
  import { feelPreferences, systemReducedMotion, type FeelPreferences } from "../design/preferences";
  import { studioSound } from "../design/sound";

  export let onreplayintro: () => void = () => {};

  const preferences = feelPreferences();
  const sound = studioSound();

  let value: FeelPreferences = preferences.get();
  let open = false;
  const unsubscribe = preferences.subscribe((next) => { value = next; });
  onDestroy(unsubscribe);

  function toggleSound(): void {
    preferences.toggleSound();
    // Play the confirmation *after* enabling so turning it on demonstrates itself.
    if (preferences.get().sound) sound.play("select");
  }

  function toggleMotion(): void {
    preferences.toggleMotion();
    sound.play("tap");
  }

  function setVolume(next: number): void {
    preferences.set({ volume: next });
    sound.play("detent", { position: next });
  }
</script>

<div class="feel-control">
  <button
    class="feel-chip"
    class:muted={!value.sound}
    class:open
    onclick={() => { open = !open; sound.play(open ? "open" : "close"); }}
    aria-expanded={open}
    aria-label={value.sound ? "Sound and motion settings — sound is on" : "Sound and motion settings — sound is off"}
    title="Sound and motion"
  >
    <span class="feel-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
  </button>

  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="feel-menu" role="group" aria-label="Feel settings">
      <div class="feel-menu-label">FEEL</div>

      <button class="feel-row" onclick={toggleSound}>
        <span>Sound</span>
        <b class:on={value.sound}>{value.sound ? "ON" : "OFF"}</b>
      </button>
      <p class="feel-note">Synthesized in the browser — no audio files, and always silent while a render runs.</p>

      <label class="feel-slider" class:disabled={!value.sound}>
        <span>Level</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={value.volume}
          disabled={!value.sound}
          aria-label="Sound level"
          oninput={(event) => setVolume(Number(event.currentTarget.value))}
        />
      </label>

      <button class="feel-row" onclick={toggleMotion}>
        <span>Motion</span>
        <b class:on={value.motion}>{value.motion ? "ON" : "OFF"}</b>
      </button>
      <p class="feel-note">
        {systemReducedMotion()
          ? "Your system asks for reduced motion, so this started off."
          : "Ambient stage, staggered panels, spring physics."}
      </p>

      <div class="feel-menu-divider"></div>
      <button class="feel-row" onclick={() => { open = false; onreplayintro(); }}>
        <span>Replay the intro</span><b>↻</b>
      </button>
    </div>
    <button class="feel-scrim" onclick={() => { open = false; }} aria-label="Close feel settings" tabindex="-1"></button>
  {/if}
</div>
