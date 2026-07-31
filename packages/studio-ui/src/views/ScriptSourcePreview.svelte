<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type {
    AssetDescriptor,
    CompositionDescriptor,
    CompositionRuntimePort,
    PreviewHandle,
    ScriptSheetSourceSnapshot,
  } from "@framediff/studio-model";

  export let runtime: CompositionRuntimePort;
  export let source: ScriptSheetSourceSnapshot | undefined;
  export let compositions: CompositionDescriptor[] = [];
  export let assets: AssetDescriptor[] = [];
  export let frame = 0;
  export let fps = 30;
  export let playing = false;

  let host: HTMLDivElement;
  let mediaVideo: HTMLVideoElement | undefined;
  let handle: PreviewHandle | undefined;
  let mounted = false;

  $: nested = source?.type === "nested"
    ? compositions.find((composition) => composition.key === source?.compId || composition.id === source?.compId)
    : undefined;
  $: assetId = source?.src?.startsWith("asset://") ? source.src.slice("asset://".length) : undefined;
  $: asset = assetId ? assets.find((candidate) => candidate.id === assetId) : undefined;
  $: mediaUrl = asset ? `/__framediff-cache/${encodeURIComponent(asset.previewContentHash ?? asset.contentHash)}` : source?.src;
  $: sourceFrame = frame + Math.round((source?.trimStart ?? 0) * (nested?.fps ?? fps));
  $: if (mounted) syncPreview(nested?.key, sourceFrame, playing);
  $: if (mounted) syncMedia(frame, playing);

  function syncPreview(key: string | undefined, nextFrame: number, nextPlaying: boolean): void {
    if (!key) {
      handle?.destroy();
      handle = undefined;
      return;
    }
    if (!handle) handle = runtime.mountPreview(host, key, { frame: nextFrame, playing: nextPlaying });
    else handle.update(key, { frame: nextFrame, playing: nextPlaying });
  }

  function syncMedia(nextFrame: number, nextPlaying: boolean): void {
    if (!mediaVideo) return;
    const target = Math.max(0, nextFrame / Math.max(1, fps) + (source?.trimStart ?? 0));
    if (mediaVideo.readyState >= HTMLMediaElement.HAVE_METADATA && Math.abs(mediaVideo.currentTime - target) > 1 / Math.max(1, fps)) {
      mediaVideo.currentTime = Math.min(target, Math.max(0, mediaVideo.duration - 0.001));
    }
    if (nextPlaying) void mediaVideo.play().catch(() => undefined);
    else mediaVideo.pause();
  }

  onMount(() => {
    mounted = true;
    syncPreview(nested?.key, sourceFrame, playing);
    syncMedia(frame, playing);
  });

  onDestroy(() => handle?.destroy());
</script>

<div class="script-source-preview">
  <div class="script-source-runtime" bind:this={host} class:hidden={!nested}></div>
  {#if !nested && source?.type === "image" && mediaUrl}
    <img src={mediaUrl} alt="" />
  {:else if !nested && source?.type === "video" && mediaUrl}
    <video bind:this={mediaVideo} src={mediaUrl} muted playsinline onloadedmetadata={() => syncMedia(frame, playing)}></video>
  {:else if !nested && source?.type === "audio"}
    <div class="script-audio-source"><span>◉</span><b>{asset?.name ?? source.src ?? "Audio source"}</b></div>
  {:else if !source || (!nested && !mediaUrl)}
    <div class="script-empty-source">NO SOURCE ATTACHED</div>
  {/if}
</div>
