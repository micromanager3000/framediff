import { defineProjectGuide } from "framediff";

/**
 * The first ten minutes.
 *
 * Every other example's walkthrough teaches a workflow against a brand's footage. This one
 * teaches the Studio itself, because that is what a first-time user is actually confused by:
 * not "how do I grade this shot" but "what happens to my files when I drag something", "is that
 * black rectangle broken", and "where did my edit go".
 *
 * Most of the steps below are the Studio's common ones, pointed at this project's compositions.
 * The sentences that are overridden are the ones where First Light has something of its own to
 * say — that nothing here is a media file, that the surround is a status light, that copy is
 * schema-backed data. That split is the point of the shared model: the common half stays in one
 * place, and what is left reads as what this project is actually about.
 */
export const firstLightGuide = defineProjectGuide({
  id: "first-light",
  title: "First light",
  summary:
    "Ten minutes with the Studio, using a project small enough to read in one sitting. "
    + "Play it, take it apart, change it, and render it — then open the diff and see every "
    + "edit you made sitting in plain HTML and JSON.",
  estimatedMinutes: 10,
  steps: [
    {
      // Step ids are the keys the Studio remembers progress under, so they outlive rewrites of
      // the copy around them. These are the ids this walkthrough shipped with.
      common: "play",
      id: "watch",
      description:
        "Thirteen seconds, four compositions, no media files. Everything on screen is drawn by "
        + "HTML, CSS and a few lines of script running on the frame number.",
      success:
        "The transport reads out timecode and frames together, and scrubbing ticks at a pitch "
        + "that rises as you move right.",
      target: { compositionKey: "first-light", frame: 0 },
    },
    {
      common: "stage",
      try: "Jump to frame 300 and press Space, then watch the surround rather than the frame.",
      success:
        "The field picks up speed and drifts through its palette while the transport runs, and "
        + "settles again when you stop.",
      target: { compositionKey: "first-light", frame: 300 },
    },
    {
      common: "nest",
      id: "nested",
      description:
        "The edit is four clips, and each clip is a whole composition in its own right. This is "
        + "the same nesting the larger examples use — there is no separate 'simple' mode here.",
      try: "Double-click the title on the canvas, or open Aperture in the left rail.",
      target: { compositionKey: "aperture", frame: 90 },
    },
    {
      common: "manipulate",
      id: "drag",
      try: "Drag the headline. Watch the top bar say 'writing source…', then press ⌘Z.",
      success:
        "The move lands, undo puts it back, and Aperture.comp.json on disk holds the number "
        + "you dragged it to.",
      target: {
        compositionKey: "aperture",
        frame: 90,
        selection: { kind: "element", objectId: "aperture-title" },
        panel: "inspector",
      },
    },
    {
      id: "text",
      phase: "EDIT",
      title: "Change the words",
      description:
        "Copy is data, held in the composition's JSON document and validated by its schema — "
        + "which is also what generates the Inspector's fields.",
      try: "Double-click the headline on the canvas and type something of your own.",
      success: "The canvas updates as you type, and the new string is in Aperture.comp.json.",
      target: {
        compositionKey: "aperture",
        frame: 90,
        selection: { kind: "element", objectId: "aperture-title" },
        panel: "inspector",
      },
    },
    {
      common: "properties",
      id: "field",
      title: "Retune the light",
      description:
        "The backdrop is four blurred discs on Lissajous paths. Its schema exposes exactly the "
        + "properties worth touching, with ranges that keep them sane.",
      try: "Open Field, select a light in the Inspector, and push Drift and Breath around.",
      success: "The aurora changes shape under the frame you are watching, live.",
      target: {
        compositionKey: "field",
        frame: 60,
        selection: { kind: "element", objectId: "field-violet" },
        panel: "inspector",
      },
    },
    {
      common: "recut",
      id: "trim",
      description:
        "Timeline placement lives in an external JSON document, so a re-cut is a readable diff "
        + "rather than an opaque binary change.",
      try: "Drag the Sound palette clip earlier, or trim its right edge with the playhead and ].",
      success:
        "The clip moves, neighbouring clips show drop targets, and FirstLight.timeline.json "
        + "records the new from and durationInFrames.",
      target: {
        compositionKey: "first-light",
        frame: 150,
        selection: { kind: "clip", objectId: "light-palette" },
      },
    },
    {
      common: "source",
      id: "code",
      try: "Open the CODE panel with the Aperture composition selected.",
      target: { compositionKey: "aperture", frame: 90, panel: "code" },
    },
    {
      common: "feel",
      success:
        "The control's own bars stop dancing when you mute it, and the stage holds still with "
        + "motion off without going back to being an empty black rectangle.",
      target: { compositionKey: "first-light", frame: 200 },
    },
    {
      common: "render",
      success:
        "The stage sweeps amber with progress, the Studio stays silent throughout, and a chime "
        + "and a ring mark the finish.",
      target: { compositionKey: "first-light", frame: 0 },
    },
  ],
});
