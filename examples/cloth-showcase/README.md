# FrameDiff cloth showcase

A standalone consumer project for the reusable `createClothComposition()` and
`createClothSetup()` effects. The showcase takes an independently authorable FrameDiff
composition, mounts it on the parent clock, and turns its live frame into a three.js physical
surface.

The project follows the repository architecture:

- `src/compositions/MaterialPoster.*` is the input composition; it contains no cloth code.
- `src/compositions/KineticCloth.*` owns the material-study scene and the nested-comp input.
- `src/effects/` owns the project-specific cloth preset and imports the packaged effect.
- `src/config.ts` only exposes the composition registry.
- the SvelteKit route hosts Studio and a focused Material Lab control surface. Presets and
  high-value controls write the same JSON document used by the generic Inspector.

Run it from the repository root:

```sh
npm run dev --workspace @framediff/example-cloth-showcase
```

The 8-second study demonstrates composition-as-texture input, holographic thin-film shading,
attachment presets, wind, scripted impulses, a moving sphere collider, a floor plane, live frame
updates, random-access scrubbing, and exact canvas capture. The rendered composition links back to
[HoloCloth](https://holocloth.vercel.app) as the visual inspiration; the implementation and creator
UX are built independently on FrameDiff's deterministic runtime.
