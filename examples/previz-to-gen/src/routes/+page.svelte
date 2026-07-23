<script lang="ts">
  import { StudioApplication } from "@framediff/studio-model";
  import { StudioShell, browserAnimationClock } from "@framediff/studio-ui";
  import { projectRoot, studioRuntime } from "$lib/studio-runtime";

  const application = new StudioApplication(studioRuntime, browserAnimationClock, projectRoot);
</script>
<svelte:head><title>FrameDiff — Previz to Generation</title></svelte:head>
<StudioShell {application} />
