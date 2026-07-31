<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type {
    CompositionRuntimePort,
    PreviewHandle,
    StudioSession,
  } from "@framediff/studio-model";
  import { sessionStore } from "../viewmodels/store";

  export let runtime: CompositionRuntimePort;
  export let session: StudioSession;
  export let compositionKey: string;

  const store = sessionStore(session);
  let host: HTMLDivElement;
  let handle: PreviewHandle | undefined;
  let mounted = false;

  function sync(): void {
    if (!mounted || !compositionKey) return;
    if (!handle) {
      handle = runtime.mountPreview(host, compositionKey, {
        frame: $store.frame,
        playing: $store.playing,
        gradeBypass: $store.gradeBypass,
      });
      return;
    }
    handle.update(compositionKey, {
      frame: $store.frame,
      playing: $store.playing,
      gradeBypass: $store.gradeBypass,
    });
  }

  onMount(() => {
    mounted = true;
    sync();
  });

  onDestroy(() => {
    mounted = false;
    handle?.destroy();
    handle = undefined;
  });

  $: compositionKey, $store.frame, $store.playing, $store.gradeBypass, sync();
</script>

<div class="synchronized-composition-preview" bind:this={host}></div>
