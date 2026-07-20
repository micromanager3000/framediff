# FrameDiff cloth showcase

A standalone consumer project for the reusable `createClothSetup()` effect. The composition turns
an authored HTML kinetic poster into a three.js cloth surface, then drives its physics from the
absolute FrameDiff frame clock.

The project follows the repository architecture:

- `src/compositions/` owns the poster, story, timing, and composition boundary.
- `src/effects/` owns the project-specific cloth preset and imports the packaged effect.
- `src/config.ts` only exposes the composition registry.
- the SvelteKit route is a Studio host; it does not own composition visuals.

Run it from the repository root:

```sh
npm run dev --workspace @framediff/example-cloth-showcase
```

The 8-second study demonstrates top-corner pins, wind, scripted impulses, a moving sphere collider,
a floor plane, live DOM texture updates, random-access scrubbing, and exact canvas capture.
