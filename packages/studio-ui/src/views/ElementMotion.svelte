<script lang="ts">
  import type { AnimationSnapshot, GestureDraftSnapshot } from "@framediff/studio-model";
  import type { InspectorViewModel } from "../viewmodels/Inspector.ViewModel";

  export let viewModel: InspectorViewModel;
  export let elementId: string;
  export let animations: AnimationSnapshot[] = [];
  export let gestureDraft: GestureDraftSnapshot | null = null;
  export let canRecord = false;
  export let editing = false;

  const properties = (animation: AnimationSnapshot): string => {
    const names = Object.keys(animation.bindings);
    return names.length ? names.join(" · ") : "timing only";
  };
  const hasPositionMotion = () => animations.some((animation) => animation.bindings.x && animation.bindings.y);
</script>

<section class="inspector-section element-motion-workspace">
  <div class="motion-workspace-heading">
    <h3>MOTION</h3>
    <span>SOURCE-BACKED</span>
  </div>

  <div class="motion-mental-model" aria-label="Object motion workflow">
    <span class="active">OBJECT</span><i>→</i><span>MOVE</span><i>→</i><span>REFINE</span>
  </div>
  <p class="motion-workspace-copy">
    Keep the resting layout here, or animate this object over time. Recorded moves become editable frame-based motion in the timeline and GSAP source.
  </p>

  {#if animations.length}
    <div class="element-motion-list">
      <span class="element-motion-list-label">ON THIS OBJECT</span>
      {#each animations as animation (animation.id)}
        <button onclick={() => viewModel.selectAnimation(animation.id)}>
          <span class="motion-list-glyph">{animation.motionPath ? "⌁" : "◆"}</span>
          <span>
            <strong>{animation.id}</strong>
            <small>{properties(animation)} · {animation.startFrame}–{animation.startFrame + animation.durationInFrames}f</small>
          </span>
          <b>EDIT</b>
        </button>
      {/each}
    </div>
  {/if}

  {#if canRecord}
    <button
      class="record-move-action"
      class:active={gestureDraft?.objectId === elementId}
      onclick={() => viewModel.armGesture()}
      disabled={editing || gestureDraft?.status === "recording"}
    >
      <span class="record-move-icon">●</span>
      <span>
        <strong>{hasPositionMotion() ? "Record a new take" : "Record a move"}</strong>
        <small>Grab {elementId} on the canvas. Playback starts on grab and stops on release.</small>
      </span>
      <b>REC</b>
    </button>
    <p class="motion-record-hint">Best for expressive routes. For a precise property tween, use <b>Animate</b> beside a numeric property below.</p>
  {/if}
</section>
