<script lang="ts">
  import { StudioApplication } from "@framediff/studio-model";
  import { StudioShell, browserAnimationClock } from "@framediff/studio-ui";
  import { studioRuntime } from "$lib/studio-runtime";
  const application = new StudioApplication(studioRuntime, browserAnimationClock, "main");
</script>
<svelte:head><title>FrameDiff — Hero Reel</title></svelte:head>
<StudioShell {application} />
