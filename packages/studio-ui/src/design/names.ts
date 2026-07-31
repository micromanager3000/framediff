/**
 * Composition names, truncated so they stay distinguishable.
 *
 * The rail and the breadcrumb both had to shrink names to fit, and both used plain end-truncation
 * with `text-overflow: ellipsis`. In a project that names variants by suffix — `HeroPlane3D.june3d`,
 * `HeroPlane3D.wide`, `HeroPlane3D.closeup` — that collapsed four different compositions into four
 * identical `HeroPla…` rows. The one part of the name that identifies which is which was the exact
 * part being thrown away.
 *
 * The fix is a split rather than a character budget: the variant suffix is rendered as its own
 * inline element that cannot shrink, and the stem takes all the truncation. CSS then handles
 * every width for free, so nothing here has to guess how many characters fit.
 */

export type SplitName = {
  /** The shrinkable part. */
  stem: string;
  /** The part that must survive truncation. Empty when the name has no variant suffix. */
  suffix: string;
};

/**
 * Split a composition id at its variant suffix.
 *
 * Only a short, final, dot-separated segment counts. A name with no dot (`AuthoringChapter`) has
 * nothing worth protecting and truncates normally — pinning an arbitrary tail like `…hapter` would
 * be noise, not information.
 */
export function splitVariantName(name: string): SplitName {
  const dot = name.lastIndexOf(".");
  // A leading dot is not a suffix, and a "suffix" that is most of the name is just a name.
  if (dot <= 0 || dot === name.length - 1) return { stem: name, suffix: "" };
  const suffix = name.slice(dot);
  if (suffix.length > 12 || suffix.length >= name.length / 2) return { stem: name, suffix: "" };
  return { stem: name.slice(0, dot), suffix };
}
