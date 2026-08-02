<script lang="ts">
  import type { StudioGuideDescriptor, StudioGuideStep } from "@framediff/studio-model";

  /**
   * The project's walkthrough, at the top of the Studio rather than beside it.
   *
   * A side panel made the guide compete with the Inspector for the same 320px, which meant
   * following a tour cost you the panel you were being told to look at. Across the top it can be
   * two things at once: a strip that always says what you are doing now, and — when asked — one
   * step, opened to its full detail, with a rail that says where that step sits in the whole.
   *
   * Showing all ten at once was the obvious first move and the wrong one: a walkthrough is read
   * one step at a time, and the other nine were paying for themselves in workspace.
   */
  export let guide: StudioGuideDescriptor;
  export let currentKey: string;
  export let completedIds: string[] = [];
  export let expanded = false;
  export let activeStep: StudioGuideStep | null = null;
  export let onopen: (step: StudioGuideStep) => void;
  export let oncomplete: (stepId: string, complete: boolean) => void;
  export let onreset: () => void;
  export let onexpand: (expanded: boolean) => void;
  export let onadvance: () => void;
  export let ondismissactive: () => void;

  let focusedId = "";

  function focusBy(delta: number): void {
    const next = guide.steps[focusIndex + delta];
    if (next) focusedId = next.id;
  }

  function reset(): void {
    onreset();
    focusedId = guide.steps[0]?.id ?? "";
  }

  function startNext(): void {
    if (!nextStep) return;
    focusedId = nextStep.id;
    onopen(nextStep);
  }

  $: completed = new Set(completedIds);
  $: completedCount = guide.steps.filter((step) => completed.has(step.id)).length;
  $: progress = guide.steps.length ? completedCount / guide.steps.length : 0;
  $: nextStep = guide.steps.find((step) => !completed.has(step.id)) ?? guide.steps[0];
  $: startLabel = completedCount === guide.steps.length ? "REPLAY TOUR" : completedCount ? "CONTINUE TOUR" : "START TOUR";
  // Reading follows the tour when there is one, and otherwise starts wherever you left off.
  $: if (activeStep && activeStep.id !== focusedId) focusedId = activeStep.id;
  $: if (!focusedId && nextStep) focusedId = nextStep.id;
  $: focusIndex = Math.max(0, guide.steps.findIndex((step) => step.id === focusedId));
  $: focused = guide.steps[focusIndex];
  $: focusedHere = !!focused && currentKey === focused.target.compositionKey;
  $: focusedDone = !!focused && completed.has(focused.id);
  // A wider gap where the phase changes, so the rail reads as an arc and not ten identical ticks.
  $: phaseStarts = new Set(guide.steps.filter((step, index) => step.phase !== guide.steps[index - 1]?.phase).map((step) => step.id));
</script>

<section class="studio-guide" class:expanded aria-label={guide.title}>
  <div class="guide-task-bar" class:active={!!activeStep}>
    {#if activeStep}
      <div class="guide-task-what">
        <span>{activeStep.phase} · GUIDED TASK</span>
        <strong>{activeStep.title}</strong>
      </div>
      <p>{activeStep.try}</p>
    {:else}
      <div class="guide-task-what">
        <span>{guide.kicker ?? "PROJECT WALKTHROUGH"}</span>
        <strong>{guide.title}</strong>
      </div>
      <p>{nextStep ? `Next · ${nextStep.title}` : guide.summary}</p>
    {/if}

    <div class="guide-progress" aria-label={`${completedCount} of ${guide.steps.length} guide steps complete`}>
      <i style:transform={`scaleX(${progress})`}></i>
    </div>
    <span class="guide-count">{completedCount}/{guide.steps.length}</span>

    {#if activeStep}
      <button class="task-done" onclick={onadvance}>DONE · NEXT</button>
    {:else}
      <button class="guide-start" onclick={startNext} disabled={!nextStep}>{startLabel}</button>
    {/if}
    <button
      class="guide-expand"
      onclick={() => onexpand(!expanded)}
      aria-expanded={expanded}
      aria-label={expanded ? "Hide the walkthrough steps" : "Show the walkthrough steps"}
    >STEPS<b>{expanded ? "▴" : "▾"}</b></button>
    {#if activeStep}
      <button class="task-close" onclick={ondismissactive} aria-label="Dismiss guided task">×</button>
    {/if}
  </div>

  {#if expanded && focused}
    <div class="guide-sheet">
      <nav class="guide-rail" aria-label="Walkthrough steps">
        <button class="guide-nav" onclick={() => focusBy(-1)} disabled={focusIndex === 0} aria-label="Previous step">‹</button>
        <ol class="guide-pips">
          {#each guide.steps as step, index (step.id)}
            <li class:phase-start={phaseStarts.has(step.id) && index > 0}>
              <button
                class:done={completed.has(step.id)}
                class:current={step.id === focused.id}
                aria-current={step.id === focused.id ? "step" : undefined}
                title={`${step.phase} · ${step.title}`}
                aria-label={`Step ${index + 1} of ${guide.steps.length}: ${step.title}`}
                onclick={() => focusedId = step.id}
              ></button>
            </li>
          {/each}
        </ol>
        <button class="guide-nav" onclick={() => focusBy(1)} disabled={focusIndex === guide.steps.length - 1} aria-label="Next step">›</button>
        <span class="guide-place">{focused.phase} · STEP {focusIndex + 1} OF {guide.steps.length}</span>
        <button class="guide-sheet-reset" onclick={reset} disabled={!completedCount}>Reset</button>
      </nav>

      <article class="guide-card">
        <div class="guide-card-what">
          <h3>{focused.title}</h3>
          <p>{focused.description}</p>
        </div>
        <div class="guide-card-note"><span>TRY</span><p>{focused.try}</p></div>
        <div class="guide-card-note success"><span>SUCCESS</span><p>{focused.success}</p></div>
        <div class="guide-card-actions">
          <button class="guide-open" onclick={() => onopen(focused)}>{focusedHere ? "RESET TARGET" : "OPEN IN STUDIO"}<span>→</span></button>
          <button class="guide-mark" class:checked={focusedDone} onclick={() => oncomplete(focused.id, !focusedDone)}>{focusedDone ? "✓ DONE" : "MARK DONE"}</button>
        </div>
      </article>
    </div>
  {/if}
</section>
