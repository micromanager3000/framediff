# FrameDiff examples

Examples are standalone consumer projects. They should demonstrate public `framediff` APIs rather
than accumulating a parallel library of effect and composition helpers.

Each example selects the project-local Git LFS asset store in `framediff.config.json`. Binary assets
belong in its top-level `assets/` directory and are covered by the example's `.gitattributes`; run
`git lfs pull` after cloning before starting an asset-backed example.

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

`vertical-hero` is the smallest complete Studio acceptance project: a 9:16 procedural scene and
lower third backed by composition JSON, an edit backed by external timeline JSON, and a generative
recipe backed by `comp://` inputs. Its end-to-end tests exercise the same edits through Studio.
