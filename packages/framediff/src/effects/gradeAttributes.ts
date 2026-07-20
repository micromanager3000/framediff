import type { GradeParams } from "./grade";

const kebabCase = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** Convert typed grade values to the authored HTML ABI used by preview, Studio, and export. */
export function gradeDataAttributes(grade: GradeParams | undefined): Record<string, number> {
  if (!grade) return {};
  return Object.fromEntries(Object.entries(grade).flatMap(([name, value]) =>
    typeof value === "number" ? [[`data-fd-grade-${kebabCase(name)}`, value]] : [],
  ));
}

export function applyGradeDataAttributes(element: Element, grade: GradeParams | undefined): void {
  for (const [name, value] of Object.entries(gradeDataAttributes(grade))) {
    element.setAttribute(name, String(value));
  }
}
