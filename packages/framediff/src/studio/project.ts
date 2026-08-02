import type { StudioGuideDescriptor } from "@framediff/studio-model";
import type { CompRegistry, StudioComposition } from "./types";

/**
 * A project is the unit the Studio actually opens: a registry of compositions plus the
 * project-level surfaces that belong to the whole thing rather than to any one composition.
 *
 * The guide is the first of those. It used to ride along on a composition's `meta`, which meant
 * the Studio had to guess which composition owned it and a project could accidentally declare
 * two. A project declares one, here, where it reads as what it is.
 */
export interface StudioProject {
  compositions: CompRegistry;
  /** The project's walkthrough. Build it with `defineProjectGuide`. */
  guide?: StudioGuideDescriptor;
}

/** Identity, for the types and for the shape to have a name at the call site. */
export function defineStudioProject(project: StudioProject): StudioProject {
  return project;
}

/**
 * Accept either form wherever a project is expected. A bare registry stays valid — most examples
 * declare nothing beyond their compositions, and there is no reason to make them wrap it.
 */
export function toStudioProject(source: CompRegistry | StudioProject): StudioProject {
  const candidate = (source as StudioProject).compositions;
  // A composition registered under the key "compositions" is the one thing that could look like a
  // project by accident; a composition always carries a duration, and a registry never does.
  const isRegistryEntry = !!candidate && "durationInFrames" in (candidate as unknown as StudioComposition);
  if (!candidate || isRegistryEntry) return { compositions: source as CompRegistry };
  return source as StudioProject;
}
