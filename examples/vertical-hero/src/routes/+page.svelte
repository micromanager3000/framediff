<script lang="ts">
  import { StudioApplication } from "@framediff/studio-model";
  import { StudioShell, browserAnimationClock } from "@framediff/studio-ui";
  import { studioRuntime } from "$lib/studio-runtime";

  const requested = new URLSearchParams(location.search).get("comp") ?? "vertical-main";
  const application = new StudioApplication(studioRuntime, browserAnimationClock, requested);
</script>

<svelte:head><title>FrameDiff — Vertical Hero</title></svelte:head>
<StudioShell {application} />
