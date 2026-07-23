<script lang="ts">
  import type { CompositionDescriptor, ProjectOperationsState } from "@framediff/studio-model";

  export let composition: CompositionDescriptor | undefined;
  export let operations: ProjectOperationsState;
  export let onbake: () => void;

  const actionTitle = (status: string): string => status === "current"
    ? "The cached artifact matches every current render input. Bake it again."
    : status === "stale"
      ? "This composition changed since its cached artifact was built. Bake the current source."
      : status === "untracked"
        ? "The cached artifact predates source fingerprints. Bake a tracked replacement."
        : status === "checking"
          ? "Checking this composition against its cached artifact inputs."
          : "This composition has no cached artifact. Bake it now.";
  const stateLabel = (status: string): string => status === "current"
    ? "cached"
    : status === "stale"
      ? "cache stale"
      : status === "untracked"
        ? "legacy cache"
        : status === "checking"
          ? "checking cache"
          : "not baked";
</script>

<header class="composition-frame-bar" role="group" aria-label={`${composition?.id ?? "Current"} composition controls`}>
  <div class="composition-frame-identity">
    <span>COMPOSITION</span>
    <strong>{composition?.id ?? "No composition"}</strong>
    {#if composition}
      <small>{composition.kind} · {composition.outputKind} · {composition.width}×{composition.height}{composition.durationInFrames > 1 ? ` · ${composition.durationInFrames}f` : ""}</small>
    {/if}
  </div>
  {#if operations.currentBake}
    <div class="composition-bake-control">
      <span class="composition-bake-state {operations.currentBake.status}">{stateLabel(operations.currentBake.status)}</span>
      <button
        class="composition-bake-button {operations.currentBake.status}"
        onclick={onbake}
        disabled={operations.busy || operations.currentBake.status === "checking"}
        title={actionTitle(operations.currentBake.status)}
      >{operations.progress ? `Baking ${Math.round(operations.progress.completed / Math.max(1, operations.progress.total) * 100)}%` : "Bake"}</button>
    </div>
  {/if}
</header>
