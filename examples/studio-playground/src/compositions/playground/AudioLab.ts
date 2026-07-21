import { createAudioFadeOutSetup, defineComposition } from "framediff";
import source from "./AudioLab.html?raw";

export const audioLabComp = defineComposition(source, {
  setup: createAudioFadeOutSetup({ selector: "[data-fd-id=audio-bed]", from: 150, to: 239, volume: 0.16 }),
});
