<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { exposeStudioAgentApi, resolveCompositionAuthoring, type AgentCheckResult, type AgentFrameSnapshot, type StudioApplication, type StudioGuideStep } from "@framediff/studio-model";
  import CompositionRail from "./views/CompositionRail.svelte";
  import PreviewHost from "./views/PreviewHost.svelte";
  import Timeline from "./views/Timeline.svelte";
  import Inspector from "./views/Inspector.svelte";
  import MediaPanel from "./views/MediaPanel.svelte";
  import CodeView from "./views/CodeView.svelte";
  import GitStatus from "./views/GitStatus.svelte";
  import RenderControl from "./views/RenderControl.svelte";
  import GenerativeWorkbench from "./views/GenerativeWorkbench.svelte";
  import ScriptSheet from "./views/ScriptSheet.svelte";
  import NewCompositionSheet from "./views/NewCompositionSheet.svelte";
  import CacheDrawer from "./views/CacheDrawer.svelte";
  import ServicesDrawer from "./views/ServicesDrawer.svelte";
  import StudioGuide from "./views/StudioGuide.svelte";
  import DedicatedRenderWindow from "./views/DedicatedRenderWindow.svelte";
  import CompositionFrameBar from "./views/CompositionFrameBar.svelte";
  import FeelControl from "./views/FeelControl.svelte";
  import StudioOverture from "./views/StudioOverture.svelte";
  import { feelPreferences } from "./design/preferences";
  import { overtureConditions, shouldShowOverture } from "./design/overture";
  import { studioSound } from "./design/sound";
  import { formatDuration, formatTimecode } from "./design/timecode";
  import { splitVariantName } from "./design/names";
  import { StudioShellViewModel } from "./viewmodels/StudioShell.ViewModel";
  import { CompositionRailViewModel } from "./viewmodels/CompositionRail.ViewModel";
  import { TimelineViewModel } from "./viewmodels/Timeline.ViewModel";
  import { InspectorViewModel } from "./viewmodels/Inspector.ViewModel";
  import { StudioChromeViewModel } from "./viewmodels/StudioChrome.ViewModel";
  import { MediaViewModel } from "./viewmodels/Media.ViewModel";
  import { CodeViewModel } from "./viewmodels/Code.ViewModel";
  import { GitViewModel } from "./viewmodels/Git.ViewModel";
  import { RenderViewModel } from "./viewmodels/Render.ViewModel";
  import { GenerativeViewModel } from "./viewmodels/Generative.ViewModel";
  import { ScriptViewModel } from "./viewmodels/Script.ViewModel";
  import { OperationsViewModel } from "./viewmodels/Operations.ViewModel";
  import { ServicesViewModel } from "./viewmodels/Services.ViewModel";
  import { restoreStudioSelection, serializeStudioSelection } from "./viewmodels/selectionPersistence";
  import { buildRenderWindowUrl, postRenderWindowError, postRenderWindowState, renderWindowRequest } from "./renderWindow";
  import { observableStore, sessionStore } from "./viewmodels/store";
  import "./studio.css";
  import "./design/feel.css";

  export let application: StudioApplication;
  export let gitStatusLabel: string | null = null;

  const runtime = application.runtime;
  const session = application.session;

  const shell = new StudioShellViewModel(session);
  const rail = new CompositionRailViewModel(session);
  const timeline = new TimelineViewModel(session);
  const inspector = new InspectorViewModel(session, application.inspector);
  const chrome = new StudioChromeViewModel();
  const media = new MediaViewModel(application.assets);
  const code = new CodeViewModel(application.source);
  const git = new GitViewModel(application.git);
  const render = new RenderViewModel(application.render, session);
  const generative = new GenerativeViewModel(application.generative, application.assets);
  const script = new ScriptViewModel(session, application.assets);
  const operations = new OperationsViewModel(application.operations);
  const services = new ServicesViewModel(application.credentials);
  const store = shell.store;
  const timelineStore = timeline.store;
  const chromeStore = chrome.store;
  const mediaStore = media.store;
  const operationsStore = operations.store;
  const renderStore = render.store;
  const sessionState = sessionStore(session);
  const historyStore = observableStore(application.history.state);
  const dedicatedRenderRequest = typeof window === "undefined" ? null : renderWindowRequest(window.name);
  const compositionStorageKey = typeof window === "undefined" ? "" : `framediff:composition:${window.location.pathname}`;
  const selectionStorageKey = typeof window === "undefined" ? "" : `framediff:selection:${window.location.pathname}`;
  let rememberComposition = false;

  $: if (rememberComposition && $store.current?.key && compositionStorageKey) {
    window.sessionStorage.setItem(compositionStorageKey, $store.current.key);
  }
  // Keep selection across an explicit refresh or an HMR fallback. Normal composition saves are
  // accepted by the runtime in place and do not remount this shell.
  let unsubscribeSelection: (() => void) | null = null;
  let unsubscribeRenderWindow: (() => void) | null = null;
  let agentSurface: ReturnType<typeof exposeStudioAgentApi> | null = null;
  let agentCheck: AgentCheckResult | null = null;
  let agentChecking = false;
  let agentPanelOpen = false;
  let agentFrame: AgentFrameSnapshot | null = null;
  let agentSnapshotting = false;
  let agentCheckError: string | null = null;
  let agentSnapshotError: string | null = null;
  let mobileActionsOpen = false;
  let guideLoadedId = "";
  let guideCompletedIds: string[] = [];
  let activeGuideStep: StudioGuideStep | null = null;

  // ---- feel: motion, sound, and the first-run overture -------------------------------
  const sound = studioSound();
  const preferences = feelPreferences();
  const overtureStorageKey = typeof window === "undefined" ? "" : `framediff:overture:${window.location.pathname}`;
  let motionEnabled = true;
  let booting = true;
  let overtureOpen = false;
  let renderBurst = false;
  let unsubscribeFeel: (() => void) | null = null;
  let bootTimer: ReturnType<typeof setTimeout> | null = null;
  let burstTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRenderStatus: string | null = null;
  let lastPlaying = false;

  function showOverture(): void {
    overtureOpen = true;
  }

  function dismissOverture(): void {
    overtureOpen = false;
    if (overtureStorageKey) {
      try {
        window.localStorage.setItem(overtureStorageKey, "seen");
      } catch {
        // Without storage the overture reappears next visit; that is better than failing to open.
      }
    }
  }

  function replayOverture(): void {
    if (overtureStorageKey) {
      try {
        window.localStorage.removeItem(overtureStorageKey);
      } catch {
        // Nothing to clear.
      }
    }
    showOverture();
  }

  $: currentTimelineItems = $timelineStore.lanes.flatMap((lane) => lane.items);
  $: authoring = resolveCompositionAuthoring($store.current, currentTimelineItems, $timelineStore.animations, $timelineStore.unrollGroups);
  $: showTimeline = authoring.timeline;
  $: previewFrom = $store.current?.render?.from ?? 0;
  $: previewTo = $store.current?.render?.to ?? $store.current?.durationInFrames ?? 1;
  $: previewLastFrame = Math.max(previewFrom, previewTo - 1);

  $: agentErrorCount = agentCheck?.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length ?? 0;
  $: agentWarningCount = agentCheck?.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length ?? 0;
  $: agentInfoCount = agentCheck?.diagnostics.filter((diagnostic) => diagnostic.severity === "info").length ?? 0;
  $: agentStatusLabel = agentErrorCount
    ? "NEEDS ATTENTION"
    : agentWarningCount
      ? "READY WITH WARNINGS"
      : agentInfoCount
        ? "READY WITH NOTES"
        : "READY";

  const guideStorageKey = (id: string) => `framediff:guide:${id}:completed`;
  const guideExpandedStorageKey = (id: string) => `framediff:guide:${id}:expanded`;

  /**
   * The strip is always there, and that is the whole point of moving the guide up here: the
   * walkthrough is present without costing the workspace anything. The sheet stays folded until
   * someone asks for it — from the overture, the top bar, or STEPS — and then it is remembered.
   */
  function loadGuideProgress(): void {
    const guide = $store.guide;
    if (!guide || guideLoadedId === guide.id || typeof window === "undefined") return;
    guideLoadedId = guide.id;
    try {
      const stored = JSON.parse(window.localStorage.getItem(guideStorageKey(guide.id)) ?? "[]") as unknown;
      guideCompletedIds = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
    } catch {
      guideCompletedIds = [];
    }
    try {
      chrome.setGuideExpanded(window.localStorage.getItem(guideExpandedStorageKey(guide.id)) === "1");
    } catch {
      chrome.setGuideExpanded(false);
    }
  }

  function setGuideExpanded(expanded: boolean): void {
    chrome.setGuideExpanded(expanded);
    if (!$store.guide || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(guideExpandedStorageKey($store.guide.id), expanded ? "1" : "0");
    } catch {
      // A remembered fold is a nicety; losing it must never break the guide.
    }
  }

  function setGuideStepComplete(stepId: string, complete: boolean): void {
    const next = new Set(guideCompletedIds);
    if (complete) next.add(stepId); else next.delete(stepId);
    guideCompletedIds = [...next];
    if ($store.guide && typeof window !== "undefined") window.localStorage.setItem(guideStorageKey($store.guide.id), JSON.stringify(guideCompletedIds));
  }

  function resetGuideProgress(): void {
    guideCompletedIds = [];
    activeGuideStep = null;
    if ($store.guide && typeof window !== "undefined") window.localStorage.removeItem(guideStorageKey($store.guide.id));
  }

  async function runAgentCheck(): Promise<void> {
    if (agentChecking) return;
    agentPanelOpen = true;
    agentChecking = true;
    agentCheckError = null;
    try {
      agentCheck = await agentSurface?.api.check() ?? null;
    } catch (error) {
      agentCheckError = error instanceof Error ? error.message : String(error);
    } finally {
      agentChecking = false;
    }
  }

  async function snapshotAgentFrame(): Promise<void> {
    const state = session.state.get();
    if (!agentSurface || !state.currentKey || agentSnapshotting) return;
    agentSnapshotting = true;
    agentSnapshotError = null;
    try {
      agentFrame = await agentSurface.api.snapshot(state.currentKey, state.frame);
    } catch (error) {
      agentSnapshotError = error instanceof Error ? error.message : String(error);
    } finally {
      agentSnapshotting = false;
    }
  }

  function openGuideStep(step: StudioGuideStep): void {
    activeGuideStep = step;
    // Doing the task needs the workspace, so the sheet folds back to the strip that names it.
    setGuideExpanded(false);
    const target = step.target;
    shell.open(target.compositionKey);
    if (target.frame != null) shell.setFrame(target.frame);
    if (target.selection?.kind === "clip") session.selectItem(target.selection.objectId);
    else if (target.selection?.kind === "element") session.selectElement(target.selection.objectId, target.selection.ownerItemId);
    else if (target.selection?.kind === "animation") session.selectAnimation(target.selection.objectId);

    if (target.panel === "media") chrome.showLeft("media");
    else if (target.panel === "code") chrome.showRight("code");
    else if (target.panel === "cache") chrome.setCacheOpen(true);
    else if (target.panel === "agent") void runAgentCheck();
    else if (target.panel === "inspector" || target.selection) chrome.showRight("inspector");
  }

  function completeGuideStepAndContinue(): void {
    if (!activeGuideStep || !$store.guide) return;
    setGuideStepComplete(activeGuideStep.id, true);
    const index = $store.guide.steps.findIndex((step) => step.id === activeGuideStep?.id);
    const next = $store.guide.steps[index + 1];
    if (next) openGuideStep(next);
    else {
      // The last DONE is the payoff — open the whole map back up so the finish is visible.
      activeGuideStep = null;
      setGuideExpanded(true);
    }
  }

  $: loadGuideProgress();

  // A finished render is the product's payoff: chime, ring, and hand the sound engine back.
  $: {
    const status = $renderStore.status;
    if (status !== lastRenderStatus) {
      if (status === "rendering") sound.setDucked(true);
      else sound.setDucked(false);
      if (lastRenderStatus === "rendering" && status === "done") {
        sound.play("chime");
        renderBurst = true;
        if (burstTimer) clearTimeout(burstTimer);
        burstTimer = setTimeout(() => { renderBurst = false; }, 950);
      } else if (status === "error") {
        sound.play("alert");
      }
      lastRenderStatus = status;
    }
  }

  $: if ($store.playing !== lastPlaying) {
    sound.play($store.playing ? "play" : "pause");
    lastPlaying = $store.playing;
  }

  /**
   * Collapse a deep composition path to first · … · parent · current.
   *
   * Nesting three or four levels deep is normal in this product, and the flex row used to shrink
   * every crumb until the whole trail read "Stu… › Ed… › Her… › H… › Her…". Dropping the middle
   * entries behind a single "…" (which still navigates, and names what it hides) keeps the
   * crumbs that answer "where am I" legible at full length.
   */
  type Crumb = { key: string; label: string; title: string; separator: boolean; ellipsis?: boolean };
  $: breadcrumbCrumbs = ((path: typeof $store.path): Crumb[] => {
    const crumb = (composition: (typeof path)[number], separator: boolean): Crumb => ({
      key: composition.key,
      label: composition.id,
      title: composition.file ? `${composition.id}\n${composition.file}` : composition.id,
      separator,
    });
    if (path.length <= 3) return path.map((composition, index) => crumb(composition, index > 0));
    const hidden = path.slice(1, -2);
    return [
      crumb(path[0], false),
      {
        key: hidden[hidden.length - 1].key,
        label: "…",
        title: `${hidden.length} more: ${hidden.map((composition) => composition.id).join(" › ")}`,
        separator: true,
        ellipsis: true,
      },
      crumb(path[path.length - 2], true),
      crumb(path[path.length - 1], true),
    ];
  })($store.path);

  $: currentFps = $store.current?.fps ?? 24;
  $: relativeFrame = $store.frame - ($store.current?.render?.from ?? 0);
  $: outputFrames = $store.current?.render
    ? $store.current.render.to - $store.current.render.from
    : $store.current?.durationInFrames ?? 0;
  $: busyStatus = $historyStore.applying || $store.editing || $store.loading;
  $: renderProgressRatio = $renderStore.status === "rendering" && $renderStore.progress
    ? Math.min(1, Math.max(0, $renderStore.progress.completed / Math.max(1, $renderStore.progress.total)))
    : null;

  /** Land in a just-created comp: remember it for the full-reload path (source writes reload
   *  the page), and open it as soon as the registry replace delivers it in-page. The open is
   *  deferred to a microtask — navigating from inside a state notification would re-enter it. */
  function openCreatedComposition(compositionKey: string): void {
    if (compositionStorageKey) window.sessionStorage.setItem(compositionStorageKey, compositionKey);
    const deadline = Date.now() + 8000;
    let done = false;
    const unsubscribe = session.state.subscribe((state) => {
      if (done) return;
      const landed = state.compositions.some((composition) => composition.key === compositionKey);
      if (!landed && Date.now() <= deadline) return;
      done = true;
      queueMicrotask(() => {
        unsubscribe();
        if (landed) shell.open(compositionKey);
      });
    });
  }

  function selectedTimelineItem() {
    const state = session.state.get();
    const items = state.timelineByComposition[state.currentKey] ?? [];
    return items.find((item) => item.id === state.selectedItemId) ?? null;
  }

  function onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.matches("input, textarea, select, [contenteditable='true']")) return;
    if (event.key === "Escape" && (mobileActionsOpen || $chromeStore.leftOpen || $chromeStore.rightOpen)) {
      event.preventDefault();
      mobileActionsOpen = false;
      chrome.closePanels();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) void application.history.redo();
      else void application.history.undo();
    } else if (event.code === "Space") {
      event.preventDefault();
      shell.togglePlaying();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const next = $store.frame + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 1);
      shell.setFrame(next);
      // Pitch tracks position in the composition, so holding an arrow key reads as a rising or
      // falling run rather than a repeated click.
      sound.play("detent", { position: next / Math.max(1, $store.current?.durationInFrames ?? 1) });
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const render = $store.current?.render;
      shell.setFrame(event.key === "Home" ? render?.from ?? 0 : (render?.to ?? $store.current?.durationInFrames ?? 1) - 1);
      sound.play("detent", { position: event.key === "Home" ? 0 : 1 });
    } else if (event.key === "," || event.key === ".") {
      // nudge the selected clip by a frame (shift = 10)
      const item = selectedTimelineItem();
      if (item?.editable?.from) {
        event.preventDefault();
        const step = (event.key === "," ? -1 : 1) * (event.shiftKey ? 10 : 1);
        void session.editTimelineItem(item.id, { from: item.from + step, durationInFrames: item.durationInFrames });
      }
    } else if (event.key === "[" || event.key === "]") {
      // trim the selected clip's in/out point to the playhead
      const item = selectedTimelineItem();
      if (item) {
        const playhead = Math.round(session.state.get().frame);
        if (event.key === "[" && item.editable?.from && item.editable?.duration) {
          const end = item.from + item.durationInFrames;
          if (playhead < end) {
            event.preventDefault();
            void session.editTimelineItem(item.id, { from: playhead, durationInFrames: end - playhead });
          }
        } else if (event.key === "]" && item.editable?.duration && playhead > item.from) {
          event.preventDefault();
          void session.editTimelineItem(item.id, { from: item.from, durationInFrames: playhead - item.from });
        }
      }
    } else if (event.key === "Delete" || event.key === "Backspace") {
      const item = selectedTimelineItem();
      if (session.state.get().selection?.kind === "clip" && item?.editable?.delete) {
        event.preventDefault();
        void session.deleteTimelineItems([item.id]);
      }
    } else if (event.key === "Escape") {
      if (window.matchMedia("(max-width: 900px)").matches && $chromeStore.rightOpen) chrome.closeRight();
      else if ($mediaStore.selected) media.clearSelection();
      else session.selectItem(null);
    }
  }

  onMount(() => {
    const projectUrl = buildRenderWindowUrl(window.location.href);
    if (projectUrl !== window.location.href) window.history.replaceState(window.history.state, "", projectUrl);
    if (dedicatedRenderRequest) {
      unsubscribeRenderWindow = application.render.state.subscribe((state) => postRenderWindowState(dedicatedRenderRequest.token, state));
      void application.start()
        .then(async () => {
          if (!session.state.get().compositions.some((composition) => composition.key === dedicatedRenderRequest.compositionKey)) {
            throw new Error("The requested composition is not available to render.");
          }
          session.navigate(dedicatedRenderRequest.compositionKey);
          const started = await application.render.renderCurrent();
          if (!started && application.render.state.get().status === "idle") {
            throw new Error("The requested composition is not available to render.");
          }
        })
        .catch((error) => postRenderWindowError(dedicatedRenderRequest.token, error));
      return;
    }
    unsubscribeFeel = preferences.subscribe((value) => { motionEnabled = value.motion; });
    // The assembly animation is a one-shot; leaving the class on would replay it on every
    // layout-affecting state change.
    bootTimer = setTimeout(() => { booting = false; }, 900);
    // Audio hardware stays untouched until a real gesture, which is both the browser's rule and
    // the polite one. Arming here means the first click is already in tune.
    const unlock = () => sound.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    agentSurface = exposeStudioAgentApi(application);
    const rememberedComposition = window.sessionStorage.getItem(compositionStorageKey);
    void application.start().then(() => {
      if (shouldShowOverture(overtureConditions(overtureStorageKey))) showOverture();
      if (rememberedComposition && session.state.get().compositions.some((composition) => composition.key === rememberedComposition)) {
        shell.open(rememberedComposition);
      }
      const rememberedSelection = selectionStorageKey ? window.sessionStorage.getItem(selectionStorageKey) : null;
      restoreStudioSelection(session, rememberedSelection);
      rememberComposition = true;
      unsubscribeSelection = session.state.subscribe((state) => {
        if (!rememberComposition || !selectionStorageKey) return;
        if (state.selection) media.clearSelection();
        const storedSelection = serializeStudioSelection(state);
        if (storedSelection) window.sessionStorage.setItem(selectionStorageKey, storedSelection);
        else window.sessionStorage.removeItem(selectionStorageKey);
      });
    });
    window.addEventListener("keydown", onKeyDown);
  });

  onDestroy(() => {
    window.removeEventListener("keydown", onKeyDown);
    unsubscribeSelection?.();
    unsubscribeRenderWindow?.();
    unsubscribeFeel?.();
    if (bootTimer) clearTimeout(bootTimer);
    if (burstTimer) clearTimeout(burstTimer);
    agentSurface?.dispose();
    script.destroy();
    application.destroy();
  });
</script>

{#if dedicatedRenderRequest}
  <DedicatedRenderWindow viewModel={render} compositionName={$store.current?.id ?? ""} />
{:else}
<div
  class="framediff-studio"
  class:booting
  class:transport-playing={$store.playing}
  data-feel-motion={motionEnabled ? "on" : "off"}
>
  {#if overtureOpen}
    <StudioOverture
      projectName={$store.path[0]?.id ?? $store.current?.id ?? ""}
      compositionCount={$sessionState.compositions.length}
      hasGuide={!!$store.guide}
      onopenguide={() => setGuideExpanded(true)}
      ondismiss={dismissOverture}
    />
  {/if}
  <header class="topbar">
    <div class="studio-brand"><span class="mark"></span><strong>FRAMEDIFF</strong><span class="edition">STUDIO</span></div>
    <button class="compact-left-button" onclick={() => chrome.openLeft()} aria-label="Open compositions and media" title="Open compositions and media" aria-expanded={$chromeStore.leftOpen}>
      COMPS
    </button>
    <button class="up-button" disabled={$store.path.length <= 1} onclick={() => shell.goUp()} title="Up one composition" aria-label="Up one composition">
      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10.5 10.5 4 4M4 9.5V4h5.5"/></svg>
    </button>
    <div class="current breadcrumb">
      {#if $store.current}
        <!-- A deep path used to shrink every crumb into an unreadable stub ("Stu… › Ed… › Her…").
             Collapsing the middle instead keeps the two crumbs that carry meaning — where you
             started and where you are — at full length. -->
        {#each breadcrumbCrumbs as crumb (crumb.key)}
          {#if crumb.separator}<span class="crumb-separator">›</span>{/if}
          {#if crumb.ellipsis}
            <button class="crumb-more" title={crumb.title} onclick={() => shell.open(crumb.key)}>…</button>
          {:else}
            {@const name = splitVariantName(crumb.label)}
            <button class:active={crumb.key === $store.current.key} title={crumb.title} onclick={() => shell.open(crumb.key)}>
              <span class="name-stem">{name.stem}</span>{#if name.suffix}<span class="name-suffix">{name.suffix}</span>{/if}
            </button>
          {/if}
        {/each}
        <span class="kind kind-{$store.current.kind}">{$store.current.kind}</span>
        {#if $store.current.file}<span class="file">{$store.current.file}</span>{/if}
      {/if}
    </div>
    <div class="top-status" class:busy={busyStatus} class:error={$store.error || $operationsStore.error || $historyStore.error}>
      <span class="status-pulse" aria-hidden="true"></span>{#if $historyStore.applying}restoring source…{:else if $store.editing}writing source…{:else if $store.loading}reading the composition…{:else if $store.error}{$store.error}{:else if $historyStore.error}{$historyStore.error}{:else if $operationsStore.error}{$operationsStore.error}{:else if $operationsStore.message}{$operationsStore.message}{:else}ready{/if}
    </div>
    <GitStatus viewModel={git} statusLabel={gitStatusLabel} />
    {#if $store.guide}
      <button class="studio-guide-button" class:active={$chromeStore.guideExpanded} onclick={() => setGuideExpanded(!$chromeStore.guideExpanded)} title="Show the project walkthrough" aria-expanded={$chromeStore.guideExpanded}>
        <span>GUIDE</span><small>{guideCompletedIds.length}/{$store.guide.steps.length}</small>
      </button>
    {/if}
    <button class="compact-panel-button" onclick={() => chrome.openRight()} aria-label="Open side panel" title="Open Inspector or Code" aria-expanded={$chromeStore.rightOpen}>
      PANEL
    </button>
    <button class="mobile-actions-button" class:active={mobileActionsOpen} onclick={() => mobileActionsOpen = !mobileActionsOpen} aria-label="Open project actions" aria-expanded={mobileActionsOpen}>
      MORE
    </button>
    <div class="top-group" role="group" aria-label="Project actions">
      <button class="top-action" onclick={() => void application.history.undo()} disabled={!$historyStore.undo.length || $historyStore.applying} title={$historyStore.undo.length ? `Undo ${$historyStore.undo[$historyStore.undo.length - 1].label} (⌘/Ctrl+Z)` : "Nothing to undo"}>Undo</button>
      <button class="top-action" onclick={() => void application.history.redo()} disabled={!$historyStore.redo.length || $historyStore.applying} title={$historyStore.redo.length ? `Redo ${$historyStore.redo[$historyStore.redo.length - 1].label} (⌘/Ctrl+Shift+Z)` : "Nothing to redo"}>Redo</button>
      <button class="top-action" onclick={() => { sound.play("open"); chrome.setServicesOpen(true); }} title="Configure generative service credentials">Services</button>
      <button class="top-action" onclick={() => { sound.play("open"); chrome.setCacheOpen(true); }} title="Cached renders and bakes">Cache</button>
      <button class="refresh" onclick={() => { sound.play("tap"); void shell.refresh(); }} title="Reload compositions from source" aria-label="Reload compositions">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M13.5 8a5.5 5.5 0 1 1-2-4.24"/><path d="M13.7 2.3v3.2h-3.2"/></svg>
      </button>
      <FeelControl onreplayintro={replayOverture} />
      <div class="render-anchor">
        <RenderControl viewModel={render} />
        <span class="render-burst" class:firing={renderBurst} aria-hidden="true"></span>
      </div>
    </div>
  </header>

  {#if $store.guide}
    <StudioGuide
      guide={$store.guide}
      currentKey={$store.current?.key ?? ""}
      completedIds={guideCompletedIds}
      expanded={$chromeStore.guideExpanded}
      activeStep={activeGuideStep}
      onopen={openGuideStep}
      oncomplete={setGuideStepComplete}
      onreset={resetGuideProgress}
      onexpand={(expanded) => { sound.play(expanded ? "open" : "close"); setGuideExpanded(expanded); }}
      onadvance={completeGuideStepAndContinue}
      ondismissactive={() => activeGuideStep = null}
    />
  {/if}

  {#if mobileActionsOpen}
    <aside class="mobile-actions-menu" aria-label="Project actions menu">
      <div class="mobile-actions-heading"><strong>PROJECT ACTIONS</strong><button onclick={() => mobileActionsOpen = false} aria-label="Close project actions">×</button></div>
      <div class="mobile-actions-grid">
        {#if $store.guide}<button class="mobile-menu-action" onclick={() => { mobileActionsOpen = false; setGuideExpanded(true); }}>Guide <small>{guideCompletedIds.length}/{$store.guide.steps.length}</small></button>{/if}
        <button class="mobile-menu-action" onclick={() => void application.history.undo()} disabled={!$historyStore.undo.length || $historyStore.applying}>Undo</button>
        <button class="mobile-menu-action" onclick={() => void application.history.redo()} disabled={!$historyStore.redo.length || $historyStore.applying}>Redo</button>
        <button class="mobile-menu-action" onclick={() => { mobileActionsOpen = false; chrome.setServicesOpen(true); }}>Services</button>
        <button class="mobile-menu-action" onclick={() => { mobileActionsOpen = false; chrome.setCacheOpen(true); }}>Cache</button>
        <button class="mobile-menu-action" onclick={() => { mobileActionsOpen = false; void shell.refresh(); }}>Reload source</button>
      </div>
      <RenderControl viewModel={render} />
    </aside>
  {/if}

  {#if agentPanelOpen}
    <aside class="agent-check-panel" aria-label="Agent project check">
      <header>
        <div><strong>AGENT PROJECT CHECK</strong><span>inspect · check · snapshot · execute</span></div>
        <button onclick={() => { agentPanelOpen = false; }} aria-label="Close agent project check">×</button>
      </header>
      {#if agentChecking}
        <p>Refreshing stable IDs, source authority, assets and artifact fingerprints…</p>
      {:else if agentCheckError}
        <div class="agent-check-error" role="alert"><strong>CHECK FAILED</strong><span>{agentCheckError}</span><button onclick={() => void runAgentCheck()}>TRY AGAIN</button></div>
      {:else if agentCheck}
        <div class:pass={!agentErrorCount && !agentWarningCount} class:warn={!agentErrorCount && agentWarningCount > 0} class:fail={agentErrorCount > 0} class="agent-check-summary">
          <strong>{agentStatusLabel}</strong>
          <span>{agentCheck.diagnostics.length} diagnostic{agentCheck.diagnostics.length === 1 ? "" : "s"}{agentWarningCount ? ` · ${agentWarningCount} warning${agentWarningCount === 1 ? "" : "s"}` : ""} · {agentCheck.revision.slice(0, 19)}…</span>
        </div>
        {#if agentCheck.diagnostics.length}
          <ul>
            {#each agentCheck.diagnostics.slice(0, 10) as diagnostic}
              <li class:warning={diagnostic.severity === "warning"} class:error={diagnostic.severity === "error"}>
                <span>{diagnostic.severity}</span><p>{diagnostic.compositionKey ? `${diagnostic.compositionKey} · ` : ""}{diagnostic.message}</p>
              </li>
            {/each}
          </ul>
          {#if agentCheck.diagnostics.length > 10}<small>+ {agentCheck.diagnostics.length - 10} more in <code>window.__framediffAgent.check()</code></small>{/if}
        {:else}
          <p>No unsupported edit constructs, missing media or stale artifacts were found.</p>
        {/if}
        <div class="agent-check-actions">
          <button onclick={() => void runAgentCheck()}>REFRESH CHECK</button>
          <button class="primary" onclick={() => void snapshotAgentFrame()} disabled={agentSnapshotting}>{agentSnapshotting ? "CAPTURING…" : "SNAPSHOT CURRENT FRAME"}</button>
        </div>
        {#if agentSnapshotError}<div class="agent-check-error" role="alert"><strong>SNAPSHOT FAILED</strong><span>{agentSnapshotError}</span><button onclick={() => void snapshotAgentFrame()}>TRY AGAIN</button></div>{/if}
        {#if agentFrame}
          <figure class="agent-frame-result">
            <img src={agentFrame.dataUrl} alt={`Exact ${agentFrame.compositionKey} frame ${agentFrame.frame}`} />
            <figcaption><strong>{agentFrame.compositionKey} · {agentFrame.frame}f</strong><span>{agentFrame.width}×{agentFrame.height} · {agentFrame.contentHash.slice(0, 23)}…</span></figcaption>
          </figure>
        {/if}
      {/if}
    </aside>
  {/if}

  {#if $chromeStore.leftOpen || $chromeStore.rightOpen}
    <button class="panel-scrim" class:left={$chromeStore.leftOpen} class:right={$chromeStore.rightOpen} onclick={() => chrome.closePanels()} aria-label="Close open panel"></button>
  {/if}

  <main>
    <section class="left-panel" class:compact-open={$chromeStore.leftOpen}>
      <nav class="panel-tabs" aria-label="Left panel">
        <button class:active={$chromeStore.left === "compositions"} onclick={() => { sound.play("open"); chrome.showLeft("compositions"); }}>COMPS</button>
        <button class:active={$chromeStore.left === "media"} onclick={() => { sound.play("open"); chrome.showLeft("media"); }}>MEDIA</button>
        <button class="panel-close" onclick={() => { sound.play("close"); chrome.closeLeft(); }} aria-label="Close compositions panel">×</button>
      </nav>
      {#if $chromeStore.left === "compositions"}
        <CompositionRail
          viewModel={rail}
          onnewcomposition={() => { sound.play("open"); chrome.setNewCompositionOpen(true); }}
          onopen={() => chrome.closeLeft()}
          onduplicate={(key) => void operations.copy(key)}
          oncopytolibrary={(key) => void operations.copy(key, { library: true })}
          onnest={(targetKey, sourceKey) =>
            void operations.nest(targetKey, sourceKey).then((ok) => {
              if (ok) shell.open(targetKey);
            })}
          ondelete={(key) => void operations.delete(key)}
        />
      {:else}
        <MediaPanel
          viewModel={media}
          onselect={() => {
            session.selectItem(null);
            chrome.showRight("inspector");
          }}
        />
      {/if}
    </section>

    <section class="workspace" class:generate-workspace={$store.current?.kind === "generate"} class:script-workspace={$store.current?.kind === "script"} class:timeline-hidden={!showTimeline} class:transport-hidden={!authoring.transport}>
      <CompositionFrameBar composition={$store.current} operations={$operationsStore} onbake={() => void operations.bakeCurrent()} />
      {#if $store.current?.kind === "generate"}
        <GenerativeWorkbench viewModel={generative} {runtime} {session} onservices={() => chrome.setServicesOpen(true)} />
      {:else if $store.current?.kind === "script"}
        <ScriptSheet viewModel={script} {runtime} />
      {:else}
      <div class="preview-panel">
        <PreviewHost
          {runtime}
          {session}
          cachedArtifact={$operationsStore.currentBake?.status === "current" && $operationsStore.currentBake.compositionKey === $store.current?.key
            ? $operationsStore.currentBake.artifact
            : undefined}
          directManipulation={authoring.directManipulation}
          renderProgress={renderProgressRatio}
          faulted={!!($store.error || $renderStore.error)}
          onselect={() => { sound.play("select"); chrome.showRight("inspector"); }}
        />
      </div>

      {#if authoring.transport}
      <div class="transport">
        <button class="t-btn t-step" onclick={() => shell.setFrame($store.frame - 1)} title="Back one frame (← in the studio, shift for 10)" aria-label="Back one frame">
          <svg viewBox="0 0 14 14"><path d="M3.6 2.5v9" stroke="currentColor" stroke-width="1.5"/><path d="M11.5 2.8v8.4L5.4 7z" fill="currentColor"/></svg>
        </button>
        <button class="t-btn t-play" onclick={() => shell.togglePlaying()} title="Play / pause (Space)" aria-label={$store.playing ? "Pause" : "Play"}>
          {#if $store.playing}
            <svg viewBox="0 0 14 14"><path d="M4 2.5h2.2v9H4zM7.8 2.5H10v9H7.8z" fill="currentColor"/></svg>
          {:else}
            <svg viewBox="0 0 14 14"><path d="M4.6 2.4L12 7l-7.4 4.6z" fill="currentColor"/></svg>
          {/if}
        </button>
        <button class="t-btn t-step" onclick={() => shell.setFrame($store.frame + 1)} title="Forward one frame (→ in the studio, shift for 10)" aria-label="Forward one frame">
          <svg viewBox="0 0 14 14"><path d="M10.4 2.5v9" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 2.8v8.4L8.6 7z" fill="currentColor"/></svg>
        </button>
        {#if showTimeline}
          <span class="t-hint">scrub in the timeline below</span>
        {:else}
          <label class="time-scrubber">
            <span>TIME</span>
            <input
              aria-label="Preview frame"
              type="range"
              min={previewFrom}
              max={previewLastFrame}
              step="1"
              value={$store.frame}
              oninput={(event) => shell.setFrame(Number(event.currentTarget.value))}
            />
          </label>
        {/if}
        <span class="spacer"></span>
        <span class="timecode-group" title={`Output time — 0 is the render window's start · ${currentFps}fps`}>
          <span class="tc">{formatTimecode(relativeFrame, currentFps)}</span>
          <span class="tc-frames">{String(relativeFrame).padStart(4, "0")}f</span>
          <span class="tc-total">/ {outputFrames} · {formatDuration(outputFrames, currentFps)}</span>
        </span>
      </div>

      {#if showTimeline}
        <Timeline
          viewModel={timeline}
          acceptCompositionDrop={authoring.acceptsCompositionDrop}
          onselect={() => chrome.showRight("inspector")}
          oncompositiondrop={(sourceKey, from) => {
            const targetKey = $store.current?.key ?? "";
            void operations.nest(targetKey, sourceKey, from);
          }}
        />
      {/if}
      {/if}
      {/if}
    </section>

    <section class="right-panel" class:compact-open={$chromeStore.rightOpen}>
      <nav class="panel-tabs" aria-label="Right panel">
        <button class:active={$chromeStore.right === "inspector"} onclick={() => { sound.play("open"); chrome.showRight("inspector"); }}>INSPECT</button>
        <button class:active={$chromeStore.right === "code"} onclick={() => { sound.play("open"); chrome.showRight("code"); }}>CODE</button>
        <button class="panel-close" onclick={() => { sound.play("close"); chrome.closeRight(); }} aria-label="Close side panel">×</button>
      </nav>
      {#if $chromeStore.right === "inspector"}
        <Inspector viewModel={inspector} mediaViewModel={media} />
      {:else}
        <CodeView viewModel={code} />
      {/if}
    </section>
  </main>
  {#if $chromeStore.newCompositionOpen && $store.current}
    <NewCompositionSheet
      current={$store.current}
      viewModel={operations}
      onclose={() => chrome.setNewCompositionOpen(false)}
      oncreated={openCreatedComposition}
    />
  {/if}
  {#if $chromeStore.cacheOpen}<CacheDrawer viewModel={operations} onclose={() => chrome.setCacheOpen(false)} />{/if}
  {#if $chromeStore.servicesOpen}
    <ServicesDrawer
      viewModel={services}
      onclose={() => chrome.setServicesOpen(false)}
      onchange={() => void application.generative.refresh()}
    />
  {/if}
</div>
{/if}
