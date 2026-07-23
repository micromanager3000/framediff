// Legacy recipe → TypeScript source support. New recipes keep mutable values in `.gen.json`;
// these literal helpers remain for projects that have not migrated yet.

import type { GenRecipe } from "../generative";
import { genModelOf, genParamValue } from "../genModels";

const q = (s: string) =>
  `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

const lit = (v: unknown): string =>
  typeof v === "string" ? q(v) : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);

/** The object body for `generative({ ... })` — canonical field order, def-driven params.
 *  Params the model doesn't know are dropped on purpose (switching models prunes the
 *  literals that no longer mean anything); `take` always survives, last. */
export function serializeRecipeBody(recipe: GenRecipe): string {
  const def = genModelOf(recipe);
  const lines: string[] = [];
  lines.push(`  id: ${q(recipe.id)},`);
  if (recipe.file) lines.push(`  file: ${q(recipe.file)},`);
  lines.push(`  provider: ${q(recipe.provider ?? "fal")},`);
  lines.push(`  model: ${q(recipe.model ?? def.id)},`);
  lines.push(`  prompt: ${q(recipe.prompt)},`);
  if (def.negativePrompt && recipe.negativePrompt != null)
    lines.push(`  negativePrompt: ${q(recipe.negativePrompt)},`);
  const refs = recipe.refs ?? [];
  if (refs.length === 1) {
    lines.push(`  refs: [{ kind: ${q(refs[0].kind)}, src: ${q(refs[0].src)} }],`);
  } else if (refs.length > 1) {
    lines.push(`  refs: [`);
    for (const r of refs) lines.push(`    { kind: ${q(r.kind)}, src: ${q(r.src)} },`);
    lines.push(`  ],`);
  }
  for (const p of def.params) {
    const v = (recipe as unknown as Record<string, unknown>)[p.key];
    lines.push(`  ${p.key}: ${lit(v ?? p.def)},`);
  }
  if (recipe.fps != null) lines.push(`  fps: ${recipe.fps},`);
  lines.push(`  take: ${recipe.take ?? 0},`);
  return lines.join("\n");
}

/** Replace the single `generative({ ... })` call's object body in a .gen.ts.
 *  Returns the new file text and the offset of the rewritten span (for the CODE flash),
 *  or null when the file doesn't contain exactly one well-bracketed call. */
export function rewriteRecipeSource(
  fileText: string,
  recipe: GenRecipe,
): { text: string; at: number } | null {
  const open = fileText.indexOf("generative({");
  if (open < 0 || fileText.indexOf("generative({", open + 1) >= 0) return null;
  const bodyStart = open + "generative({".length;
  // walk to the matching close brace, string-aware (prompts contain braces)
  let depth = 1;
  let i = bodyStart;
  let str: string | null = null;
  for (; i < fileText.length && depth > 0; i++) {
    const c = fileText[i];
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
    } else if (c === '"' || c === "'" || c === "`") str = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
  }
  if (depth !== 0) return null;
  const bodyEnd = i - 1; // index of the closing '}'
  const text = `${fileText.slice(0, bodyStart)}\n${serializeRecipeBody(recipe)}\n${fileText.slice(bodyEnd)}`;
  return { text, at: bodyStart };
}

/** A recipe value with one field replaced — helper for single-gesture edits. */
export function withRecipe(recipe: GenRecipe, patch: Partial<GenRecipe>): GenRecipe {
  return { ...recipe, ...patch };
}

/** Switching models: keep identity + prompt + refs + take; carry over param values the
 *  next model also understands (matching key), drop the rest; drop refs the model
 *  refuses (caller should toast what got dropped). */
export function remapRecipeForModel(recipe: GenRecipe, modelId: string): { next: GenRecipe; droppedRefs: string[] } {
  const nextDef = genModelOf({ model: modelId });
  const curDef = genModelOf(recipe);
  const next: GenRecipe = {
    id: recipe.id,
    file: recipe.file,
    dataFile: recipe.dataFile,
    provider: nextDef.provider ?? "fal",
    model: modelId,
    prompt: recipe.prompt,
    take: recipe.take ?? 0,
    fps: recipe.fps,
  };
  if (nextDef.negativePrompt && recipe.negativePrompt) next.negativePrompt = recipe.negativePrompt;
  for (const p of nextDef.params) {
    const cur = curDef.params.find((x) => x.key === p.key);
    const v = (recipe as unknown as Record<string, unknown>)[p.key];
    // carry only values the old model also expressed AND the new model's options allow
    const allowed =
      v != null &&
      cur != null &&
      (p.type === "number"
        ? typeof v === "number" && (p.min == null || v >= p.min) && (p.max == null || v <= p.max)
        : (p.options ?? []).some((o) => o === v));
    (next as unknown as Record<string, unknown>)[p.key] = allowed ? v : p.def;
  }
  const droppedRefs: string[] = [];
  const counts = new Map<string, number>();
  const keep = (recipe.refs ?? []).filter((r) => {
    const count = counts.get(r.kind) ?? 0;
    const max = nextDef.maxRefs?.[r.kind];
    if (!nextDef.accepts[r.kind] || (max != null && count >= max)) {
      droppedRefs.push(r.src);
      return false;
    }
    counts.set(r.kind, count + 1);
    return true;
  });
  if (keep.length) next.refs = keep;
  return { next, droppedRefs };
}
