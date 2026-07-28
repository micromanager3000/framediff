# Timeline Lab

Interactive prototype of the next FrameDiff Studio timeline: 21 editing ideas (precision loupe, sticky snap with breakaway, ripple-insert ＋TIME wedge, magnetic storyline, connected clips, beat grid, blade, minimap, take stacks, …) integrated into one system on the studio's design tokens.

**Run:**

```bash
python3 -m http.server 4179 --bind 0.0.0.0 --directory prototypes
```

…then open http://reddy2macmini.local:4179 from any device on the local network (on the serving machine itself, http://localhost:4179 also works; IP fallback: `ipconfig getifaddr en0`). The root is a hub page; the full lab lives at `/timeline/`. Also registered as the `timeline-lab` launch config; opening `index.html` directly works too — zero dependencies.

**Single-feature prototypes.** The same engine serves focused one-idea pages via `?feature=…` — each strips the project and chrome down to a plain baseline timeline plus exactly that feature, with only its idea card in the drawer:

| URL | Feature |
|---|---|
| `/timeline/?feature=loupe` | Precision loupe + ⇧ fine drag + hold-frame overrun |
| `/timeline/?feature=snap` | Sticky snapping with breakaway + named snap targets |
| `/timeline/?feature=beats` | Beat grid |
| `/timeline/?feature=ripple` | ＋TIME ripple insert + gaps-as-objects |
| `/timeline/?feature=magnetic` | Magnetic storyline |
| `/timeline/?feature=blade` | Blade with preview |
| `/timeline/?feature=takes` | Generative take stacks |

Page definitions live in the `PAGES` table at the top of [app.js](./app.js) — adding a page is one entry plus a card in [../index.html](../index.html).

- [index.html](./index.html) — shell + the in-app IDEAS drawer (hover an idea to flash the UI it lives in; `?` shows the keyboard map)
- [app.js](./app.js) — model, snap/ripple engines, gestures, loupe, minimap, sounds
- [styles.css](./styles.css) — mirrors `packages/studio-ui/src/studio.css` tokens
- [IDEAS.md](./IDEAS.md) — the 21 ideas with research provenance, first-principles rationale, deliberate rejections, and porting notes for `Timeline.svelte`
