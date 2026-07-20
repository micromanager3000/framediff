# FrameDiff Studio agent API

> This is the machine-editing surface for the canonical
> [FrameDiff architecture](./ARCHITECTURE.md) and
> [Studio editing contracts](./STUDIO-EDITING-CONTRACTS.md).

FrameDiff Studio publishes a versioned machine surface at `window.__framediffAgent`. It is available
in local Studio projects without a second mutation server or an agent-specific source writer. Browser
automation, an MCP browser adapter, or a CLI driving Chromium can use the same four operations:

| Call | Result |
| --- | --- |
| `inspect()` | Stable composition/object IDs, timeline placement, animation bindings and authority, source hashes, asset content hashes, artifact freshness and Git dirtiness. |
| `check(snapshot?)` | Machine-readable errors, warnings and informational editability diagnostics. |
| `snapshot(compositionKey, frame)` | A PNG data URL and SHA-256 from the exact random-access export capture path. |
| `execute({ expectedRevision, command })` | A guarded semantic edit, exact source receipt, new revision and post-edit check result. |

The API is deliberately not a DOM scraper. It projects the same plain Studio snapshots and dispatches
through the same session, source compilers, revision-checked transaction bridge, grouped history and
HMR reconciliation used by direct manipulation.

## Inspect and check

```js
const project = await window.__framediffAgent.inspect();
const check = await window.__framediffAgent.check(project);

console.log(project.schemaVersion, project.revision);
console.table(project.compositions.map(({ composition, objects, animations }) => ({
  key: composition.key,
  objects: objects.length,
  animations: animations.length,
})));
console.table(check.diagnostics);
```

Every composition entry includes its complete declared source/dependency set. Artifacts with input
sidecars are `current` only when all recorded source hashes still match; otherwise they are `stale`.
Media has a content hash and local/remote availability. Registered animation values include literal,
shared, computed or opaque authority and frame-native key bindings.

## Guarded semantic edit

Always carry the revision returned by `inspect()`. FrameDiff checks it immediately before dispatch; a
different current revision produces a `source-conflict` diagnostic and performs no write.

```js
const before = await window.__framediffAgent.inspect();
const result = await window.__framediffAgent.execute({
  expectedRevision: before.revision,
  command: {
    type: "edit-placement",
    compositionKey: "editorial-lab",
    itemId: "interview",
    patch: { from: 24, durationInFrames: 72 },
  },
});

if (!result.ok) throw new Error(result.message);
console.log(result.receipt, result.afterRevision, result.check);
```

This placement command goes through the Studio front-trim kernel. If the left edge changes while the
right edge stays fixed, FrameDiff advances the real media in-point in source seconds in the same atomic
transaction. Other commands cover element properties, typed Inspector fields, grade presets,
registered tween/key edits, grouped animation edits, motion paths, helper unrolling, render windows,
and shared Undo/Redo.

## Exact visual feedback

```js
const frame = await window.__framediffAgent.snapshot("gsap-motion-lab", 60);
document.querySelector("img").src = frame.dataUrl;
console.log(frame.contentHash, frame.width, frame.height, frame.frame);
```

`snapshot()` uses `captureCompositeFrame`, including exact media-frame decode, DOM rasterization,
WebGPU/Three.js capture hooks, LUT/grade layers and nested compositions. It is not a screenshot of the
scaled Studio preview. The selected frame and authored state are deterministic; PNG/codec bytes remain
subject to the platform encoder where applicable.

## Conflict and history behavior

- Each edit reads the current source revision and commits through `/__framediff/edit` atomically.
- The project-level `expectedRevision` protects the inspect-to-edit interval.
- The returned receipt contains exact before/after source text and hashes.
- Agent edits appear in the Studio Undo stack; Studio edits are visible to the agent on its next inspect.
- Undo and Redo replay receipts only when their expected hashes still match. External edits surface as
  conflicts instead of being overwritten.

The top-bar **AGENT API v1** control runs the same `check()` call and provides a compact human-readable
diagnostic view. The global API remains the full JSON surface for tools.
