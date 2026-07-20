<script lang="ts">
  import { onMount } from "svelte";
  import { checkCompositionDeterminism, type DeterminismFrameResult } from "framediff";
  import { composition } from "../config";
  import "../App.css";

  const frames = [0, 15, 30, 45, composition.durationInFrames - 1];
  let results: DeterminismFrameResult[] | null = null;
  let running = false;
  $: allStable = results != null && results.every((result) => result.stable);
  $: verdict = results == null ? "…" : allStable ? "✅ deterministic" : "❌ NON-deterministic";
  async function run(): Promise<void> {
    running = true;
    results = null;
    results = await checkCompositionDeterminism(composition, { frames, width: 240, thumbnails: true });
    running = false;
  }
  onMount(() => { void run(); });
</script>

<svelte:head><title>FrameDiff · determinism check</title></svelte:head>
<div class="dc">
  <header class="dc-bar"><strong>FrameDiff · determinism check</strong><span class="dc-muted">renders each frame twice and SHA-256s the pixels</span><span class="dc-spacer"></span><span class="dc-verdict" data-testid="verdict" class:ok={allStable} class:bad={results != null && !allStable}>{running ? "running…" : verdict}</span><button onclick={() => void run()} disabled={running}>Re-run</button></header>
  <div class="dc-grid">{#each results ?? [] as result (result.frame)}<figure class="dc-card" class:ok={result.stable} class:bad={!result.stable}><img src={result.thumbnailDataUrl} alt={`frame ${result.frame}`} width="240" /><figcaption><span class="dc-frame">frame {String(result.frame).padStart(3, "0")}</span><span class="dc-mono">{result.hashes[0].slice(0, 16)}…</span><span class="dc-flag">{result.stable ? "✅ stable ×2" : "❌ mismatch"}</span></figcaption></figure>{/each}</div>
  <p class="dc-note">Same plain HTML/CSS/JS composition + frame produces identical pixels on the same machine. This Svelte view only reports the test.</p>
</div>
