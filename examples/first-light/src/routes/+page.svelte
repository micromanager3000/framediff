<script lang="ts">
  import { StudioApplication } from "@framediff/studio-model";
  import { StudioShell, browserAnimationClock } from "@framediff/studio-ui";
  import { studioRuntime } from "$lib/studio-runtime";

  const application = new StudioApplication(studioRuntime, browserAnimationClock, "first-light");
</script>

<svelte:head><title>FrameDiff — First Light</title></svelte:head>
<StudioShell {application} />
