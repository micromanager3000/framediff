import type { InspectorFieldSnapshot } from "@framediff/studio-model";

type JsonSchema = {
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  type?: string;
  title?: string;
  description?: string;
  format?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  [key: string]: unknown;
};

const decodePointerPart = (part: string): string => part.replaceAll("~1", "/").replaceAll("~0", "~");
const encodePointerPart = (part: string): string => part.replaceAll("~", "~0").replaceAll("/", "~1");
const pointerParts = (pointer: string): string[] => pointer === "" ? [] : pointer.split("/").slice(1).map(decodePointerPart);

export function jsonPointerValue(root: unknown, pointer: string): unknown {
  let value = root;
  for (const part of pointerParts(pointer)) {
    if (value == null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function setJsonPointerValue(root: unknown, pointer: string, value: unknown): boolean {
  const parts = pointerParts(pointer);
  if (!parts.length || root == null || typeof root !== "object") return false;
  let owner = root as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const next = owner[part];
    if (next == null || typeof next !== "object") return false;
    owner = next as Record<string, unknown>;
  }
  owner[parts.at(-1)!] = value;
  return true;
}

function resolvedSchema(root: JsonSchema | undefined, schema: JsonSchema | undefined, seen = new Set<string>()): JsonSchema | undefined {
  const ref = schema?.$ref;
  if (!root || !schema || !ref?.startsWith("#/") || seen.has(ref)) return schema;
  seen.add(ref);
  const target = jsonPointerValue(root, ref.slice(1)) as JsonSchema | undefined;
  const resolved = resolvedSchema(root, target, seen);
  return resolved ? { ...resolved, ...schema, $ref: undefined } : schema;
}

function schemaAtPointer(schema: JsonSchema | undefined, pointer: string): JsonSchema | undefined {
  let current = resolvedSchema(schema, schema);
  for (const part of pointerParts(pointer)) {
    current = resolvedSchema(schema, /^\d+$/.test(part) ? current?.items : current?.properties?.[part]);
  }
  return current;
}

function titleOf(key: string, schema: JsonSchema): string {
  return schema.title ?? key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function fieldOf(file: string, pointer: string, key: string, value: unknown, schema: JsonSchema): InspectorFieldSnapshot | null {
  const id = `json:${encodeURIComponent(file)}:${encodeURIComponent(pointer)}`;
  const label = titleOf(key, schema);
  const source = `${file} · ${pointer}`;
  if (schema.enum?.length && typeof value === "string") {
    return {
      id, label, text: value, valueType: "text", editable: true, source,
      control: { type: "select", value, options: schema.enum.map((entry) => ({ value: String(entry), label: String(entry) })) },
    };
  }
  if ((schema.type === "number" || schema.type === "integer" || typeof value === "number") && typeof value === "number") {
    return {
      id, label, value, valueType: "number", editable: true, source, step: schema.multipleOf,
      control: {
        type: "number", value, min: schema.minimum, max: schema.maximum,
        step: schema.multipleOf ?? (schema.type === "integer" ? 1 : 0.01),
        slider: schema.minimum != null && schema.maximum != null,
      },
    };
  }
  if ((schema.type === "boolean" || typeof value === "boolean") && typeof value === "boolean") {
    return { id, label, boolean: value, valueType: "boolean", editable: true, source, control: { type: "boolean", value } };
  }
  if ((schema.type === "string" || typeof value === "string") && typeof value === "string") {
    if (schema.format === "color") return { id, label, text: value, valueType: "text", editable: true, source, control: { type: "color", value } };
    if (schema.format === "asset") {
      const accept = ["image", "video", "audio", "any"].includes(String(schema["x-accept"])) ? schema["x-accept"] as "image" | "video" | "audio" | "any" : "any";
      return { id, label, text: value, valueType: "text", editable: true, source, control: { type: "asset", value, accept } };
    }
    return { id, label, text: value, valueType: "text", editable: true, source, control: { type: "text", value, multiline: schema.format === "multiline" } };
  }
  return null;
}

/** JSON Schema primitives become ordinary Inspector controls; complex geometry stays custom UI. */
export function inspectorFieldsFromJsonDocument(
  file: string,
  document: unknown,
  schema: JsonSchema | undefined,
  basePointer: string,
): InspectorFieldSnapshot[] {
  const value = jsonPointerValue(document, basePointer);
  const baseSchema = schemaAtPointer(schema, basePointer);
  if (value == null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const childSchema = resolvedSchema(schema, baseSchema?.properties?.[key]) ?? {};
    const pointer = `${basePointer}/${encodePointerPart(key)}`;
    if (entry != null && typeof entry === "object" && !Array.isArray(entry)) {
      return inspectorFieldsFromJsonDocument(file, document, schema, pointer);
    }
    const field = fieldOf(file, pointer, key, entry, childSchema);
    return field ? [field] : [];
  });
}
