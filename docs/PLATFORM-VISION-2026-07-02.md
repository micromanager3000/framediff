# FrameDiff — the code-first video production *platform*

> **Historical vision document.** Use [ARCHITECTURE.md](./ARCHITECTURE.md) for the implemented
> code-level architecture and [PRD.md](./PRD.md) for current product intent.

> **Date:** 2026-07-02 · **Owner:** Vikas Reddy · **Status:** vision capture + prototyping plan
> **Source:** a voice memo (transcribed verbatim in the [appendix](#appendix--raw-voice-input-verbatim))
> **Relationship to existing docs:** extends the [PRD](PRD.md), [COMPOSITION-GRAPH.md](COMPOSITION-GRAPH.md)
> (nested comps, CAS, lockfile, generators) and [NODE-TIMELINE-GUI.md](NODE-TIMELINE-GUI.md)
> (code⇄GUI round-trip). This doc reframes those pieces as one **collaborative production platform**
> and defines the UX prototypes + system diagram that show it off.

---

## 1. The idea in one paragraph

A full video production system **in code**. The project is a repo: editing, compositing, overlays,
grading — all expressed as code (HTML/CSS/JS/WebGL for visuals, TypeScript for orchestration). Raw
video/audio and every intermediate output are **synced to the cloud by content hash**, so anyone
collaborating can clone, pull the media they're missing, edit, and merge changes exactly like a
software team merges code. There is still a GUI — a good one — but it is a *projection of the code*,
and most edits can equally be made in Claude Code or Codex. AI agents are first-class editors.

## 2. Core principles (from the voice memo, sharpened)

1. **Ground truth is code.** The repo *is* the project. Every edit — a cut, a grade, a keystone, a
   composition — is expressible as a code change, checkable-in, diffable, revertible.
2. **Media syncs by content, not by path.** Raw files and intermediate/prebaked outputs live in a
   content-addressed store (local folder now; cloud remote later). Push code + manifest + lock;
   a collaborator pulls and has *the same access to the same bytes* — verified by hash.
   (Mechanism already designed: `framediff.assets.json`, `framediff.lock`, local/remote CAS —
   COMPOSITION-GRAPH §3.)
3. **Compositions compose.** A composition can embed other compositions, arbitrarily deep.
4. **Prebaked elements are first-class.** A composition element may be *baked*: rendered once
   (e.g. a screen recording keystoned onto a 3D plane), or produced by a cloud API call
   (generation, video-to-video), then cached, shared, and composed downstream like any clip.
   (Mechanism: bake-phase nodes + fingerprints — COMPOSITION-GRAPH §4–5.)
5. **Everything After-Effects-grade is available** — color grade/correction, LUTs, vignettes,
   keystoning/3D planes — attachable to a clip, a range of a clip, or the whole composition.
6. **Components expose properties, not code.** In the GUI you don't edit a node's implementation;
   you edit its *declared inputs* (schema-driven inspector — NODE-TIMELINE-GUI §7). The code stays
   the escape hatch for everything else.
7. **One repo, three layers.** (a) the **`framediff` library** — wraps timeline primitives, render
   pipeline, sync/CAS APIs, all the platform plumbing; (b) the **user's project code** — their
   compositions, assets, looks; (c) the **editor GUI** we ship — and because the library is the
   real surface, anyone can build *their own* GUI on top of it.
8. **Sharing across projects** comes later; assume single repo first (with a shared/ area inside it).

## 3. What this adds on top of the existing docs

The composition graph and GUI round-trip are already specified. The *new* emphasis captured here:

- **The collaboration loop as a product surface**, not just a mechanism: edit → commit → `assets/cache
  push` → teammate pulls → identical project, no re-bakes, no re-paid API calls. The UX should make
  sync state (what's local, what's pinned, what's missing, what's unpushed) visible and one-click.
- **Prebaked elements in the UX**: bake state (cached / baking / needs-bake / remote-available) should
  be legible on the timeline and in the graph, per element.
- **Nested compositions in the UX**: dive in/out of embedded comps (breadcrumbs), see them as single
  clips from outside.
- **The three-layer repo shape** as an explicit, documented contract (`framediff` lib / project code /
  GUI), with the GUI intentionally replaceable.
- **Agents in the loop**: Claude Code / Codex editing the same repo, visible in the UX (a session
  panel, diffs landing as HMR updates in the preview).

## 4. Prototyping plan — UX

Two prototypes exist or are planned under [`prototypes/`](../prototypes/):

### 4.1 `prototypes/editor-gui` (exists, 2026-06-29)
The **detail view**: node graph ⇄ timeline, schema-driven inspector, shared-value edit-all/fork,
code write-back highlight. Keep as-is.

### 4.2 `prototypes/studio-shell` (new, this doc) — the platform shell
A single-file, no-dependency HTML/CSS/JS mock of the full **FrameDiff Studio** experience,
demonstrating what editor-gui doesn't:

- **Project rail** — compositions (nested tree), assets with per-file sync state
  (local-only ⇡ / pinned ✓ / remote-only ⇣), the shared library.
- **Preview + breadcrumb nesting** — click into an embedded composition (`Final ▸ Intro`), edit it,
  pop back out; from outside, it's one clip.
- **Timeline with element kinds** — ordinary clips, a *nested-comp clip*, and *prebaked elements*
  (a keystoned screen-recording bake, a video-to-video generation) each showing **bake state**.
- **Inspector** — schema-generated controls for the selected element's *exposed properties* only.
- **Sync/collab surface** — top bar: branch, unpushed artifact count, one-click
  `push` (animates artifacts flowing to the cloud), a teammate pulling on the other end.
- **Agent panel** — a Claude Code session editing the project; its diff lands live in the preview.

### 4.3 `prototypes/series-studio` (v2 rev, 2026-07-02) — episodic production
The platform shell evolved for a real production shape: a ~5-min mini-series episode
("The Limping Lady" — Virginia Hall). Adds: **storyboard ⇄ script ⇄ timeline as three surfaces over
one graph**, per-beat generation prompts (seedance) with a **recurring character package**
(backstory + source stills + pinned angle-set artifact) for cross-episode consistency, scene
transitions + a series-wide look on the output, and **auto-captions as a terminal bake node**
(fingerprinted on the final VO mix + script, so it structurally runs last and goes stale correctly).
Also answers: assets rail scoped **Episode / Series / Store** (manifest = referenced; store = whole
team CAS, searchable/windowed for scale) and compositions nested a few deep (`Final ▸ sc08 ▸ shot-b`).

### 4.4 `prototypes/three-workflows` (v3 rev, 2026-07-02) — workflows are user-space
The design rethink in [WORKFLOWS-AS-VIEWS.md](WORKFLOWS-AS-VIEWS.md): storyboard/script/rundown are
**docs** (authoring data linked to nodes, and fingerprint *inputs* to gen nodes), and every UI
surface — including the built-in timeline — is a **view** (`defineView`, user-space, two shared
write paths). One shell hosts three example repos: the episodic workflow, a zero-config simple cut,
and a podcast whose transcript view makes text editing = audio editing.

### 4.5 Diagram — `prototypes/platform-diagram` (2026-07-03) — the layering story
Companion to [WORKFLOWS-AS-VIEWS.md](WORKFLOWS-AS-VIEWS.md): a layer-cake (user space → shell with
the two write-path ports → kernel) where selecting a workflow lights up exactly the primitives it
uses — the simple cut demonstrating the zero-tax property, the podcast showing chapters-as-doc-joins
and the derive⇒artifact⇒render split.

### 4.6 Diagram — `prototypes/architecture-diagram` (new, this doc)
A single-file animated HTML/CSS/JS diagram of the whole system:

- **Center: the Git repo** (composition code · `framediff.assets.json` · `framediff.lock`) — the truth.
- **Below: the two-phase render** — bake phase (async, impure, cached) → CAS → frame phase
  (pure `f(frame)`).
- **Sides: two collaborators** — A bakes/pushes, B pulls/reuses byte-identically.
- **Top: three editors, one source of truth** — GUI, code editor, AI agent.
- Animated flows (hashes moving between local CAS ⇄ remote CAS), step-through storyline of the
  collaboration loop.

## 5. Build/architecture reality check

Nothing in the memo requires new mechanism beyond what COMPOSITION-GRAPH already plans; this is a
*packaging + UX* layer over it. The near-term sequencing stays: P0–P3 (graph, assets, precomps,
local cache) → N0–N6 (GUI round-trip) → P6 (team cache sharing) — with these prototypes serving as
the north-star UX we're building toward.

> **Update 2026-07-03:** sequencing now lives in the master plan,
> [IMPLEMENTATION-PLAN-2026-07-03.md](IMPLEMENTATION-PLAN-2026-07-03.md) — P0–P4 have landed;
> M2–M10 take it from here under the [WORKFLOWS-AS-VIEWS](WORKFLOWS-AS-VIEWS.md) model.

---

## Appendix — raw voice input (verbatim)

> **Text message (2026-07-02):**
> Have been prototyping an adjacent to LightTwist idea too, overall idea is a full video production
> system in code, where even your video editing /etc is all done in code (html/css/js / webgl for
> overlays). Raw video files/audio and even intermediate stuff is synced to cloud and then anyone
> collaborating can pull it down and edit and merge changes easily. Still has a GUI but you can do
> most edits/etc in Claude Code it Codex.
>
> Can you make a beautiful prototype of what the UX/UI could look like for this AND also a beautiful
> HTML/CSS/JS diagram showing how everything could work?

> **Voice memo (2026-07-02):**
> Okay. I'm gonna add some voice ideas here. So the general idea here is that this is a platform for
> video production where the ground truth is code and the, uh, video data and everything else, uh,
> like, all raw files and intermediate outputs, those are all synced, uh, into the back end. Um, for
> now, for prototyping, we can, like, you know, use a local folder or something like that folder
> structure. Um, but the idea is that that could be synced, and then, you know, share it across
> different people. So a couple constraints is that everything should be able to be edited in code.
> And that way, like, somebody should be able to be editing stuff, check it in, push it, all the,
> like, raw data files should sync to the cloud, and then the other person should be able to pull it.
> And then as long as they have those same files, they should be able to, like, have that, you know,
> have the same access to, like, all this stuff. Another... the... another key idea here is, like,
> This should ideally be, like, in the UX. It'd be awesome to come up with something where it's like
> a... doesn't have to be, like, a node based workflow or whatever, but, like, this this idea that,
> like, compositions can be some combination of of, um, things of, like, other compositions. So,
> like, compositions can be embedded in other compositions. And then the idea is that a composition
> itself can have elements which are prebaked. So, like, maybe it, like, renders something. Maybe
> it's calling, like, a API in the cloud and, uh, is able to, you know, like, essentially create,
> like, a, uh, prebaked renderer, uh, sequence... rendered sequence or a calls an API to get, like,
> some package of data that's then used, um, in that composition or then forwarded into another
> product composition. So, like, taking, for example, a screen, uh, recording and then keystoning it,
> um, you know, with a with a three d position and rendering it out, that could be something that's
> pre rendered perhaps and then composed in. Um, there's things like, uh, color correction, which
> should be able to be associated with, uh, specific video, uh, files and, like, in a specific
> ranges or maybe, you know, call... I should say color grading too. vignetting, like, all the stuff
> that's available in something like Adobe After Effects should be available. And then, yeah, like,
> the... in the UX, like, the idea is... ideally, like, the... each of these, like, things that are,
> you know, components or compositions or, like, things that you can do should have certain elements
> that are exposed for editing. So, like, if it's, like, the Keystone stuff, there should be whatever
> the... like, the actual code doesn't need to be editable in the UX, but the inputs, like, the
> cons... the sort of, like, properties for that thing. should be, uh, able to be edited. And then I
> also want to be able to... let's, like, let's think about this in He loveth too in the context of
> being able to have, like, shared stuff across different projects. Like, there should be, like...
> you know, maybe you can have... I mean, I think we can... like, maybe at first, we assume single
> repo. So, like, single repo, and then, um, there could be, like, multiple... there could be a
> shared part. So, like, there's a there's a framediff library which should wrap all the, like, APIs
> and all the stuff that we do for, like, syncing and all that stuff nicely. But then there should
> be the part that the user is defining, and they're building out there should be a editor, like, a
> a nice GUI that we expose. But then if people wanna build their own, you know, GUI, they can too.
> But, yeah, let's come up with a prototype or a couple different prototypes here that are, like,
> really awesome and show off, like, a really elegant but powerful UX. And then let's come up with a
> a clear diagram And then can you also take all of this and, like, maybe take all this, like, input
> that I just gave you and, like, put it into, like, a single nice dot m d doc, um, and time stamp
> it today or, you know, give it give it the date of today, um, before working on it? This raw, uh,
> prompt, but then, like, at the very bottom of the document, but, like, refine this into a clear
> prototyping plan... prototyping, uh, UX plan and, uh, everything else. And the... sorry. Let me
> say everything else. I mean, the, um, diagram showing, like, how this all works and everything.
