# Script Lab

A UX prototype for the `script` comp kind: instead of a fixed 16:9 canvas, the
script is a full-height, vertically scrollable sheet that owns the middle area
of the studio.

Run it with the `script-lab` launch config, or:

```bash
python3 prototypes/script/server.py 4181
```

## What it explores

**A free-form header** opens the document: an editable title and a block of prose
for whatever the rows can't hold — logline, intent, length target, what's still
unshot. The **total running time** lives here rather than in the chrome, as a
large derived readout beside the notes, with the scene count under it. It
recomputes on every retime, reorder, add, and delete, and flashes amber when it
changes. It scrolls away with the header; the column labels below it stay stuck.

**Five columns**

1. **TIME** — derived range (`in`/`out`), never edited directly.
2. **DURATION** — the editable timing truth. Click to type, drag ↑↓ to scrub,
   or nudge ±0.5s. Every start time below ripples immediately (cascading flash),
   and TRT updates in the tab strip / status bar.
3. **NARRATION / DIALOG** — the spoken line, whatever its kind. No type chip:
   the words already carry it (`KEEPER — "You're late."` is obviously dialog),
   so a label would be a redundant second signal.
4. **VISUAL / SFX** — scene label, prose description of the picture, and the
   sound effects for the scene, which belong with the picture rather than with
   the spoken line. The SFX line fades back when empty and comes up on row hover.
5. **SOURCE** — what realizes the row. Either a **comp** that outputs an image
   or a video (rough board, previz, gen still, gen motion, take, edit comp, 3D)
   or a **media file** — an image or a video clip. Rows start empty and get
   swapped for something more finished as the scene firms up.

All four text fields are free-form: **Enter inserts a newline**, Escape drops
focus, and edits commit as you type. Nothing is validated or reformatted yet.

**Row handling** (left gutter, revealed on hover)

- **⠿ drag** to reorder — the sheet reflows live, and dropping ripples every
  affected start time. Focus the handle and press ↑ / ↓ to move without dragging.
- **▶** jumps the preview to that scene and plays.
- **✕** deletes the scene, with a 7-second **undo** toast.

**Picking a source** (⇄ on the card, or the empty slot)

- **COMPS** — comps already in the project, grouped with *FOR THIS SCENE* first
  so swapping up the maturity ladder (rough → previz → gen → take → edit) is one
  click.
- **NEW COMP** — create one right there: pick a kind, name it (prefilled from the
  scene), and it lands in the rail and attaches to the row in one step.
- **MEDIA** — project images and clips, or **drop a real file** (onto the picker
  or straight onto the row's source cell). Dropped files render for real — images
  as stills, videos playing in the preview monitor in sync with the scrubber.
  When a clip's length differs from the scene, the card offers *fit scene*, which
  sets the scene duration to the clip and ripples the sheet.

**Two tabs**

- **SCRIPT** — the sheet above.
- **PREVIEW** — a 16:9 program monitor with the narration overlaid as captions
  and the visual description (plus its SFX line) as a slate, on top of whatever
  source fills each row. Chaptered scrubber (segment widths ∝ scene durations),
  play/pause, ← → scene jumps.

The sheet deliberately has **no "current row" highlight**. The playhead belongs to
PREVIEW, and the two tabs are mutually exclusive, so a highlight on the sheet would
mark something you can't act on. If row selection ever earns actions of its own,
that's when it should get a visual state.

## House rule this prototype follows

No colored accent rule on the left edge of anything — see "UI conventions" in the
repo's `AGENTS.md`. State is carried by a background tint or by something the row
already owns; kind is carried by the badge or chip that already labels it.

State is in-memory only; reload resets the demo content (the Harbor short from
`examples/previz-to-gen`).
