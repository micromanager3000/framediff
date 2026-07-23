<script lang="ts">
  import { StudioApplication } from "@framediff/studio-model";
  import { StudioShell, browserAnimationClock } from "@framediff/studio-ui";
  import { studioRuntime } from "$lib/studio-runtime";
  import { PROJECT_ROOT } from "../config";

  const application = new StudioApplication(studioRuntime, browserAnimationClock, PROJECT_ROOT);
</script>
<svelte:head><title>FrameDiff — Previz to Generation</title></svelte:head>
<StudioShell {application} />
