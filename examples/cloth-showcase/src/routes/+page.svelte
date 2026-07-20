<script lang="ts">
  import { StudioApplication } from "@framediff/studio-model";
  import { StudioShell, browserAnimationClock } from "@framediff/studio-ui";
  import { captureCompositeFrame } from "framediff";
  import { studioRuntime } from "$lib/studio-runtime";
  import { composition } from "../config";

  const application = new StudioApplication(studioRuntime, browserAnimationClock, "kinetic-cloth");
  const showCaptureCheck = new URLSearchParams(location.search).has("capture-check");
  let captureResult = "idle";
  let captureImage = "";

  async function runCaptureCheck(): Promise<void> {
    captureResult = "capturing";
    const first = await captureCompositeFrame(composition, 120, { width: 640, height: 360 });
    const second = await captureCompositeFrame(composition, 120, { width: 640, height: 360 });
    const firstImage = first.toDataURL("image/png");
    captureImage = firstImage;
    captureResult = firstImage === second.toDataURL("image/png") ? "stable" : "mismatch";
  }
</script>

<svelte:head>
  <title>FrameDiff — Kinetic Cloth Study</title>
</svelte:head>

<StudioShell {application} />

{#if showCaptureCheck}
  <aside class="capture-check" data-testid="capture-check">
    <button onclick={() => void runCaptureCheck()} disabled={captureResult === "capturing"}>Exact frame 120</button>
    <output data-testid="capture-result">{captureResult}</output>
    {#if captureImage}<img src={captureImage} alt="Exact FrameDiff capture at frame 120" />{/if}
  </aside>
{/if}

<style>
  .capture-check {
    position: fixed;
    z-index: 100;
    right: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    color: #f4f0df;
    background: #090a08;
    border: 1px solid #d9ff43;
    font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .capture-check img { width: 160px; height: 90px; object-fit: cover; }
</style>
