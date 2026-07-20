import {
  combineCompositionSetups,
  createNamedVideoLookSetup,
  createGradeVideoSetup,
  gradeDataAttributes,
  videoLookKey,
  type GradeParams,
  type VideoLook,
} from "framediff";
import { HERO_FALLBACK_GRADE, heroShotLook } from "./heroGrade";
import { preloadLuts } from "./luts";

const GRADE_DEFAULTS: Required<Pick<GradeParams,
  "exposure" | "contrast" | "saturation" | "temperature" | "tint" | "highlights" | "shadows" | "vignette" | "bloom" | "bloomThreshold"
>> = {
  exposure: 0, contrast: 0, saturation: 1, temperature: 0, tint: 0,
  highlights: 0, shadows: 0, vignette: 0, bloom: 0, bloomThreshold: 0.6,
};

export function heroGradeAttributes(name: string): Record<string, string | number> {
  const grade = { ...GRADE_DEFAULTS, ...HERO_FALLBACK_GRADE };
  return {
    "data-fd-lut-key": name,
    "data-fd-lut-name": `fitted · ${name}`,
    "data-fd-lut-intensity": 0,
    ...gradeDataAttributes(grade),
  };
}

export const heroLutKey = (element: Element): string | undefined => videoLookKey(element, "data-fd-lut-key");

function resolvedHeroLook(key: string): VideoLook {
  const look = heroShotLook(key);
  return {
    ...look,
    grade: { ...GRADE_DEFAULTS, ...look.grade },
    lutName: `fitted · ${key}`,
  };
}

export const setupHeroLookData = createNamedVideoLookSetup({
  keyAttribute: "data-fd-lut-key",
  load: preloadLuts,
  lookFor: (key) => resolvedHeroLook(key),
});

export const heroGradeVideoSetup = createGradeVideoSetup({
  lutFor: (canvas) => {
    const key = heroLutKey(canvas);
    return key ? resolvedHeroLook(key).lut : undefined;
  },
});

export const setupHeroGrade = combineCompositionSetups(setupHeroLookData, heroGradeVideoSetup);
