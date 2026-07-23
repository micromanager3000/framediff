import {
  clipMotion2DFromDocument,
  combineCompositionSetups,
  createAudioFadeOutSetup,
  createClipMotionSetup,
  type ClipMotion2D,
  type ClipMotion2DDocument,
  type CompositionSetup,
} from "framediff";
import initialDocument from "../compositions/HeroRaw.comp.json";

export type HeroRawDocument = typeof initialDocument;

export const heroMotionRows = new Map<string, ClipMotion2D>();

function updateMotionRows(document: HeroRawDocument): void {
  heroMotionRows.clear();
  for (const [key, row] of Object.entries(document.motion)) {
    heroMotionRows.set(key, clipMotion2DFromDocument(row as ClipMotion2DDocument));
  }
}
updateMotionRows(initialDocument);

const documentMotionSetup: CompositionSetup = ({ document, onDocument, onCleanup }) => {
  updateMotionRows(document as HeroRawDocument);
  const stop = onDocument((next) => updateMotionRows(next as HeroRawDocument));
  onCleanup(stop);
};

export const heroClipMotionSetup = combineCompositionSetups(
  documentMotionSetup,
  createClipMotionSetup({ motions: heroMotionRows }),
);

const heroAudioFadeSetup = createAudioFadeOutSetup({
  selector: "[data-fd-id=music-bed]",
  settings: (value) => {
    const audio = (value as HeroRawDocument).audio.bed;
    return { from: audio.fadeFrom, to: audio.fadeTo, volume: audio.volume };
  },
});

export const heroMotionSetup = combineCompositionSetups(heroClipMotionSetup, heroAudioFadeSetup);
