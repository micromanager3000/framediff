import type { CompositionDescriptor } from "./types";

/** Resolve the stable registry key used by timeline documents, while retaining
 * compatibility with older compositions that stored the display id. */
export function compositionByReference(
  compositions: CompositionDescriptor[],
  reference: string,
): CompositionDescriptor | undefined {
  return compositions.find((composition) => composition.key === reference || composition.id === reference);
}
