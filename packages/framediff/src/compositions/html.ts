export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function htmlAttributes(attributes: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(attributes)
    .flatMap(([name, value]) => {
      if (value == null || value === false) return [];
      if (value === true) return [name];
      return [`${name}="${escapeHtml(String(value))}"`];
    })
    .join(" ");
}
