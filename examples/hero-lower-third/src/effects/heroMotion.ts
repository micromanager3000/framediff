import {
  combineCompositionSetups,
  createClipMotionSetup,
  type ClipMotion2D,
  type CompositionSetup,
} from "framediff";
import initialDocument from "../compositions/HeroRaw.comp.json";

type NumericRecord = Record<string, number | string | boolean | undefined>;
export type HeroRawDocument = typeof initialDocument;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function motionOf(row: NumericRecord): ClipMotion2D {
  const path = Array.from({ length: 5 }, (_, index) => {
    const frame = row[`path${index}Frame`];
    const x = row[`path${index}X`];
    const y = row[`path${index}Y`];
    return typeof frame === "number" && typeof x === "number" && typeof y === "number"
      ? { frame, position: [x, y] as [number, number] }
      : null;
  }).filter((point): point is NonNullable<typeof point> => point != null);
  return {
    anchor: [Number(row.anchorX), Number(row.anchorY)],
    sourceSize: [Number(row.sourceWidth), Number(row.sourceHeight)],
    startFrame: Number(row.startFrame),
    endFrame: Number(row.endFrame),
    startPosition: [Number(row.startX), Number(row.startY)],
    endPosition: [Number(row.endX), Number(row.endY)],
    startScale: Number(row.startScale),
    endScale: Number(row.endScale),
    interpolation: row.interpolation === "smooth" ? "smooth" : "linear",
    ...(path.length ? { path } : {}),
  };
}

export const heroMotionRows = new Map<string, ClipMotion2D>();

function updateMotionRows(document: HeroRawDocument): void {
  heroMotionRows.clear();
  for (const [key, row] of Object.entries(document.motion)) {
    heroMotionRows.set(key, motionOf(row as NumericRecord));
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

const heroAudioFadeSetup: CompositionSetup = ({ root, document, onFrame, onDocument, onCleanup }) => {
  let settings = (document as HeroRawDocument).audio.bed;
  const stopDocument = onDocument((next) => {
    settings = (next as HeroRawDocument).audio.bed;
  });
  const stopFrame = onFrame(({ frame }) => {
    const audio = root.querySelector<HTMLAudioElement>("[data-fd-id=music-bed]");
    if (!audio) return;
    const progress = clamp((frame - settings.fadeFrom) / Math.max(1e-6, settings.fadeTo - settings.fadeFrom));
    const volume = settings.volume * (1 - progress);
    audio.dataset.framediffVolume = String(volume);
    audio.volume = volume;
  });
  onCleanup(stopDocument);
  onCleanup(stopFrame);
};

export const heroMotionSetup = combineCompositionSetups(heroClipMotionSetup, heroAudioFadeSetup);
