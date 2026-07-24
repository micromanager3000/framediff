<script lang="ts">
  import { StudioApplication } from "@framediff/studio-model";
  import { StudioShell, browserAnimationClock } from "@framediff/studio-ui";
  import { studioRuntime } from "$lib/studio-runtime";

  const application = new StudioApplication(studioRuntime, browserAnimationClock, "creator-social");
</script>

<svelte:head><title>FrameDiff — LightTwist Creator Social</title></svelte:head>
<StudioShell {application} />
