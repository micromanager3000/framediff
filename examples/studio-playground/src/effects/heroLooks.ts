import {
  createGradeVideoSetup,
  videoLookKey,
  type GradeParams,
  type CompositionSetup,
  type VideoLook,
} from "framediff";
import { heroShotLook } from "./heroGrade";
import { preloadLuts } from "./luts";

const GRADE_DEFAULTS: Required<Pick<GradeParams,
  "exposure" | "contrast" | "saturation" | "temperature" | "tint" | "highlights" | "shadows" | "vignette" | "bloom" | "bloomThreshold"
>> = {
  exposure: 0, contrast: 0, saturation: 1, temperature: 0, tint: 0,
  highlights: 0, shadows: 0, vignette: 0, bloom: 0, bloomThreshold: 0.6,
};

export const heroLutKey = (element: Element): string | undefined => videoLookKey(element, "data-fd-lut-key");

function resolvedHeroLook(key: string): VideoLook {
  const look = heroShotLook(key);
  return {
    ...look,
    grade: { ...GRADE_DEFAULTS, ...look.grade },
    lutName: `fitted · ${key}`,
  };
}

/** Load fitted project LUTs without overriding JSON-authored scalar look controls. */
export const preloadHeroLutsSetup: CompositionSetup = async () => {
  await preloadLuts();
};

export const heroGradeVideoSetup = createGradeVideoSetup({
  lutFor: (canvas) => {
    const key = heroLutKey(canvas);
    return key ? resolvedHeroLook(key).lut : undefined;
  },
});
