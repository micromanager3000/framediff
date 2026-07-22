import { defineComposition, defineTimelineDocument, type CompositionSetup } from "framediff";
import source from "./AudioLab.html?raw";
import document from "./AudioLab.comp.json";
import timeline from "./AudioLab.timeline.json";

type AudioLabDocument = typeof document;
const audioAutomation: CompositionSetup = ({ query, onFrame, onDocument }) => {
  let mix: AudioLabDocument["audio"] = document.audio;
  onDocument((next) => { mix = (next as AudioLabDocument).audio; });
  return onFrame(({ frame }) => {
    const audio = query<HTMLAudioElement>("[data-fd-id=audio-bed]");
    if (!audio) return;
    const span = Math.max(1, mix.fadeTo - mix.fadeFrom);
    const volume = frame <= mix.fadeFrom ? mix.volume : Math.max(0, mix.volume * (1 - (frame - mix.fadeFrom) / span));
    audio.dataset.framediffVolume = String(volume);
    audio.volume = volume;
  });
};

export const audioLabComp = defineComposition(source, {
  document,
  timeline: defineTimelineDocument(timeline),
  setup: audioAutomation,
  meta: {
    timelineFile: "src/compositions/playground/AudioLab.timeline.json",
    document: {
      file: "src/compositions/playground/AudioLab.comp.json",
      schema: "src/compositions/playground/AudioLab.schema.json",
      bindings: { "audio-kicker": "/kicker", "audio-title-a": "/titleA", "audio-title-b": "/titleB", "audio-summary": "/summary", "audio-bed": "/audio" },
    },
  },
});
