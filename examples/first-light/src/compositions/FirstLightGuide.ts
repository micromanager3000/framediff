import type { StudioGuideDescriptor } from "@framediff/studio-model";

/**
 * The first ten minutes.
 *
 * Every other example's walkthrough teaches a workflow against a brand's footage. This one
 * teaches the Studio itself, because that is what a first-time user is actually confused by:
 * not "how do I grade this shot" but "what happens to my files when I drag something", "is that
 * black rectangle broken", and "where did my edit go".
 *
 * Each step names a concrete action and an observable result, so nobody has to guess whether it
 * worked.
 */
export const firstLightGuide: StudioGuideDescriptor = {
  id: "first-light",
  title: "First light",
  summary:
    "Ten minutes with the Studio, using a project small enough to read in one sitting. " +
    "Play it, take it apart, change it, and render it — then open the diff and see every " +
    "edit you made sitting in plain HTML and JSON.",
  estimatedMinutes: 10,
  steps: [
    {
      id: "watch",
      phase: "WATCH",
      title: "Play the whole piece",
      description:
        "Thirteen seconds, four compositions, no media files. Everything on screen is drawn by " +
        "HTML, CSS and a few lines of script running on the frame number.",
      try: "Press Space. Press it again to stop, then drag the playhead across the timeline.",
      success:
        "The transport reads out timecode and frames together, and scrubbing ticks at a pitch " +
        "that rises as you move right.",
      target: { compositionKey: "first-light", frame: 0 },
    },
    {
      id: "stage",
      phase: "WATCH",
      title: "Read the stage",
      description:
        "The area around the frame is a status light, not decoration. It rests when you rest, " +
        "warms while playback runs, and sweeps amber while a render is working.",
      try: "Jump to frame 300 and press Space, then watch the surround rather than the frame.",
      success:
        "The field picks up speed and drifts through its palette while the transport runs, and " +
        "settles again when you stop.",
      target: { compositionKey: "first-light", frame: 300 },
    },
    {
      id: "nested",
      phase: "STRUCTURE",
      title: "Open a nested composition",
      description:
        "The edit is four clips, and each clip is a whole composition in its own right. This is " +
        "the same nesting the larger examples use — there is no separate 'simple' mode here.",
      try: "Double-click the title on the canvas, or open Aperture in the left rail.",
      success:
        "The breadcrumb grows a level. Use it, or the up arrow next to it, to get back out.",
      target: { compositionKey: "aperture", frame: 90 },
    },
    {
      id: "drag",
      phase: "EDIT",
      title: "Move something, then undo it",
      description:
        "Direct manipulation writes to the file that owns the property. Nothing is stored in a " +
        "hidden document that only the Studio can read.",
      try: "Drag the headline. Watch the top bar say 'writing source…', then press ⌘Z.",
      success:
        "The move lands, undo puts it back, and Aperture.comp.json on disk holds the number " +
        "you dragged it to.",
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
        "Copy is data, held in the composition's JSON document and validated by its schema — " +
        "which is also what generates the Inspector's fields.",
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
      id: "field",
      phase: "EDIT",
      title: "Retune the light",
      description:
        "The backdrop is four blurred discs on Lissajous paths. Its schema exposes exactly the " +
        "properties worth touching, with ranges that keep them sane.",
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
      id: "trim",
      phase: "EDIT",
      title: "Re-cut the edit",
      description:
        "Timeline placement lives in an external JSON document, so a re-cut is a readable diff " +
        "rather than an opaque binary change.",
      try: "Drag the Sound palette clip earlier, or trim its right edge with the playhead and ].",
      success:
        "The clip moves, neighbouring clips show drop targets, and FirstLight.timeline.json " +
        "records the new from and durationInFrames.",
      target: {
        compositionKey: "first-light",
        frame: 150,
        selection: { kind: "clip", objectId: "light-palette" },
      },
    },
    {
      id: "code",
      phase: "SOURCE",
      title: "Read the file you have been editing",
      description:
        "The Code panel is the same text your editor and your agents see. There is no export " +
        "step between what you just did and what is on disk.",
      try: "Open the CODE panel with the Aperture composition selected.",
      success:
        "You can find the exact element you dragged, by the data-fd-id the Inspector showed you.",
      target: { compositionKey: "aperture", frame: 90, panel: "code" },
    },
    {
      id: "feel",
      phase: "STUDIO",
      title: "Tune the Studio itself",
      description:
        "Sound is synthesized in the browser — no audio files — and it is always muted while a " +
        "render runs. Motion follows your system's reduced-motion setting until you say otherwise.",
      try: "Open the sound control in the top bar and try the level slider, then toggle Motion.",
      success:
        "The control's own bars stop dancing when you mute it, and the stage holds still with " +
        "motion off without going back to being an empty black rectangle.",
      target: { compositionKey: "first-light", frame: 200 },
    },
    {
      id: "render",
      phase: "DELIVER",
      title: "Render it",
      description:
        "WebCodecs, in this browser, on your machine. Rendering the same project twice produces " +
        "the same bytes — which is what the determinism-check example proves frame by frame.",
      try: "Press Render. Let it finish.",
      success:
        "The stage sweeps amber with progress, the Studio stays silent throughout, and a chime " +
        "and a ring mark the finish.",
      target: { compositionKey: "first-light", frame: 0 },
    },
  ],
};
