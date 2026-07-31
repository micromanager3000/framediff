<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import StageAmbience from "./StageAmbience.svelte";
  import { feelPreferences } from "../design/preferences";
  import { studioSound } from "../design/sound";

  /** Project name shown under the mark. */
  export let projectName = "";
  /** How many compositions are in the project — the first honest fact a new user gets. */
  export let compositionCount = 0;
  /** Whether this project ships a walkthrough, which changes what we point at. */
  export let hasGuide = false;
  export let onopenguide: () => void = () => {};
  export let ondismiss: () => void = () => {};

  const sound = studioSound();
  const preferences = feelPreferences();

  let stage: "arriving" | "settled" | "leaving" = "arriving";
  let motion = true;
  let timers: ReturnType<typeof setTimeout>[] = [];

  const CARDS = [
    { key: "space", glyph: "▶", title: "Press Space", body: "Play the composition. ← and → step one frame; hold Shift for ten." },
    { key: "click", glyph: "✥", title: "Click the canvas", body: "Select anything, then drag it. The edit is written back to your source file." },
    { key: "render", glyph: "◉", title: "Hit Render", body: "Deterministic export in the browser. Same input, same bytes, every time." },
  ];

  function dismiss(): void {
    if (stage === "leaving") return;
    stage = "leaving";
    sound.play("tap");
    // Long enough for the curtain to actually lift; short enough that nobody waits on it.
    timers.push(setTimeout(ondismiss, motion ? 620 : 0));
  }

  function openGuide(): void {
    if (stage === "leaving") return;
    stage = "leaving";
    sound.play("select");
    timers.push(setTimeout(() => { onopenguide(); ondismiss(); }, motion ? 620 : 0));
  }

  function onKeyDown(event: KeyboardEvent): void {
    // Any key gets you out. An overture nobody can skip is a wall.
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Enter" && hasGuide) openGuide();
    else dismiss();
  }

  onMount(() => {
    const unsubscribe = preferences.subscribe((value) => { motion = value.motion; });
    if (motion) timers.push(setTimeout(() => { stage = "settled"; }, 1500));
    else stage = "settled";
    // The engine is still locked here — this arms it so the chord lands on the user's first
    // real gesture rather than being swallowed by autoplay policy.
    sound.play("boot");
    return unsubscribe;
  });

  onDestroy(() => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  });
</script>

<svelte:window on:keydown={onKeyDown} />

<div
  class="studio-overture {stage}"
  class:still={!motion}
  role="dialog"
  aria-modal="true"
  aria-label="Welcome to FrameDiff Studio"
>
  <StageAmbience energy={stage === "arriving" ? 0.85 : 0.42} hue={0.08} />

  <div class="overture-body">
    <div class="overture-mark" aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <!-- The mark draws itself: an aperture closing, which is also the shape of a frame. -->
        <circle class="ring" cx="32" cy="32" r="26" />
        <path class="blade" d="M32 6 A26 26 0 0 1 58 32 L32 32 Z" />
        <path class="sweep" d="M6 32 A26 26 0 0 0 32 58" />
      </svg>
    </div>

    <p class="overture-kicker">FRAMEDIFF STUDIO</p>
    <h1 class="overture-title"><span>Code is the</span> <span>source of truth.</span></h1>
    <p class="overture-lede">
      Compositions are HTML, CSS and TypeScript on disk. Everything you do here — dragging,
      trimming, keyframing — is written straight back to those files.
    </p>

    <div class="overture-facts">
      {#if projectName}<span><b>{projectName}</b> loaded</span>{/if}
      {#if compositionCount}<span><b>{compositionCount}</b> composition{compositionCount === 1 ? "" : "s"}</span>{/if}
      <span>renders in <b>this browser</b></span>
    </div>

    <div class="overture-cards">
      {#each CARDS as card, index (card.key)}
        <div class="overture-card" style={`--stagger:${index}`}>
          <span class="card-glyph" aria-hidden="true">{card.glyph}</span>
          <strong>{card.title}</strong>
          <p>{card.body}</p>
        </div>
      {/each}
    </div>

    <div class="overture-actions">
      {#if hasGuide}
        <button class="overture-primary" onclick={openGuide}>Take the walkthrough <kbd>↵</kbd></button>
        <button class="overture-secondary" onclick={dismiss}>Just let me look around</button>
      {:else}
        <button class="overture-primary" onclick={dismiss}>Open the studio <kbd>↵</kbd></button>
      {/if}
    </div>
    <p class="overture-escape">press any key to skip · this only appears once</p>
  </div>
</div>
