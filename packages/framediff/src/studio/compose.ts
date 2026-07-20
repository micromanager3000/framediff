// Stable source/module names for Studio-created HTML compositions.

export const pascalName = (s: string): string =>
  s
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");

export const kebabName = (s: string): string =>
  pascalName(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();

export const camelName = (s: string): string => {
  const p = pascalName(s);
  return p ? p[0].toLowerCase() + p.slice(1) : "";
};
