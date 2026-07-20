import {
  combineCompositionSetups,
  createGradeVideoSetup,
  createVideoPlane3DSetup,
} from "framediff";

const gradeSetup = createGradeVideoSetup({ lut: "gold" });
const planeSetup = createVideoPlane3DSetup({
  lut: "gold",
  cameraFrom: {
    cameraPosition: [0, 0, 1.086],
    cameraTarget: [0, 0, 0],
    focalLength: 29,
    depthOfField: 0,
  },
  cameraTo: {
    cameraPosition: [0.16, 0.06, 1.66],
    cameraTarget: [0, 0, 0],
    focalLength: 27,
    depthOfField: 0.035,
  },
});

/** Project preset: the shared package effects configured for the LightTwist reel. */
export const lightTwistFinishSetup = combineCompositionSetups(gradeSetup, planeSetup);
