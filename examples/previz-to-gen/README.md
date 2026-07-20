# previz → generative → edit

The three-stage pipeline in one project: a **three.js previz comp** (one deterministic world,
three named cameras, cuts as timeline clips) is **baked** to an mp4, that bake feeds a
**Seedance 2.0 reference-to-video comp** as its motion reference, and a root **edit** presents
the previz and pinned generation in a synchronized A/B with a live cut map and explainer rail.

```
harbor-previz (3d)  ──comp:// ref (bakes on submit)──▶  harborShot (generate)
        │                                                    │
        └────────────▶         main (edit)         ◀─────────┘
              synchronized A/B · cut map · explainer · music
```

## Run it

```sh
npm install          # from the repo root — links the workspace
npm run dev --workspace examples/previz-to-gen
```

Open the printed URL: `?comp=main` (the edit), `?comp=harbor-previz` (the 3D previz),
`?comp=harborShot` (the generative workbench).

## The pipeline, step by step

1. **Previz** — [src/compositions/harborScene.ts](src/compositions/harborScene.ts) defines the
   world (`defineThreeScene`): a lighthouse with a rotating beacon, a boat rounding the point,
   everything a pure function of time — scrub/preview/export agree exactly.
   [HarborPreviz.ts](src/compositions/HarborPreviz.ts) uses the package's
   `defineThreeSceneComposition()` factory to turn it into a comp: three camera cuts
   (`approach` → `boat chase` → `from the lamp`) become ordinary timeline clips without the example
   owning a second three.js composition adapter.

2. **Drag the comp in** — the previz IS the generator's input: drag `HarborPreviz` from the
   rail onto the workbench's inputs (or click the drop zone and pick it under COMPS). The
   recipe gets `refs: [{ kind: "video", src: "comp://harbor-previz" }]` — and at Generate the
   comp **bakes on submit**: a current readable, hash-suffixed bake in `framediff-cache/` (or `FRAMEDIFF_CACHE_DIR`) is reused, a stale one
   (scene edited since) re-exports first, automatically. The manual chain (✦ Bake → ingest →
   `asset://<id>` in `framediff.assets.json`) still works when you want an input pinned by hash.

3. **Generate** — [src/gen/harborShot.gen.ts](src/gen/harborShot.gen.ts) is the whole recipe:
   `generative({ model: "seedance-2.0", refs: [{ kind: "video", src: "comp://harbor-previz" }], … })`.
   Open `?comp=harborShot`, add a fal key (⚿ SERVICES in the topbar, or `FAL_KEY` in the env),
   and hit **Generate** — the only paid action; nothing regenerates implicitly. The dev bridge
   uploads the bake to the provider, polls the queue, and ingests the finished take with full
   provenance. Pin it by setting `take: N` (the Studio rewrites the literal for you) — the pin
   is the lockfile; until one is pinned the comp renders an honest slate.

   **Prompting r2v:** Seedance transfers the reference's *appearance* as eagerly as its
   motion — a stylized previz comes back stylized unless the prompt revokes it. Name the
   supplied modality (`@Video1`), say exactly what to copy and what to discard, and describe
   the edit with explicit time ranges and hard-cut times. Demand live-action surfaces in
   concrete nouns and describe lights as light ("a soft volumetric shaft", never the cone
   geometry). Keep previz frames bright enough to read — what the model can't see, it can't
   make real.

   For stronger art direction, add one photoreal scene keyframe as an appearance reference:

   ```ts
   refs: [
     { kind: "image", src: "asset://harbor-look" },
     { kind: "video", src: "comp://harbor-previz" },
   ]
   ```

   Then tell the prompt that `@Image1` defines the lighthouse, boat, materials, weather,
   palette, and photographic treatment while `@Video1` defines motion, framing, and timing.
   Use one wide establishing keyframe that contains both the lighthouse and boat; do not use a
   previz frame or stylized concept art, because that would reinforce the look being removed.

   A prompt can strongly request cut timing, but the model still authors one generated clip.
   When exact edits are non-negotiable, generate the three shots as separate takes and assemble
   them at frames 90 and 170 in FrameDiff. The edit—not the model—then owns both hard cuts.

4. **Edit** — [src/compositions/Main.html](src/compositions/Main.html) nests both comps at the
   same timeline frame, displays the two hard-cut positions, explains the pipeline in the
   right rail, and lays `<Audio>` underneath. Export from the Studio like any comp.

## Files

| file | role |
| --- | --- |
| `src/compositions/harborScene.ts` | the three.js world + named cameras (`approach`, `boat`, `beacon`) |
| `src/compositions/HarborPreviz.ts` | the previz comp — package factory configured with camera cuts (`kind: "3d"`) |
| `src/gen/harborShot.gen.ts` | the Seedance recipe — this file IS the generator (`kind: "generate"`) |
| `src/compositions/Main.html` | synchronized A/B, cut map, pipeline explainer, and music (`kind: "edit"`) |
| `framediff.assets.json` | asset manifest — the previz bake's id + generated takes land here |
