import {
  defineVideoPlane3DComposition,
  cameraKeyframesFromProgress,
  type CameraInterpolation,
  type StudioComposition,
  type VirtualCameraPose,
} from "framediff";
import { FPS } from "../data/constants";
import { AE_PLANE_CAMERA_MOVES } from "../data/heroAep.gen";
import { HERO_SHOTS } from "../data/heroEdl";
import { heroShotLook } from "../effects/heroGrade";
import {
  heroGradeAttributes,
  heroLutKey,
  setupHeroLookData,
} from "../effects/heroLooks";
import { heroBackdrop } from "./HeroRaw";

type PlaneCameraMove = (typeof AE_PLANE_CAMERA_MOVES)[number];
const FIT_PROGRESS: Record<string, Array<[number, number]>> = {
  uizoom: [[0, 0], [0.07, 0], [0.14, 0.015], [0.211, 0.04], [0.281, 0.085], [0.351, 0.15], [0.421, 0.24], [0.491, 0.355], [0.561, 0.505], [0.632, 0.66], [0.702, 0.795], [0.772, 0.895], [0.842, 0.96], [0.912, 0.99], [0.947, 1], [1, 1]],
};
const FIT_APERTURE: Record<string, Array<[number, number]>> = {
  uizoom: [[0, 0], [0.2, 0.95], [0.421, 0.75], [0.561, 0.89], [0.702, 0.92], [0.842, 0.98], [1, 1]],
};
const FIT_CAMERA_EASE: Record<string, [number, number]> = {};
const FIT_CAMERA_INTERPOLATION: Record<string, CameraInterpolation> = {};

const radians = (value: number) => value * Math.PI / 180;

function cameraPose(move: PlaneCameraMove, end: boolean): VirtualCameraPose {
  const prefix = end ? "end" : "start";
  const row = move as unknown as Record<string, number>;
  return {
    cameraPosition: [row[`${prefix}CameraX`], row[`${prefix}CameraY`], row[`${prefix}CameraZ`]],
    cameraTarget: [row[`${prefix}TargetX`], row[`${prefix}TargetY`], row[`${prefix}TargetZ`]],
    focalLength: row[`${prefix}FocalLength`],
    focusDistance: row[`${prefix}FocusDistance`] || undefined,
    focusPosition: [row[`${prefix}FocusX`], row[`${prefix}FocusY`], row[`${prefix}FocusZ`]],
    depthOfField: row[`${prefix}DepthOfField`],
  };
}

export const heroPlaneShotComps: Record<string, StudioComposition> = Object.fromEntries(
  HERO_SHOTS.filter((shot) => shot.fx === "plane3d").map((shot) => {
    const move = AE_PLANE_CAMERA_MOVES.find((candidate) => candidate.name === shot.name)!;
    const id = `HeroPlane3D.${shot.name}`;
    const composition = defineVideoPlane3DComposition({
      id,
      name: shot.name,
      clipId: `plane-${shot.name}`,
      src: shot.src,
      width: 1920,
      height: 1080,
      fps: FPS,
      durationInFrames: shot.durationInFrames,
      trimStart: shot.trimStart,
      playbackRate: shot.playbackRate,
      background: heroBackdrop,
      canvasAttributes: heroGradeAttributes(shot.name),
      setup: setupHeroLookData,
      effect: {
        cameraKeyframes: cameraKeyframesFromProgress({
          from: cameraPose(move, false),
          to: cameraPose(move, true),
          startFrame: move.startFrame,
          endFrame: move.endFrame,
          progress: FIT_PROGRESS[move.name],
          depthOfFieldProgress: FIT_APERTURE[move.name],
          ease: FIT_CAMERA_EASE[move.name],
        }),
        cameraInterpolation: FIT_PROGRESS[move.name] ? "monotone" : FIT_CAMERA_INTERPOLATION[move.name] ?? "ease",
        planeSize: [move.planeW * move.planeScale, move.planeH * move.planeScale],
        planePosition: [move.planeX, move.planeY, move.planeZ],
        planeRotation: [radians(move.planeRotXDeg), radians(move.planeRotYDeg), radians(move.planeRotZDeg)],
        maxBlur: move.maxBlur,
        dofModel: "thinLens",
        motionBlur: { shutterAngle: move.shutterAngle, samples: move.motionBlurSamples },
        lutFor: (canvas) => {
          const key = heroLutKey(canvas);
          return key ? heroShotLook(key).lut : undefined;
        },
      },
      meta: {
        file: "src/compositions/HeroPlane3D.ts",
        library: true,
        deps: ["src/data/heroAep.gen.ts", "src/data/heroEdl.ts", "src/effects/heroLooks.ts", "src/effects/heroGrade.ts", "src/effects/luts.ts"],
      },
    }) as StudioComposition;
    composition.meta = {
      ...composition.meta,
      editableData: [{ type: "camera3d", file: "src/data/heroAep.gen.ts", exportName: "AE_PLANE_CAMERA_MOVES", title: "3D CAMERA + PLANE" }],
    };
    return [id, composition];
  }),
);
