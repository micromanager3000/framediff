<script lang="ts">
  import { StudioApplication } from "@framediff/studio-model";
  import { StudioShell, browserAnimationClock } from "@framediff/studio-ui";
  import { studioRuntime } from "$lib/studio-runtime";
  const application = new StudioApplication(studioRuntime, browserAnimationClock, "studio-playground");
</script>
<svelte:head><title>FrameDiff — Studio Playground</title></svelte:head>
<StudioShell {application} />
