<script lang="ts">
  import { guidePhases, type StudioGuideDescriptor, type StudioGuideStep } from "@framediff/studio-model";

  /**
   * The project's walkthrough, at the top of the Studio rather than beside it.
   *
   * A side panel made the guide compete with the Inspector for the same 320px, which meant
   * following a tour cost you the panel you were being told to look at. Across the top it can be
   * two things at once: a strip that always says what you are doing now, and a sheet that opens
   * over the workspace when you want the whole map.
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

  let openStepId = "";

  function toggleComplete(id: string): void {
    oncomplete(id, !completed.has(id));
  }

  function reset(): void {
    onreset();
    openStepId = "";
  }

  function startNext(): void {
    if (!nextStep) return;
    openStepId = nextStep.id;
    onopen(nextStep);
  }

  $: completed = new Set(completedIds);
  $: phases = guidePhases(guide);
  $: completedCount = guide.steps.filter((step) => completed.has(step.id)).length;
  $: progress = guide.steps.length ? completedCount / guide.steps.length : 0;
  $: nextStep = guide.steps.find((step) => !completed.has(step.id)) ?? guide.steps[0];
  $: startLabel = completedCount === guide.steps.length ? "REPLAY TOUR" : completedCount ? "CONTINUE TOUR" : "START TOUR";
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

  {#if expanded}
    <div class="guide-sheet">
      <header class="guide-hero">
        <h2>{guide.title}</h2>
        <p>{guide.summary}</p>
        <div class="guide-meta">
          <span>{guide.steps.length} real workflows</span>
          {#if guide.estimatedMinutes}<span>≈ {guide.estimatedMinutes} min</span>{/if}
          <button onclick={reset} disabled={!completedCount}>Reset</button>
        </div>
      </header>

      <div class="guide-phases">
        {#each phases as phase (phase)}
          <section class="guide-phase">
            <h3>{phase}</h3>
            {#each guide.steps.filter((step) => step.phase === phase) as step (step.id)}
              <article class="guide-step" class:complete={completed.has(step.id)} class:expanded={openStepId === step.id} class:here={currentKey === step.target.compositionKey}>
                <div class="guide-step-row">
                  <button class="guide-check" class:checked={completed.has(step.id)} onclick={() => toggleComplete(step.id)} aria-label={`${completed.has(step.id) ? "Mark incomplete" : "Mark complete"}: ${step.title}`}>{completed.has(step.id) ? "✓" : ""}</button>
                  <button class="guide-step-summary" onclick={() => openStepId = openStepId === step.id ? "" : step.id} aria-expanded={openStepId === step.id}>
                    <span>{String(guide.steps.indexOf(step) + 1).padStart(2, "0")}</span>
                    <strong>{step.title}</strong>
                    {#if currentKey === step.target.compositionKey}<em>HERE</em>{/if}
                    <b>{openStepId === step.id ? "−" : "+"}</b>
                  </button>
                </div>
                {#if openStepId === step.id}
                  <div class="guide-step-detail">
                    <p>{step.description}</p>
                    <div><span>TRY</span><p>{step.try}</p></div>
                    <div class="success"><span>SUCCESS</span><p>{step.success}</p></div>
                    <button class="guide-open" onclick={() => onopen(step)}>{currentKey === step.target.compositionKey ? "RESET TARGET" : "OPEN IN STUDIO"}<span>→</span></button>
                  </div>
                {/if}
              </article>
            {/each}
          </section>
        {/each}
      </div>
    </div>
  {/if}
</section>
