# First Light

The project to open first.

```sh
npm run dev --workspace @framediff/example-first-light
```

Thirteen seconds of procedural title sequence in five compositions, with a ten-step walkthrough
that teaches the Studio rather than a workflow. It is also the reference project for the Studio's
feel work — the ambient stage, the synthesized sound palette, and the first-run overture all have
something to point at here.

## Why this exists

Every other example teaches a craft: grading footage, cutting a reel, driving a generative
pipeline. Each one is a good second project and a poor first one, because a newcomer's actual
questions are more basic than any of them:

- What happens to my files when I drag something?
- Is that black rectangle broken, or is the first frame just dark?
- Where did my edit go?

First Light answers those. It is small enough to read in one sitting, it has **no media
dependencies** — nothing to `git lfs pull`, nothing to download, every pixel is drawn by HTML and
CSS on the frame number — and its walkthrough sends you at the Studio's own surfaces in the order
a new user meets them.

## What is in it

| Composition | Kind | Frames | What it is |
|---|---|---:|---|
| `FirstLight` | edit | 400 | The root cut. Four nested clips on an external timeline document. |
| `Field` | scene | 400 | The aurora backdrop. Four blurred discs on Lissajous paths. |
| `Aperture` | scene | 150 | The title. The mark traces itself, then a wipe reveals the headline. |
| `Palette` | scene | 130 | The Studio's eight UI sounds, drawn as the envelopes they actually are. |
| `Ledger` | scene | 140 | The determinism claim, as a filmstrip of hashed frames. |

Every scene is backed by a JSON document and a schema, so its copy, colour and layout are data —
editable in the Inspector, diffable in git, and reachable by an agent.

## Two things worth reading the source for

**The composition script's `document` is the composition's data, not the DOM.** Composition
scripts run with `root`, `query`, `queryAll`, `onFrame`, `onDocument` and `document` in scope,
where `document` is the JSON document. `document.createElement` will not do what you expect. Build
markup statically — which is better anyway, because static elements are selectable on the canvas.

**Use `translate` and `scale`, not `transform`.** The JSON binding places bound elements with
`transform`. A composition that writes `element.style.transform` is fighting its own document for
control of the layout. The independent longhands (`translate`, `scale`, `rotate`) compose with it
instead. `Aperture.html` animates its rule with `scale` for exactly this reason.

## Rendering it

Press Render. It exports through WebCodecs in the browser, and the Studio mutes itself for the
duration so the completion chime is the only thing you hear. Rendering the same project twice
produces the same bytes; `example-determinism-check` proves that frame by frame.
