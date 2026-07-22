# Vertical Hero

A from-scratch 1080×1920 validation project for FrameDiff's composition-owned authoring model.

- `VerticalBackdrop` is a procedural scene: HTML/CSS/inline TypeScript-like runtime code renders it, while copy, geometry, color, and motion parameters live in `VerticalBackdrop.comp.json`.
- `VerticalLowerThird` is a transparent, directly editable scene whose typography and layout live in `VerticalLowerThird.comp.json`.
- `VerticalMain` is an edit whose layer structure stays in HTML and whose placement data lives in `VerticalMain.timeline.json`.
- `VerticalAtmosphere` is a 9:16 generative recipe with a `comp://vertical-backdrop` input.

Run `npm run dev --workspace @framediff/example-vertical-hero` and open the Studio at the printed URL.
