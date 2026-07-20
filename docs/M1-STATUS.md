# M1 — overnight build status

> Historical milestone note: the active composition ABI is now framework-free HTML/CSS/JavaScript.
> See [HTML-COMPOSITIONS.md](HTML-COMPOSITIONS.md) and
> [COMPOSITION-PROPERTY-AUDIT.md](COMPOSITION-PROPERTY-AUDIT.md). References below to React/TSX
> describe the implementation this milestone originally shipped, not the current runtime.

> **Date:** 2026-06-24 · **Read this first.**

## Update — pivoted to a code-driven model

After the overnight GUI build (documented below), the direction changed: **visuals are now real
HTML/CSS/React component files orchestrated by TypeScript code, and the app is just a preview of
that code — no GUI, no sync.** See **[app/README.md](../app/README.md)** for the current model.

- **Kept:** code as the source of truth, frame-driven deterministic compositing, the demo.
- **Replaced:** the JSON `Composition` model → real React components; the timeline/inspector/
  code-panel GUI and the bidirectional sync are **gone** (preserved in git history).
- **Deferred:** MP4 export — with DOM visuals it needs DOM→frame capture (next step). The GUI's
  drag-drop media + audio-export are superseded (media is now referenced in code via `<Video>` etc.).

Everything below documents the earlier overnight GUI build, for the record.

---

## TL;DR

The core loop you asked for is **built and working**: drop in video / images / audio, a code
file (`composition.ts`) describes the compositing as the single source of truth, a GUI is synced
to that code bidirectionally, and you can render frame-by-frame to MP4. It runs as a pure web app
in Chromium.

This is **M1 — the vertical slice**, not the full PRD (that's weeks of work). What's here is real
and verified; the deferred pieces are listed below honestly.

## How to try it (2 minutes)

```sh
cd ~/code/framediff/app
npm install      # already done overnight, safe to re-run
npm run dev
```

Open the URL in **Chrome / Edge / Brave / Arc**, then:

1. You'll see a demo composition (animated title + shapes) playing. Scrub / hit ▶.
2. **+ Add media** (or drag a file in) → drop a video, image, or audio file. It appears on the
   timeline and in the preview, and the code panel updates.
3. **Select a clip** on the timeline → tweak it in the Inspector (move, resize, opacity, text…).
   Watch the `composition.ts` code change. Or **edit the code directly** → the GUI updates.
4. **⏺ Render** (pick H.264 or AV1) → saves/downloads an MP4. (If the save dialog is blocked in an
   embedded view, it falls back to a download — open in a real tab for the picker.)
5. **Open project…** → pick a folder. `composition.ts` is written to disk and becomes the source
   of truth — edit it in your editor or with Claude Code and the GUI updates live.

## What's verified (in a real Chromium, via automation)

| Capability | Evidence |
| --- | --- |
| Compositor + animation | Demo renders correctly (text/shapes/keyframes). |
| GUI ⇄ code sync | A code edit changed the preview title + bg; a timeline selection populated the Inspector. |
| Drop-in video + image | Dropped test video composited + seeked correctly in the preview. |
| Frame-by-frame export | Demo → valid 180-frame H.264 MP4; dropped video → composited into a valid MP4 (frame checked). |
| Audio | Preview plays on ▶; export contains a non-silent AAC 48k stereo track. |
| File System Access layer | read/write/round-trip unit-verified against an API-shaped mock. |

## Needs your test (couldn't verify headlessly)

- **Open project… (folder picker)** — `showDirectoryPicker` needs a real click + native dialog,
  which automation can't drive. The read/write/poll logic is unit-tested and the integration is
  sound, but please try the folder flow and the "edit composition.ts in Claude Code → GUI
  updates" loop. If anything's off here, it's the most likely spot.

## Known limitations / deferred (not bugs)

- **Chromium-only** (File System Access + WebCodecs).
- **Video export uses HTMLVideoElement seeking** → visually correct, not strictly frame-perfect.
  A WebCodecs `VideoDecoder` path makes it exact — deferred.
- **Color range**: WebCodecs tags output limited-range vs the full-range canvas (small color
  shift) — the M0 finding, not yet fixed in the renderer.
- Preview video is choppy *during playback* (seek-based); scrubbing + export are fine.
- One lane per track; no transitions or shader effects yet (transform + opacity + keyframes only).
- In-memory media uses blob URLs (lost on reload) unless a project folder is open (then persisted).

## Commits (this build)

`app/` scaffold → GUI⇄code sync → media + export → audio → File System Access. Each milestone is a
separate commit on `main` with a verification note. The M0 spike + PRD are unchanged underneath.

## Suggested next steps

1. Try the folder flow + AI-editing loop (the one unverified path).
2. If you want exact video: add a WebCodecs `VideoDecoder` export path.
3. Fix the color-range tag so preview == export colors.
4. Then: transitions/effects (WebGPU tier), multi-clip lanes, and the cloud render/publish pieces
   from the PRD.
