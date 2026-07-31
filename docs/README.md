# FrameDiff documentation

Start with [ARCHITECTURE.md](./ARCHITECTURE.md). It is the canonical description of the implemented
system and explains compositions versus effects, frame versus bake work, package ownership, project
layout, and the example-to-package promotion rule.

## Current contracts

- [HTML-COMPOSITIONS.md](./HTML-COMPOSITIONS.md) — authored HTML and `data-fd-*` ABI.
- [STUDIO-EDITING-CONTRACTS.md](./STUDIO-EDITING-CONTRACTS.md) — source authority and edit behavior.
- [COMPOSITION-AUTHORING.md](./COMPOSITION-AUTHORING.md) — JSON documents, direct preview tools,
  optional timelines, effect workspaces, and invalidation behavior.
- [AGENT-API.md](./AGENT-API.md) — Studio agent inspection, checks, snapshots, and commands.
- [SVELTEKIT-STUDIO-ARCHITECTURE.md](./SVELTEKIT-STUDIO-ARCHITECTURE.md) — implemented editor/runtime
  package boundaries and dependency direction.
- [PRODUCTION-LAB.md](./PRODUCTION-LAB.md) — end-to-end acceptance walkthrough.
- [STUDIO-PLAYGROUND.md](./STUDIO-PLAYGROUND.md) — nested, runnable acceptance project covering all
  composition kinds and public effect families.
- [USER-TESTING-AND-STRATEGY-2026-07-20.md](./USER-TESTING-AND-STRATEGY-2026-07-20.md) — reusable user
  scenarios, regression matrix, test layers, quality gates, and exploratory release charter.

## Product and deeper design

- [PRD.md](./PRD.md) — product goals and roadmap.
- [COMPOSITION-GRAPH.md](./COMPOSITION-GRAPH.md) — bake graph, CAS, generation, and future extensions.
- [NODE-TIMELINE-GUI.md](./NODE-TIMELINE-GUI.md) — prospective explicit node/timeline IR.
- [WORKFLOWS-AS-VIEWS.md](./WORKFLOWS-AS-VIEWS.md) — workflow projections over kernel primitives.
- [PLATFORM-VISION-2026-07-02.md](./PLATFORM-VISION-2026-07-02.md) — dated collaborative-platform
  vision and prototype framing.

## Active plans

- [script-sheet-plan.html](./script-sheet-plan.html) — the `script` comp as a full-height editable
  sheet, built on the `GenerativeWorkbench` pane precedent. Prototype: `prototypes/script/`
  (`script-lab` launch config).

## Historical evidence and plans

Date-stamped audits, milestone status files, spikes, rebuild reports, and implementation plans record
why decisions were made. They are useful evidence, but they do not override the canonical architecture
or current contracts above.
