# FrameDiff examples

Examples are standalone consumer projects. They should demonstrate public `framediff` APIs rather
than accumulating a parallel library of effect and composition helpers.

Use this source layout for curated examples:

```text
src/
├── compositions/   composition HTML, wrappers, factories, and optional labs
├── effects/        project presets/configuration of packaged effects
├── data/           EDLs, imported camera data, constants, copy, asset mappings
├── gen/            explicit generative recipes
└── config.ts       registry/orchestration only
```

When example code is useful beyond its brand, footage, or story, promote it into
`packages/framediff`, add focused package tests and a public export, and import it back into the
example. Keep editorial decisions, fitted project data, prompts, looks, and scene content local.
The full rule and examples are in [the architecture guide](../docs/ARCHITECTURE.md#the-example-to-package-promotion-rule).
