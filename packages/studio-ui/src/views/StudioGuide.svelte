<script lang="ts">
  import type { StudioGuideDescriptor, StudioGuideStep } from "@framediff/studio-model";

  export let guide: StudioGuideDescriptor;
  export let currentKey: string;
  export let completedIds: string[] = [];
  export let onopen: (step: StudioGuideStep) => void;
  export let oncomplete: (stepId: string, complete: boolean) => void;
  export let onreset: () => void;

  let expanded = guide.steps[0]?.id ?? "";

  function toggleComplete(id: string): void {
    oncomplete(id, !completed.has(id));
  }

  function reset(): void {
    onreset();
    expanded = guide.steps[0]?.id ?? "";
  }

  function startNext(): void {
    const step = guide.steps.find((candidate) => !completed.has(candidate.id)) ?? guide.steps[0];
    if (!step) return;
    expanded = step.id;
    onopen(step);
  }

  $: completed = new Set(completedIds);
  $: phases = [...new Set(guide.steps.map((step) => step.phase))];
  $: completedCount = guide.steps.filter((step) => completed.has(step.id)).length;
  $: progress = guide.steps.length ? completedCount / guide.steps.length : 0;
</script>

<aside class="studio-guide" aria-label={guide.title}>
  <header class="guide-hero">
    <div class="guide-kicker">PROJECT WALKTHROUGH</div>
    <h2>{guide.title}</h2>
    <p>{guide.summary}</p>
    <div class="guide-meta"><span>{guide.steps.length} real workflows</span>{#if guide.estimatedMinutes}<span>≈ {guide.estimatedMinutes} min</span>{/if}</div>
    <div class="guide-progress" aria-label={`${completedCount} of ${guide.steps.length} guide steps complete`}>
      <i style:transform={`scaleX(${progress})`}></i>
    </div>
    <div class="guide-progress-copy"><strong>{completedCount}/{guide.steps.length} complete</strong><button onclick={reset} disabled={!completedCount}>Reset</button></div>
    <button class="guide-start" onclick={startNext}>{completedCount === guide.steps.length ? "REPLAY TOUR" : completedCount ? "CONTINUE TOUR" : "START TOUR"}</button>
  </header>

  <div class="guide-phases">
    {#each phases as phase}
      <section class="guide-phase">
        <h3>{phase}</h3>
        {#each guide.steps.filter((step) => step.phase === phase) as step, index (step.id)}
          <article class="guide-step" class:complete={completed.has(step.id)} class:expanded={expanded === step.id} class:here={currentKey === step.target.compositionKey}>
            <div class="guide-step-row">
              <button class="guide-check" class:checked={completed.has(step.id)} onclick={() => toggleComplete(step.id)} aria-label={`${completed.has(step.id) ? "Mark incomplete" : "Mark complete"}: ${step.title}`}>{completed.has(step.id) ? "✓" : ""}</button>
              <button class="guide-step-summary" onclick={() => expanded = expanded === step.id ? "" : step.id} aria-expanded={expanded === step.id}>
                <span>{String(guide.steps.indexOf(step) + 1).padStart(2, "0")}</span>
                <strong>{step.title}</strong>
                {#if currentKey === step.target.compositionKey}<em>HERE</em>{/if}
                <b>{expanded === step.id ? "−" : "+"}</b>
              </button>
            </div>
            {#if expanded === step.id}
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
</aside>
