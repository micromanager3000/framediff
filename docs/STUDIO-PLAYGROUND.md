# Studio Playground acceptance project

`examples/studio-playground` opens on **Studio Playground**, a source-backed project designed for
repeatable exploratory testing. It is intentionally a nested production graph, not a flat showcase:

```text
StudioPlayground · edit · 2,070f
├─ CoverageMap · doc · 150f
├─ AuthoringChapter · edit · 480f
│  ├─ DirectManipulationLab
│  ├─ RichPropertiesLab
│  ├─ GsapMotionLab
│  └─ PackageEffectsLab
├─ EditorialChapter · edit · 480f
│  ├─ EditorialLab
│  ├─ GradeLab
│  ├─ HeroWithLowerThird
│  └─ LowerThird
├─ EffectsChapter · edit · 480f
│  ├─ ClothLab
│  ├─ WorldLab
│  └─ HeroPlane3D.uizoom
└─ PipelineChapter · edit · 480f
   ├─ skyTimelapse
   ├─ blazerRelight
   ├─ AudioLab
   └─ EndCard
```

The root also owns a quiet persistent audio bed and a frame-driven chapter HUD. The bed and accent
are small generated fixtures checked into `public/audio`, so the acceptance graph has real,
network-independent audio without depending on licensed production media. Chapters own their
navigation overlay, while leaf compositions stay focused and independently reusable. This gives the
timeline meaningful nesting at three levels without hiding each system inside one oversized comp.

## Capability map

| Area | Runnable acceptance surface | What it exercises |
| --- | --- | --- |
| Composition contract | CoverageMap, AudioLab, generation recipes, edit and 3D labs | semantic `doc`, `audio`, `edit`, and `scene` kinds across HTML, generative, and Three.js adapters |
| Canvas authoring | DirectManipulationLab, RichPropertiesLab | immediate JSON-backed move/resize/text, fills, flex and typed Inspector fields |
| Motion | GsapMotionLab, PackageEffectsLab, LowerThird | GSAP registration, keys, paths, trace unroll, `onFrame`, clip motion, wipe, character rise, `spring()` and `interpolate()` |
| Editorial | EditorialLab, HeroWithLowerThird | real media, trims, playback rate, explicit layers, badges and nested alpha overlays |
| Finishing | GradeLab, HeroPlane3D.uizoom | grade serialization, named looks, LUTs, camera curves, depth of field and motion blur |
| Simulation/3D | ClothLab, WorldLab | deterministic cloth, DOM texture capture, native Three.js scenes, keyframed and procedural cameras |
| Generation | skyTimelapse, blazerRelight | prompt/model parameters, input references, Add Take, editable drafts, pinned immutable takes and provenance |
| Audio | AudioLab and persistent root bed | audio composition kind, media lanes and deterministic fade automation |
| Delivery | root Guide, Cache and Agent API | source fingerprints, exact PNG snapshots, semantic inspection and browser-local render controls |

Open **GUIDE** for the maintained 17-scenario walkthrough. Every step contains a concrete action, an
observable success condition and a tested composition/frame target.

## Run and test

```sh
npm ci
npm run dev --workspace examples/studio-playground
# http://localhost:5173/ opens the Studio Playground project

npm run check --workspace examples/studio-playground
npm run build --workspace examples/studio-playground
npx vitest run examples/studio-playground/src/compositions/playground/StudioPlaygroundGuide.test.ts
npx playwright test tests/e2e/studio-playground.spec.ts --project=chromium
```

The browser smoke test covers default discovery, root/chapter/leaf navigation, Guide targeting,
machine inspection, exact-frame diversity, visual/audio lane separation, embedded-resource safety,
and local audio availability. The Guide is the exploratory charter: on each release, follow every step at a
normal desktop viewport, repeat hierarchy/generation/agent checks at the compact viewport, and record
new problems in the reusable strategy at
[USER-TESTING-AND-STRATEGY-2026-07-20.md](./USER-TESTING-AND-STRATEGY-2026-07-20.md).

## Adding coverage

When a package gains a new semantic composition kind, runtime adapter, starter, or public effect family:

1. Add or extend a focused leaf composition with stable `data-fd-id` values.
2. Nest it into the chapter that matches the user's workflow rather than appending it to the root.
3. Add one Guide scenario with a concrete action and observable success condition.
4. Extend the Guide unit test or Playwright smoke test when a stable automated assertion exists.
5. Check non-linear scrubbing and exact capture for any frame-driven or canvas/WebGL behavior.

Licensed footage is optional for most of the Playground. Acceptance-critical audio is generated and
checked in; other media-dependent labs should still report availability clearly through badges and
Agent diagnostics when local cache assets are absent.
