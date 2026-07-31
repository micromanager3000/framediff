# Timeline Lab — twenty-two ideas, one system

An interactive prototype of the next FrameDiff Studio timeline. Everything below is **built and working** in [index.html](./index.html) unless marked *proposed*.

```bash
cd prototypes/timeline && python3 -m http.server 4179
# → http://localhost:4179   (or open index.html directly)
```

The brief: a zoom bubble for fine-grained editing while dragging, sticky clip ends, and a way to insert time that pushes everything downstream. Those three turned out to be corners of one design — **precision, magnetism, and elastic time** — and the rest of the ideas fill in that triangle rather than piling on features. The IDEAS drawer inside the prototype annotates every idea in place; hovering an idea flashes the UI it lives in.

Research inputs: deep dives on the pro NLEs (FCPX, Premiere, Resolve, Avid, iMovie), DAWs (Pro Tools, Ableton, Logic, FL), modern tools (CapCut, Descript, Screen.studio, Rive/Jitter/Fable, Theatre.js, GSDevTools, Remotion), OS-level micro-patterns (iOS loupe, QuickTime, YouTube, Figma, Force Touch haptics), the delight literature on snap physics and spring settles — plus a full source-map read of the **HyperFrames editor** (typed priority snapping, log zoom tuned "CapCut-strength" from user feedback, beat strip, ⇧-blade-all-tracks) and a map of our own `Timeline.svelte`. Digests live in the research appendix at the bottom.

---

## The system in one paragraph

Every temporal operation in the prototype speaks the same language. One **snap engine** (typed, weighted, sticky) serves moves, trims, rolls, the blade, the playhead, markers, motion keys, and the time wedge — so "sticky ends" isn't a feature of dragging, it's a property of the world. One **ripple engine** serves the ＋TIME wedge, magnetic trims, gap closing, deletes, and take swaps — so "push everything back" isn't a special tool, it's what time-changing edits do. One **loupe** appears wherever frame precision matters. One **HUD grammar** narrates every gesture. Connected clips ride their parents through *all* of it. That's what "holistically integrated" means here: 21 ideas, 4 shared mechanisms.

---

## A · PRECISION — land the exact frame without leaving context

**1 · Precision loupe** — *iOS text magnifier · Resolve's Cut-page dual timeline · QuickTime dwell-zoom*
A zoomed bubble opens above the pointer during any edge drag: frame ticks, beat dots, the neighbor clips at their **live rippled positions**, snap targets, media-limit brackets, the playhead. Resolve's dual timeline proved "a perfectly-zoomed detail view you never manage" kills the zoom-in/zoom-out oscillation; the iOS loupe's removal-and-revolt (Apple removed it in iOS 13, users rebelled, it returned in 15) is the strongest evidence that pointers hide exactly the thing being edited. Ours is that pair decomposed: minimap above (context), loupe at the pointer (detail). During slips it flips to a **source-space view** showing the in/out window sliding over the footage.

**2 · Fine drag (⇧)** — *DAW fine-adjust · iOS variable-speed scrubbing*
Hold ⇧ mid-gesture: pointer gain drops to 1/7, sub-frame movement accumulates, the loupe opens, snap radii tighten so stickiness doesn't swallow the precision you just asked for. Precision is a *modifier you can enter mid-drag*, never a mode or a re-grab — the same reason iOS lets you slide off the scrubber into finer rates without lifting your finger.

**3 · Headroom & hold-frame** — *the studio's `clip-overrun`, evolved · FCPX red-edge convention*
Both ends of the footage are physical. Trimming toward a media edge, the edge *sticks* at the first/last real frame (its own detent with a tick — independent of grid snapping, `⌥` bypasses), then breaks through with a low thud into hold-frame territory: head trims freeze the first frame, tail trims freeze the last. Hold zones hatch cool-blue with a `❚❚ Nf` label live during the drag, the trim handle turns blue, the loupe draws the media bracket and shades HOLD, and the monitor previews the frozen frame (`src 0f · hold`). Red stays reserved for the one true wall — the 1-frame minimum.

## B · MAGNETISM — sticky ends that never feel grabby

**4 · Sticky edges with breakaway** — *Keynote/Pages alignment haptics · "escape velocity" snap literature*
Your ask, engineered: snapping has **hysteresis**. An edge locks on inside ~9px, *holds* through small wobbles, and only releases past ~22px — with a tick on capture and a pop on breakaway. This is materially different from the studio's current threshold snap (which re-evaluates every move and can flicker at the boundary), and it's the fix for the #1 documented snap complaint ("it keeps jumping past the sweet spot — too sticky *and* too loose"). ⌥ bypasses momentarily, exactly as today.

**5 · Named snap targets** — *first principles; nobody does this and everybody should*
Targets are typed and weighted (playhead > clip edges > markers > motion keys > downbeats > beats — the same priority scheme HyperFrames encodes), and the HUD **names** what you're stuck to: `⇢ hero out`, `⇢ downbeat`, `⇢ playhead`. Alignment becomes a stated fact instead of a visual guess. The guide line even recolors (green for beats).

**6 · Beat grid** — *CapCut auto-beat · Ableton's adaptive grid · Pro Tools tab-to-transient*
The music track publishes its beats to the ruler (dots, downbeats heavier), the loupe, and the snap engine. "Snap to meaning, not just to grid" was the single strongest cross-tool delight pattern: content-derived targets read as *the tool understands my material*. For a studio whose promos are music-driven, beats are the native grid. *(Proposed on top: relative beat snap — quantize the delta, keep a clip's intentional pre-beat offset — Pro Tools' Relative Grid.)*

## C · ELASTIC TIME — your ripple-insert ask, generalized

**7 · The ＋TIME wedge** — *Logic's Insert Silence · Pro Tools Shuffle · FCPX insert*
Press R, drag anywhere: a hatched wedge opens and **everything downstream shifts live** — scenes, SFX, captions riding their parents, markers, motion keys, and the render window itself grows. Drag *left* to remove time, clamped so nothing can collide (the plan computes the max pull per track). Snaps to beats. HUD: `＋TIME at 6.50s · +105f · +3.50s · 12 clips ride · ⇢ downbeat`. This is the tool for the generative reality that scene durations *change* — regenerate a longer hero and you open time for it in one gesture.

**Straddle policy — split for sync, flow for beds.** What happens to a clip that *spans* the insert point? Logic's Insert Silence splits regions at the locator so content stays synced; every editor treats music beds as things that keep playing. Both are right, for different clips — so the wedge does both by kind:
- **Sync clips split** (scenes, SFX, captions): cut at the point, the tail rides downstream with everything it was synced to. During the drag they show a dashed will-split outline; the HUD lists them (`✂ hero`).
- **Beds flow** (music): the clip spans the insert and **grows by the inserted amount**, so it keeps playing *and still reaches the end* — you can watch the waveform stretch live. (A bed that merely stayed put would end early; that was the old behavior's quiet bug.)
- **Every choice is one gesture to reverse**: a split leaves a *seam* — its gap chip offers **≈ bridge** (merge the halves back into one flowing clip) next to **× close** (opt that track out). Want the music split after all? **Blade it at the point first** — pre-cut clips ride like anything else. **Lock** still means "don't touch." Dragging the wedge *left* eats into a straddler's tail (range removal), bounded so the tail survives.
Defaults follow intent, previews are honest, and nothing needs a mode.

**8 · Gaps are objects** — *FCPX gap clips · Resolve close-up*
Hover any gap: a chip states its duration with **× close** (ripple delete, springy) and — when the gap's neighbors are two source-continuous halves of the same clip — **≈ bridge**, which merges them back into one clip that plays through (the split→flow converter from idea 7). On the magnetic track, inserted time **materializes as a dashed gap clip** you can trim, move, or delete like anything else. This is the joint that makes ideas 7 and 12 one system instead of two: the wedge *creates* gap objects, deleting one *is* a negative wedge, and bridging one re-decides the straddle policy after the fact.

**9 · Ripple trim** — *FCPX default trim · Premiere's yellow trim*
On magnetic tracks, edge trims ripple automatically — downstream follows live while you drag, previewed truthfully (head trims hold the junction and eat the filmstrip, exactly like FCPX). On free tracks, ⌘-drag an edge to ripple. Follows the industry color grammar: amber handles = healing edits.

**10 · Roll at junctions** — *Premiere roll · Avid dual-rollers*
Hover where two scenes meet: a ⟷ handle appears; dragging moves the boundary — one grows, one shrinks, **nothing downstream moves**. The counterpart to ripple: change the cut, not the schedule.

**11 · Slip in place** — *Premiere/Avid slip*
⌥-drag inside a clip slides its source under fixed in/out. The filmstrip visibly slides, and the loupe flips to source view with the in/out bracket. For FrameDiff this is how you re-time *which moment* of a generated take plays without touching the edit's rhythm.

## D · STRUCTURE — relationships that survive editing

**12 · Magnetic storyline, per track** — *FCPX's magnetic timeline, made opt-in*
The research is unambiguous: the magnetic timeline is the most loved *and* most hated idea in modern editing ("once it clicks, there's no going back" vs. a decade of "give me an off switch"). First-principles resolution: **magnetism is a track property, not a worldview**. SCENES ships magnetic (no gaps, no overlaps; drag to reorder with parting neighbors, an insertion caret, and a spring repack); overlays and SFX stay free-staged like today's studio. The ⌁ chip toggles — turning it on repacks, turning it off frees.

**13 · Connected clips** — *FCPX clip connections*
Captions, lower-thirds, and SFX connect to the scene they annotate (visible stem). Move the scene, ripple it, reorder the storyline, swap its take — connections ride through every operation because they're resolved in the commit layer, not per-gesture. "Sync cannot silently break" was the single most-praised property across both FCPX and Avid (sync locks) camps.

**14 · Blade with preview** — *CapCut split · FCPX blade · HyperFrames ⇧-split-all*
B arms the blade: a cut line with timecode follows the pointer (snapping to beats and the playhead), the doomed half tints before you click, and ⇧-click cuts every track at once. Cuts on magnetic tracks preserve packing by construction.

## E · NAVIGATION — position is never the price of precision

**15 · Minimap** — *Resolve's upper timeline · code-editor minimaps*
A constant whole-project strip: render window, clip colors per track, markers, playhead, and the viewport as a draggable window — drag to pan, drag its edges to zoom, click to jump. The half of Resolve's dual timeline that belongs at the top.

**16 · Zoom that never loses you** — *Ableton Z · Premiere \\ · HyperFrames zoom tuning*
⌘-scroll zooms around the cursor (studio convention kept); **Z** zooms to the selection and Z again returns to exactly where you were (the stateful round-trip Premiere's `\` proved out); **F** fits; buttons step ×2 (HyperFrames landed on CapCut-strength steps after user feedback that 1.25–1.5× "felt like zooming several times to get anywhere"); playback page-follows near the edge.

**17 · Skimming** — *FCPX skimmer*
With SKIM on, hovering the ruler previews that frame in the monitor — ghost playhead, SKIM tag — without moving the real playhead. Looking is free; the playhead is a decision. One-key toggle (S) because FCPX taught everyone it must be.

## F · FEEDBACK & FLOW — the same voice everywhere

**18 · One delta HUD** — *Premiere/Avid trim counters, unified*
Every gesture narrates itself in one grammar: `Δ` in frames *and* seconds, old → new durations, the snap target's name, ripple state, media limits. Move, trim, roll, slip, wedge, scrub — same voice, same position. (The monitor doubles as the trim preview: IN/OUT PREVIEW tags show the exact boundary frame while you drag, as the studio does today.)

**19 · Keyboard time grammar** — *extends the studio's own keys*
The studio already has `,` `.` nudge and `[` `]` trim-to-playhead — kept, and joined by their pro-standard siblings: J/K/L shuttle, I/O set the render window at the playhead, B blade, R wedge, M marker, Z/F zoom, S skim, V/Esc select. Nothing existing was rebound.

**20 · Physics, sound, and named undo** — *drag-and-drop literature · game "juice" · Apple haptics*
Commits settle with a ~260ms spring (WAAPI, velocity-safe); snaps tick, breakaways pop, cuts click, ripples whoosh — **auto-muted during playback**, because the research's clearest negative finding is that no pro editor plays UI sound over content (speakers belong to the program; the pro channel is haptics — Keynote alignment taps, iMovie clip-end taps — which is what the real studio should use on Force Touch trackpads). Every commit posts a *named* toast (`Inserted 3.50s at 6.50s`) so ⌘Z is never a leap of faith.

## BONUS · GENERATIVE

**21 · Take stacks** — *FCPX Auditions × FrameDiff's pinned takes*
FCPX's most under-copied idea, and the one FrameDiff is uniquely positioned to own: a generative clip holds its takes **in one timeline slot**. Click the `t2` badge to cycle takes in place; a take with a different duration ripples the storyline automatically (auditions did exactly this). Auditioning becomes an edit, not a workbench detour. *(Prototype cycles three fake takes; the real version reads `GenerativeTakeSnapshot`.)*

---

**22 · Layers & stacking** — *After Effects / Photoshop ⌘[ ⌘] · first principles*
Every visual element has an explicit place in the composite, kept as doubly-linked lists (`prevId/nextId` on layers, `zPrevId/zNextId` on clips — id-based so undo snapshots stay plain JSON). Layers are a draggable ordered list: grab a lane label, drag ↑↓, upper layers cover lower ones. Within a layer, overlapping clips are allowed and keep their own stacking order — the timeline packs them into as many rows as the overlaps need (top of stack = top row; non-overlapping layers stay one row tall), while the monitor composites topmost-wins. Drags speak the drop-target grammar: a faint ghost holds the vacated slot, a dashed outline previews the exact landing frame *and* row (snap included), and pointer height picks the stack slot — drag ↑↓ over a pile to slide under or over it. `⌘]` brings forward, `⌘[` sends back, all undoable.

---

## G · The agent interface — same system, machine-readable

FrameDiff timelines are edited by people *and* by models, so every idea above was checked against a second question: what does it give an LLM? The answer is a pattern: **almost every "delight" feature is secretly a semantic layer** — and semantics, not pixels, are what agents consume. Five principles fall out:

1. **Anchors, not coordinates** (ideas 4–6, 14). The named snap targets are an addressing scheme: `hero.out`, `beat:33`, `marker:beat-drop`, `playhead`, `gap:sfx:2`. An agent should say `align(cta.in, beat:33)` — never "set from to 495" — because anchors re-resolve at apply time and survive upstream edits. LLMs are bad at frame arithmetic and good at naming things; this plays to that.
2. **Verbs with invariants, not attribute math** (ideas 7, 9–11, 14). `insertTime(at, dur)`, `rippleTrim`, `roll`, `slip`, `split` each preserve something by construction (downstream sync, total length, placement). An agent picks the verb that matches its *intent*, and the invariant guarantees it can't half-apply — versus today, where "make room for a longer hero" means rewriting a dozen `data-fd-from` attributes and hoping the model's arithmetic holds.
3. **Plans before commits** (idea 7). `ripplePlan(t0)` already exists as a pure function — exposed as a dry-run (`{rides: 12, splits: ["hero"], flows: ["pulse-120"], renderTo: 26.5s}`), it lets an agent (or a human reviewing an agent) see consequences before applying. The wedge's live preview *is* this plan, drawn.
4. **Relationships and lists, not offsets** (ideas 12–13, 21). Connected clips (`connect(caption, hero)`) and magnetic order (`move("cta", before: "social")`) mean agents edit *structure* while the pack/ride machinery computes geometry. Take stacks complete the loop: agents generate takes into a slot, a judge pins one, ripple absorbs the duration change.
5. **Receipts and reversibility** (ideas 18–20). Every commit returns what the toast says: `{op: "insertTime", Δ: "+105f", affected: 12, undoId}` — the structured result an agent uses to *verify its own edit*, and the audit trail a human uses to supervise an agent session. Named undo makes agent mistakes cheap: revert by id, not by diffing HTML.

Sketch of the surface (the ViewModel largely has the pieces — `commitPlacement`, `commitRenderWindow`, `moveAnimationKeys` — this names the missing verbs):

```
inspect(anchor | t)        → { clipsAround, beats, markers, limits, targets }   // the loupe, as JSON
plan.insertTime(at, dur)   → { rides, splits, flows, maxPull, renderTo }        // dry-run
insertTime / removeTime / rippleTrim / roll / slip / split / closeGap / bridge / connect / reorder / pin
apply(op)                  → { label, delta, affected, undoId }
```

Human-only ideas, honestly labeled: zoom (16) and the minimap/skimming *surfaces* (15, 17) don't need agent analogs — agents don't scroll — but the minimap's *data* is the timeline summary an agent reads, and skimming's analog is frame sampling. The loupe (1) likewise: its *contents* are `inspect()`. The deeper point: **the human interface and the agent interface should be one system** — same anchors in the HUD and the API, same verbs behind keys and calls, same toasts for both kinds of editor. That's also the oversight story: an agent editing your timeline produces the same legible trail you'd leave yourself.

## H · The pointer-only pass — no keys, no modes required

Second design pass: every operation must be reachable with clicks and drags alone. Keys survive as accelerators; nothing *requires* them, and there are no armed modes to enter or escape. The philosophy is the Avid Smart Tool's, finished: **the verb lives where you point, and the pointer previews the verb before you commit.** (This is also, not incidentally, the touch/iPad pass.)

The zone grammar:

| Where you point | What happens |
|---|---|
| Clip body | drag = move / reorder |
| Clip edges | drag = trim — **upper half plain, lower half ripples** (color-split handle; magnetic tracks always ripple) |
| Clip lower strip | **✂ zone** — hover shows the cut line + doomed-half tint · **click cuts** · **drag tears the timeline open** (split + insert; drag left removes) |
| Clip center | **⇄ pill** (hover-revealed) — drag slips the source |
| Junction between clips | pill pair: **⟷ roll** · **＋ open time** (click = +0.5s, drag = choose) |
| Playhead (hover in ruler) | **⇤ ✂ ⇥ cluster** — trim-starts / split-all / trim-ends, each **previewing its exact damage as a tint on hover** before you click |
| Selection | floating bar — **◂1f · 1f▸ steppers** (hold to repeat, coalesced into one undo entry) · duration · × delete |
| Ruler | drag scrubs · **pull down mid-drag = fine gearing** · double-click adds a marker |
| Anywhere | **right-click** — split here / split all tracks / open 0.5s / close·bridge gap / marker / delete |
| Vertical distance, any precision drag | **the gearing dial**: pull away from the track and the drag slows smoothly to 1/10×, loupe opens — precision is how far you pull (iOS scrubber pattern), not a key you hold |
| Topbar | ↩ ↪ undo/redo · frame-step ◂\| \|▸ (hold to repeat) · FIT / SEL / ± zoom · SNAP / SKIM / SOUND chips |

What this replaced: the B and R armed modes (now the ✂ strip + junction ＋), ⇧-fine (now vertical gearing), ⌘-ripple (now the handle's lower half), ⌥-slip (now the ⇄ pill), [ ] (now the playhead cluster, with previews the keys never had), , . (now steppers), M (double-click), ⌘Z/Z (buttons). The momentary ⌥ snap-bypass became unnecessary: breakaway hysteresis plus gearing-shrunken snap radii cover the "escape the magnet" case, and the SNAP chip remains the hard off.

Two honest trade-offs: hover-revealed affordances don't exist on touch until you make them persistent (a compact "handles always visible" density toggle in the real studio), and the ✂ strip spends ~9px of every clip's height on a zone — worth it, since cutting is the most frequent destructive edit and it now costs zero mode round-trips.

## What we deliberately did *not* copy

- **Magnetic everything** (FCPX) — polarizing by design; we made it per-track (idea 12).
- **Snap sounds during playback** — violates "speakers belong to content"; sounds duck automatically, haptics are the production answer.
- **Pro Tools Spot mode** (drag opens a timecode dialog) — numeric-first kills direct feel; instead the HUD always *shows* numbers. A type-exact-value affordance belongs in the Inspector.
- **Resolve's fixed-playhead scrolling** (content scrolls under a centered playhead) — praised in hardware-jog contexts, documented as disorienting with a mouse; our follow-scroll pages instead.
- **Descript's text-based editing** — a different surface, not a timeline mechanic; its lesson (every edit is a tasteful ripple) is absorbed into ideas 7–9.
- **An always-on second full timeline** (Resolve Cut page) — costs a full row of vertical space; minimap + loupe deliver the same pair for less.

## Porting notes for the real studio

Ordered by leverage against `packages/studio-ui/src/views/Timeline.svelte`:

1. **Sticky snap engine** (ideas 4–5) — replace `snapTargets(): number[]` + `applySnap` with typed `{f, label, w}` targets and enter/exit hysteresis; the HUD (`Timeline.svelte:474`) already exists to carry target names. Smallest change, felt on every drag.
2. **Loupe** (1–2) — a canvas overlay fed by the same lane snapshots; trigger on trim drags and ⇧. No model changes.
3. **＋TIME wedge** (7) — needs a `commitRipple(t0, deltaFrames)` on the ViewModel writing `from += Δ` across editable items (respecting `editable.from`), shifting animation keys (`moveAnimationKeys` generalizes), and growing `render.to`. Frames are already absolute, so this is a batch attribute rewrite. Mind `trimStart` being **seconds** if slips join later.
4. **Gap chips + ripple delete** (8) — pure UI over the same commit.
5. **Beat grid** (6) — needs a beat source; HyperFrames ships a beat analyzer (`useMusicBeatAnalysis` + `beat-analyzer.global.js`) worth studying. Until then, a declared-BPM attribute on audio content gets 90% of the value.
6. **Magnetic track mode + connections** (12–13) — the real modeling work: a `parentId`/connection on `CompositionTimelinePlacement` and a per-lane pack invariant. The prototype's commit-layer approach (children ride by delta, pack after mutate) maps cleanly.
7. **Take stacks** (21) — UI over existing `production.pinnedTake` + `GenerativeTakeSnapshot`; ripple-on-swap falls out of #3.

## Research appendix (agent digests)

- **Pro NLEs**: FCPX magnetic timeline/connected clips/precision editor/auditions/skimming; Premiere trim modes with the yellow-vs-red color grammar, Q/W/E, trim mode with per-side counters, JKL dynamic trimming; Resolve's Cut-page dual timeline, smart indicator, trim-start/end-to-playhead; Avid Smart Tool zones, segment modes, trim loops, sync locks with ghost rollers; the full ripple/roll/slip/slide vocabulary. Consensus gold: JKL trimming, top/tail keys, dual timeline, skimming, structural sync, two-up trim displays, dimmed-handle precision editors, extend edit, hold-to-invert snapping, auditions.
- **Delight patterns**: snap-by-default + momentary escape; content-derived snap targets; relative snapping; focal-anchored one-gesture zoom; the loupe principle (never let the hand hide the work); perpendicular/modifier precision gearing; haptic alignment (Apple ships it in iMovie/Keynote); elastic-media play (Ableton warp "thumbtacks in a rubber band"); one physics model with visible mode; persistent loop regions (GSDevTools survives refresh); delight budget ∝ 1/frequency; escape-aware snap math instead of naive thresholds; ~100ms drop-home animations; springs with velocity inheritance; **no editor plays snap sounds — haptic > color > sound**.
- **HyperFrames editor** (local source read): typed snap priorities `{playhead: 0, clip-edge: 1, beat: 2}` at 8px; log-scale zoom 10–2000% with fit-pinning and ×2 steps tuned from user feedback; razor with ⇧-split-all-tracks; marquee multi-select; beat strip + add-beat-at-playhead; work-area I/O keys; gap detection/commit; times in seconds (FrameDiff: frames).
- **Current studio** (`Timeline.svelte` et al.): frames + `ppf`, open axis with staging offzones and the render window, untyped 7px snap with ⌥ bypass, move/trim/lane-drag with live edge preview and drag HUD, motion lanes with draggable keys, `sourceLimits` overrun, production badges, `,` `.` `[` `]` shortcuts — and no ripple, no multi-select, no blade, no beats, no minimap. The prototype keeps every convention it found (⌘-wheel zoom, ⌥ snap-off, offzone hatching, render-window bar, amber playhead, live trim preview) so it reads as this studio's future, not a different product.
