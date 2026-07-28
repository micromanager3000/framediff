# Timeline Lab

Interactive prototype of the next FrameDiff Studio timeline: 21 editing ideas (precision loupe, sticky snap with breakaway, ripple-insert ＋TIME wedge, magnetic storyline, connected clips, beat grid, blade, minimap, take stacks, …) integrated into one system on the studio's design tokens.

**Run:**

```bash
python3 -m http.server 4179 --bind 0.0.0.0 --directory prototypes/timeline
```

…then open http://reddy2macmini.local:4179 from any device on the local network (on the serving machine itself, http://localhost:4179 also works; IP fallback: `ipconfig getifaddr en0`). Also registered as the `timeline-lab` launch config; opening `index.html` directly works too — zero dependencies.

- [index.html](./index.html) — shell + the in-app IDEAS drawer (hover an idea to flash the UI it lives in; `?` shows the keyboard map)
- [app.js](./app.js) — model, snap/ripple engines, gestures, loupe, minimap, sounds
- [styles.css](./styles.css) — mirrors `packages/studio-ui/src/studio.css` tokens
- [IDEAS.md](./IDEAS.md) — the 21 ideas with research provenance, first-principles rationale, deliberate rejections, and porting notes for `Timeline.svelte`
