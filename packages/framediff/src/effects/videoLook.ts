import type { CompositionSetup } from "../composition";
import type { GradeParams } from "./grade";
import { applyGradeDataAttributes } from "./gradeAttributes";
import type { LUT3D } from "./lut";

export interface VideoLook {
  grade?: GradeParams;
  lut?: "gold" | LUT3D;
  lutIntensity?: number;
  lutName?: string;
}

export interface NamedVideoLookSetupOptions {
  /** Attribute carrying the project-owned look key. Defaults to `data-fd-look`. */
  keyAttribute?: string;
  selector?: string;
  load?: () => void | Promise<void>;
  lookFor: (key: string, element: HTMLElement) => VideoLook | undefined | Promise<VideoLook | undefined>;
}

/** Resolve a look key from an effect canvas or its nearest owning look element. */
export function videoLookKey(element: Element, keyAttribute = "data-fd-look"): string | undefined {
  const owner = element.closest<HTMLElement>(`[${keyAttribute}]`) ?? element as HTMLElement;
  return owner.getAttribute(keyAttribute) ?? undefined;
}

/** Apply the serializable portion of a resolved look to authored effect attributes. */
export function applyVideoLook(element: Element, look: VideoLook | undefined): void {
  if (!look) return;
  applyGradeDataAttributes(element, look.grade);
  element.setAttribute("data-fd-lut-intensity", String(look.lut ? look.lutIntensity ?? 1 : 0));
  if (look.lutName) element.setAttribute("data-fd-lut-name", look.lutName);
}

/** Load and apply project-owned named looks before a renderer attaches to the composition. */
export function createNamedVideoLookSetup(options: NamedVideoLookSetupOptions): CompositionSetup {
  const keyAttribute = options.keyAttribute ?? "data-fd-look";
  return async ({ root }) => {
    await options.load?.();
    const selector = options.selector ?? `[${keyAttribute}]`;
    await Promise.all(Array.from(root.querySelectorAll<HTMLElement>(selector)).map(async (element) => {
      const key = videoLookKey(element, keyAttribute);
      if (!key) return;
      applyVideoLook(element, await options.lookFor(key, element));
    }));
  };
}
