# FrameDiff — workflows are user-space: docs, links, and views

> **Document role:** deeper design rationale for projecting production workflows over the core.
> Use [ARCHITECTURE.md](./ARCHITECTURE.md) for the implemented package, effect, composition, and
> frame/bake boundaries.

> **Date:** 2026-07-02 · **Owner:** Vikas Reddy · **Status:** design rethink (supersedes the
> "new facets" idea floated after the series-studio prototype)
> **Relationship:** builds on [COMPOSITION-GRAPH.md](COMPOSITION-GRAPH.md) (kernel: graph/CAS/lock)
> and [NODE-TIMELINE-GUI.md](NODE-TIMELINE-GUI.md) (SceneDoc IR, projections, param schemas).
> Prototypes: [three-workflows](../prototypes/three-workflows/), [series-studio](../prototypes/series-studio/)
> · Diagram: [platform-diagram](../prototypes/platform-diagram/) (the layer-cake of §2, per workflow).
> **Implementation sequencing:** [IMPLEMENTATION-PLAN-2026-07-03.md](IMPLEMENTATION-PLAN-2026-07-03.md).

---

## 1. The question

The series-studio prototype bound **storyboard panel ⇄ script block ⇄ composition** together. The
lazy way to spec that is "add `storyboard` and `script` facets to SceneNode." Is that the most
elegant model? **No.** Facets would be a category error, and fixing it yields something better: the
entire *workflow UX* becomes user-space.

Two observations force the rethink:

1. **A script block renders no pixels.** The render DAG is about signal flow — video/audio in and
   out. Storyboard beats, script blocks, rundowns, shot lists, show notes have no ports. Putting
   them in the graph pollutes the one invariant that makes everything else work (§6.3 of the
   composition-graph doc: every node is either a bake node or a pure frame function).
2. **Storyboard/script is one team's workflow, not the product.** A solo cut needs neither. A
   podcast needs a rundown and a transcript instead. A studio doing episodic docs needs beats,
   scripts, and character packages. If these are core features, the core grows a feature per genre
   forever. If they're user-space, the core never grows.

## 2. The model: three primitives

> **Rule 2** (companion to the kernel's Rule 1):
> **Emits pixels/audio ⇒ node. Authoring structure ⇒ doc. UI surface ⇒ view.**

### 2.1 Nodes (unchanged)
The render graph of NODE-TIMELINE-GUI: typed components, exposed param schemas, temporal placement,
bake/generate nodes, compositions. The kernel.

### 2.2 Docs — structured authoring data, linked to nodes
A **doc** is a structured file in the repo — markdown with annotated blocks, JSON, a TS const —
that the GUI can read *and write* through the same span/provenance machinery as param literals
(NODE-TIMELINE-GUI §9: `fieldSources`, literal rewrites). Docs and nodes reference each other by id:

```md
<!-- story/beats.md -->
## Fifty Miles                       {#sc08 comp=sc08 dur=34s char=virginia-hall}
7,500-ft winter crossing on a wooden leg. London: "If Cuthbert troublesome — eliminate him."
prompt: "lone figure with cane crossing snowbound ridge, moonlit spindrift, 35mm noir"
```

Two link directions, both already-solved mechanics:

- **Doc → node** (navigation/authoring): `comp=sc08` binds this beat to a composition. Views join
  on it. Deleting the comp flags the beat; creating a beat can scaffold a comp.
- **Node → doc** (dependency): a node declares a doc *slice* as a fingerprint input —
  `ctx.generate("captions", { script: ctx.doc("script.md") })`. The doc's **bytes** enter the
  Merkle fingerprint like any asset. Edit a VO line → captions (and only captions) go stale. This
  is not new machinery — it is §3.3 of the composition-graph doc applied to a text file. The
  series-studio captions node already behaved this way; we generalize instead of special-casing.

Docs can also be **generated then materialized**: a whisper transcript starts as an artifact
(pinned, content-addressed), then `framediff docs materialize` commits it as an editable doc — the
same materialize-to-edit affordance the GUI spec already defines for computed values (§9.1).

### 2.3 Views — the UI is a projection, and projections are pluggable
NODE-TIMELINE-GUI's central idea is that node graph and timeline are **two projections of one
DAG**. Take it seriously: *those two are not special.* A view is a user-space module:

```tsx
// views/storyboard.view.tsx — lives in the PROJECT repo, not in framediff core
export default defineView({
  id: "storyboard",
  title: "Storyboard",
  // declarative join over the project: docs + nodes + links
  query: p => join(p.doc("story/beats.md").blocks, p.compositions, on("comp")),
  component: ({ rows, actions }) => (
    <Grid>{rows.map(r =>
      <BeatPanel beat={r.block} comp={r.comp} frame={r.comp?.poster}
        onOpen={() => actions.focusComp(r.comp)}          // jump to timeline/preview
        onEditText={patch => actions.editDoc(r.block.span, patch)}   // span rewrite
        onEditParam={(k,v) => actions.setParam(r.comp.gen, k, v)}    // param binding
      />)}
    </Grid>),
});
```

Views get **no private write path**. Everything funnels through the two existing ones — param
bindings (schema-driven, animatable) and doc/literal span rewrites — so any view is automatically
undo-able, diffable, agent-editable, and consistent with every other surface. The Studio shell
provides chrome (rail, inspector, preview, sync, playback) and mounts whatever
`framediff.config.ts` declares:

```ts
export default defineStudio({
  views: [timeline(), nodeGraph(), inspector(),          // built-ins from @framediff/studio
          "./views/storyboard.view.tsx", "./views/script.view.tsx"],
});
```

Timeline, node graph, inspector are built-ins *implemented with the same API* — proof the API is
sufficient, and the escape hatch ("build your own GUI") stops being a fork and becomes a file.

## 3. Why this beats "new facets" (and the alternatives)

| | facets on SceneNode | separate story app | **docs + links + views** |
|---|---|---|---|
| Graph purity | ✗ non-signal nodes in DAG | ✓ | ✓ untouched |
| Simple project overhead | every comp drags story schema | ✓ | ✓ zero — no docs, built-in views only |
| New genre (podcast, ads, courses) | core grows facets forever | new app each time | a doc format + a view file in user space |
| Staleness (script → captions) | ad-hoc | none | free — docs are fingerprint inputs (bytes) |
| Diff/merge | JSON-in-graph | app database | markdown + code, Git-native |
| Agent editing | new tool surface | new tool surface | same two write paths it already knows |

The strongest property: **the platform's answer to "does FrameDiff support storyboards?" becomes
"FrameDiff doesn't know what a storyboard is — your repo does."** Same answer for rundowns,
shot lists, curricula, ad variants. That is what "a video production *system* in code" means.

## 4. The three example workflows (prototype: [three-workflows](../prototypes/three-workflows/))

One shell, three repos, same primitives — only the user-space layer differs:

| | **limping-lady** (episodic) | **spring-launch** (simple cut) | **deep-dive** (podcast) |
|---|---|---|---|
| Docs | `story/beats.md`, `script.md` | — | `rundown.md`, `transcript.md` (generated → materialized), `shownotes` |
| Custom views | Storyboard, Script | none — built-ins suffice | Rundown, Transcript |
| Gen nodes | scene v2v, angle set, captions | — | transcript, chapters, shownotes, audiograms |
| Library | character pkg, look, intro | brand lower-third, look | jingle/bed, cover, audiogram template |
| The demo moment | beat ⇄ script ⇄ comp joins | timeline+inspector only, zero config | **edit audio by editing text** — striking a filler word rewrites the clip's placement literals |

The podcast transcript view is the acid test: it looks like a genre feature ("Descript for
FrameDiff") but is *pure composition of existing primitives* — a generated-then-materialized doc,
word-level links (`{t, d}` per token ↔ source clip), and a view whose edits write ordinary
`trimStart`/`durationInFrames` literals. If the model handles that without new kernel concepts,
it's the right model.

## 5. What changes where

- **NODE-TIMELINE-GUI.md** — stands as-is for nodes/params/projections; an addendum points here.
  No new facets. (Its "timeline is a projection" claim is *promoted*, not amended: timeline becomes
  the first built-in view.)
- **COMPOSITION-GRAPH.md** — one addition: `ctx.doc(path[, slice])` as a declarable input kind
  (bytes into the fingerprint, like assets). Nothing else.
- **New surface** (post-N6 work, order of magnitude a phase, not a rewrite):
  `defineView` / `defineStudio`, the project query/join API, doc block parsing + span writes
  (markdown first), `docs materialize`. Ship Storyboard/Script/Rundown/Transcript as **example
  packages** (`@framediff/story`, `@framediff/podcast`) — importable, forkable, explicitly not core.

## 6. Risks, honestly

1. **View API surface creep** — a view API can balloon into "we shipped a framework." Mitigation:
   editor views are Svelte components backed by TypeScript ViewModels, with two write actions and
   one query helper; anything more comes from the project's own code. React remains the
   composition-rendering runtime.
2. **Doc parsing ambiguity** — markdown blocks need stable ids/spans to survive concurrent edits.
   Mitigation: explicit `{#id key=val}` annotations (already the convention above), same
   reconciliation policy as code (§9 echo-suppression).
3. **Word-level links are volume** — a 40-min transcript is ~6k tokens with timings. Mitigation:
   timings live in the pinned artifact; the materialized doc stores text + block anchors, and the
   view joins the two by content hash.
4. **Two write paths must stay the only two.** The moment a view gets a bespoke mutation API,
   surfaces can disagree again (the v1 GUI failure mode). This is a hard rule, enforced in review.

---

## 7. Elegance audit — the three workflows re-derived (2026-07-03)

Question asked of the [three-workflows](../prototypes/three-workflows/) prototype: *does every
concept decompose into kernel primitives?* Four places where it cheats, each with a refinement
that shrinks the kernel while adding expressiveness:

### R1 — `doc` as a ParamBinding source (kills duplicated facts)
The story workspace stores a prompt in `beats.md` *and* in `sc08.tsx`; scene order in the doc *and*
in `episode.tsx`. Same fact, two homes. Fix: extend the existing binding enum —
`const | keyframes | spring | expr | link | doc` — so a node param can **read a doc field**
(`prompt: ctx.doc("beats.md#sc08.prompt")`). Read path only; writes stay span rewrites. Fingerprints
already fold doc bytes in. Corollary for structure: the episode may map over
`doc("beats.md").blocks` — **the storyboard is the EDL**; timeline ordering is then computed →
read-only until materialized (§9.1 of the GUI spec, unchanged).

> **Principle — one authority per fact.** Every fact (a prompt, an order, a trim) has exactly one
> home: a literal, a doc field, or an artifact. Surfaces join facts; they never copy them. This is
> the read-side twin of "no third write path."

### R2 — split impure derive from pure render (unfuses captions & audiograms)
`<Generate kind="captions">` fused an API call with styling — a font tweak would re-buy the API
call. Decompose: a gen node produces a **data artifact** (`cues.json`); an ordinary frame-phase
component renders it (`<Captions cues style/>`). "Audiogram" then isn't a kind at all: it's a
library comp **baked as a precomp** over (master segment + quote + template) — existing machinery.

> **Principle — the artifact between derive and render is the cache boundary.** Never fuse a paid
> derivation with presentation.

### R3 — chapters/markers are doc blocks, not nodes
They render nothing ⇒ by Rule 2 they are not nodes. The timeline's CHAPTERS lane is the timeline
*view joining `rundown.md`* (it can — the timeline is a `defineView` like everything else). Burned-in
chapter titles are opt-in: bind a text node to the doc field (R1 again).

### R4 — ducking desugars to ports, not props
`duck={{to, attack}}` is fine as sugar, but the canonical form is an **effect node with a sidechain
`audio` input** — the typed-port system already expresses it. Otherwise a parallel, podcast-only
audio model grows. (Real cost acknowledged: buses/sends are genuine audio-engineering work.)

### Kernel census after the audit
Character, captions, audiogram, chapter, storyboard, rundown, transcript-editor — **none are kernel
concepts.** What remains: assets (opaque bytes, by hash) · docs (transparent text, by path#block —
both are just *files feeding fingerprints*) · nodes + param bindings + placement · artifacts/
fingerprints · views + two write paths. Packages (`defineCharacter`, `defineLook`) are folder
conventions + sugar. Expressiveness check: localization (per-locale `script.md` → VO gen → captions
gen) and ad-variant matrices (bindings over a variants doc) fall out with zero new machinery.

Costs, honestly: doc-driven order moves reordering to the storyboard (timeline drag requires
materialize); word-level `align()` is a nontrivial library helper (not kernel); sidechain buses are
real work. All contained; none touch the kernel.

---

## 8. Second elegance pass — the UX-layer gaps (2026-07-03)

The kernel survived the §7 audit; the remaining inelegance is concentrated **above** it. Five
upgrades, none of which add kernel concepts:

1. **Authority made visible.** A fact's writability today is an emergent property of coding style
   (literal vs computed) — invisible until an edit fails. Fix: every displayed value wears an
   **authority chip** (`literal · doc · expr · artifact`) with one universal affordance to move it
   along the gradient (materialize ⇄ fork ⇄ abstract). §9.1 of the GUI spec, promoted from internal
   rule to visible UI atom.
2. **The trinity `{scope, selection, time}`** is the *only* shared UI state. Views become pure
   functions of `(project, trinity)`; scrub anywhere = scrub everywhere; a deep link or a
   "follow me" collab session is just a trinity value.
3. **UI pixels come from the CAS.** Poster frames, filmstrips, waveforms, transcript alignments —
   all *derived artifacts* of the same derive⇒artifact⇒render pipeline. No bespoke thumbnail
   cache; staleness is already solved.
4. **Patches are the universal history.** Both write paths emit span-scoped patches; the session
   undo stack is inverse patches; a checkpoint is a commit; review and collab presence are patch
   streams. Undo/redo needs no new model.
5. **An agent is a view with no component.** Same queries, same two actions. There is exactly one
   integration surface for humans, GUIs, and agents.

**UI atoms.** These upgrades plus the model imply a small periodic table for the interface —
**Cell** (any addressable fact, rendered at five densities: chip / row / strip / card / tile),
**Lane** (cells on an axis: time · order · list), **Control** (schema × binding × authority),
**Chip** (state / link / authority tokens; clicking navigates the join), **Stage** (scope × time →
pixels), **Trinity bar**, and **Halo** (hover any projection of a fact → every projection lights
up; principle #1 of §7 made visceral). A storyboard panel, timeline clip, rail row, rundown card
and node box are *the same Cell at different densities* — demo:
[prototypes/ux-atoms](../prototypes/ux-atoms/).
