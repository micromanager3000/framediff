import { parse } from "@babel/parser";
import type {
  ArrayExpression,
  CallExpression,
  Expression,
  Node,
  ObjectExpression,
  ObjectProperty,
} from "@babel/types";
import type {
  CanonicalTweenKind,
  NormalizedTweenOperation,
  ParamBinding,
  PropertyAuthority,
  MotionPathSnapshot,
} from "@framediff/studio-model";
import { parseMotionPathSvg, tweenTracesEqual } from "@framediff/studio-model";

export type GsapLiteral = string | number | boolean;

export interface GsapSourceSpan {
  file?: string;
  start: number;
  end: number;
}

export interface GsapSourceDiagnostic {
  code: "parse" | "opaque" | "unstable-id" | "implicit-value" | "nondeterministic";
  severity: "info" | "warning" | "error";
  message: string;
  source?: GsapSourceSpan;
}

export interface GsapTimingSnapshot {
  frame: number;
  authority: "frames" | "seconds" | "implicit";
}

export interface GsapAnimationSnapshot extends NormalizedTweenOperation {
  id: string;
  bindings: Record<string, ParamBinding<GsapLiteral>>;
  authority: PropertyAuthority;
  editable: boolean;
  source: GsapSourceSpan;
  start: GsapTimingSnapshot;
  duration: GsapTimingSnapshot;
  motionPath?: MotionPathSnapshot;
}

export interface GsapSourceAnalysis {
  registered: boolean;
  operations: GsapAnimationSnapshot[];
  diagnostics: GsapSourceDiagnostic[];
  opaqueCallCount: number;
}

export interface AnalyzeGsapSourceOptions {
  fps: number;
  file?: string;
}

export type GsapAnimationMutation =
  | { type: "timing"; startFrame?: number; durationInFrames?: number }
  | { type: "upsert-key"; property: string; frame: number; value: GsapLiteral; ease?: string }
  | { type: "move-key"; property: string; frame: number; toFrame: number }
  | { type: "delete-key"; property: string; frame: number }
  | { type: "set-ease"; property: string; frame: number; ease?: string };

export interface RewriteGsapAnimationOptions extends AnalyzeGsapSourceOptions {
  animationId: string;
  mutation: GsapAnimationMutation;
}

export interface InsertGsapTweenOptions extends AnalyzeGsapSourceOptions {
  id: string;
  target: string;
  property: string;
  from: GsapLiteral;
  to: GsapLiteral;
  startFrame: number;
  durationInFrames: number;
  ease?: string;
}

export interface EnsureGsapTimelineOptions extends AnalyzeGsapSourceOptions {
  /** Named composition export whose composition factory call should receive the generated setup. */
  exportName?: string;
}

export interface RewriteGsapMotionPathOptions extends AnalyzeGsapSourceOptions {
  animationId: string;
  path: string;
  autoRotate?: boolean;
}

export type GsapSourceRewriteResult = { ok: true; text: string } | { ok: false; error: string };

export interface GsapUnrollGroupSource {
  id: string;
  timeline: string;
  source: GsapSourceSpan;
  staticallySafe: boolean;
  issues: string[];
}

export interface RewriteGsapUnrollOptions extends AnalyzeGsapSourceOptions {
  groupId: string;
  operations: NormalizedTweenOperation[];
}

export type GsapUnrollRewriteResult =
  | { ok: true; text: string; traceVerified: true }
  | { ok: false; error: string };

type JsonValue = GsapLiteral | null | JsonValue[] | { [key: string]: JsonValue };

const tweenKinds = new Set<CanonicalTweenKind>(["to", "from", "fromTo", "set"]);
const controlKeys = new Set([
  "duration", "ease", "id", "keyframes", "paused", "overwrite", "immediateRender",
  "repeat", "repeatDelay", "yoyo", "delay", "stagger", "onStart", "onUpdate", "onComplete",
  "onReverseComplete", "callbackScope",
]);
const unsupportedControlKeys = new Set(["repeat", "repeatDelay", "yoyo", "delay", "stagger", "overwrite", "immediateRender"]);

function spanOf(node: Node, file?: string): GsapSourceSpan {
  return { ...(file ? { file } : {}), start: node.start ?? 0, end: node.end ?? node.start ?? 0 };
}

function unwrap(expression: Expression | null | undefined): Expression | undefined {
  let current = expression;
  while (current && ["TSAsExpression", "TSTypeAssertion", "TSNonNullExpression", "TypeCastExpression"].includes(current.type)) {
    current = (current as unknown as { expression: Expression }).expression;
  }
  return current ?? undefined;
}

function literalOf(expression: Expression | null | undefined): JsonValue | undefined {
  const node = unwrap(expression);
  if (!node) return undefined;
  if (node.type === "StringLiteral" || node.type === "NumericLiteral" || node.type === "BooleanLiteral") return node.value;
  if (node.type === "NullLiteral") return null;
  if (node.type === "UnaryExpression" && ["-", "+"].includes(node.operator)) {
    const argument = literalOf(node.argument as Expression);
    if (typeof argument === "number") return node.operator === "-" ? -argument : argument;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? "";
  if (node.type === "ArrayExpression") {
    const values: JsonValue[] = [];
    for (const element of node.elements) {
      if (!element || element.type === "SpreadElement") return undefined;
      const value = literalOf(element as Expression);
      if (value === undefined) return undefined;
      values.push(value);
    }
    return values;
  }
  if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "frames") {
    const value = literalOf(node.arguments[0] && node.arguments[0].type !== "SpreadElement" ? node.arguments[0] as Expression : undefined);
    if (typeof value === "number" && Number.isInteger(value)) return { $frames: value };
  }
  if (node.type === "ObjectExpression") return objectOf(node);
  return undefined;
}

function propertyName(property: ObjectProperty): string | undefined {
  if (property.computed) {
    const value = literalOf(property.key as Expression);
    return typeof value === "string" ? value : undefined;
  }
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "StringLiteral" || property.key.type === "NumericLiteral") return String(property.key.value);
  return undefined;
}

function objectOf(node: ObjectExpression): Record<string, JsonValue> | undefined {
  const record: Record<string, JsonValue> = {};
  for (const property of node.properties) {
    if (property.type !== "ObjectProperty") return undefined;
    const name = propertyName(property);
    if (!name) return undefined;
    const value = literalOf(property.value as Expression);
    if (value === undefined) return undefined;
    record[name] = value;
  }
  return record;
}

function memberName(call: CallExpression): { owner: string; property: string } | undefined {
  const callee = unwrap(call.callee as Expression);
  if (!callee || (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression")) return undefined;
  if (callee.object.type !== "Identifier") return undefined;
  if (!callee.computed && callee.property.type === "Identifier") return { owner: callee.object.name, property: callee.property.name };
  const property = literalOf(callee.property as Expression);
  return typeof property === "string" ? { owner: callee.object.name, property } : undefined;
}

function walk(node: unknown, visitor: (node: Node) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visitor);
    return;
  }
  const candidate = node as Record<string, unknown>;
  if (typeof candidate.type !== "string") return;
  visitor(candidate as unknown as Node);
  for (const [key, child] of Object.entries(candidate)) {
    if (["loc", "start", "end", "extra", "errors", "comments", "tokens"].includes(key)) continue;
    walk(child, visitor);
  }
}

/**
 * Give a normal authored composition module a writable registered timeline on first use.
 * This keeps gesture recording and stopwatches immediate: projects do not need to predict that
 * they will animate something and hand-write GSAP plumbing before opening Studio.
 */
export function ensureGsapTimelineSource(source: string, options: EnsureGsapTimelineOptions): GsapSourceRewriteResult {
  if (analyzeGsapSource(source, options).registered) return { ok: true, text: source };
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, { sourceType: "unambiguous", plugins: ["typescript", "jsx", "decorators-legacy"] });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const candidates: Array<{ call: CallExpression; statementStart: number; exportName?: string }> = [];
  for (const statement of ast.program.body) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations) {
      const init = unwrap(declarator.init as Expression | null | undefined);
      if (declarator.id.type !== "Identifier" || init?.type !== "CallExpression"
        || init.callee.type !== "Identifier" || !["defineComposition", "defineCodeScene"].includes(init.callee.name)) continue;
      candidates.push({ call: init, statementStart: statement.start ?? 0, exportName: declarator.id.name });
    }
  }
  const target = options.exportName
    ? candidates.find((candidate) => candidate.exportName === options.exportName)
    : candidates.length === 1 ? candidates[0] : undefined;
  if (!target) {
    return {
      ok: false,
      error: options.exportName
        ? `Could not find a FrameDiff composition factory for export "${options.exportName}" in this module.`
        : "This module has multiple compositions; declare data-fd-export so Studio can attach the recorded motion to the right one.",
    };
  }

  const uniqueName = (base: string): string => {
    let name = base;
    let suffix = 2;
    while (new RegExp(`\\b${name}\\b`).test(source)) name = `${base}${suffix++}`;
    return name;
  };
  const setupName = uniqueName("framediffRecordedMotionSetup");
  const edits: Array<{ start: number; end: number; text: string }> = [];
  let combinesSetups = false;
  const optionsArgument = target.call.arguments[1];
  if (!optionsArgument) {
    const insertion = (target.call.end ?? 1) - 1;
    edits.push({ start: insertion, end: insertion, text: `, { setup: ${setupName} }` });
  } else {
    const compositionOptions = optionsArgument.type === "SpreadElement" ? undefined : unwrap(optionsArgument as Expression);
    if (compositionOptions?.type !== "ObjectExpression") {
      return { ok: false, error: "The composition options must be an object literal before Studio can attach recorded motion." };
    }
    const setupProperty = compositionOptions.properties.find((property) =>
      property.type === "ObjectProperty" && propertyName(property) === "setup",
    );
    if (!setupProperty) {
      const insertion = (compositionOptions.start ?? 0) + 1;
      edits.push({ start: insertion, end: insertion, text: ` setup: ${setupName},` });
    } else if (setupProperty.type === "ObjectProperty" && setupProperty.value.start != null && setupProperty.value.end != null) {
      combinesSetups = true;
      const existing = source.slice(setupProperty.value.start, setupProperty.value.end);
      if (setupProperty.shorthand && setupProperty.start != null && setupProperty.end != null) {
        edits.push({
          start: setupProperty.start,
          end: setupProperty.end,
          text: `setup: combineCompositionSetups(${existing}, ${setupName})`,
        });
      } else {
        edits.push({
          start: setupProperty.value.start,
          end: setupProperty.value.end,
          text: `combineCompositionSetups(${existing}, ${setupName})`,
        });
      }
    } else {
      return { ok: false, error: "Studio cannot safely combine recorded motion with this setup declaration." };
    }
  }

  const registration = `const ${setupName} = defineGsapTimeline(({ gsap, frames }) => {\n`
    + `  const timeline = gsap.timeline({ paused: true });\n`
    + `  return timeline;\n`
    + `});\n\n`;
  edits.push({ start: target.statementStart, end: target.statementStart, text: registration });
  let text = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }

  const imports: string[] = [];
  const hasLocalNamedImport = (module: string, name: string): boolean => ast.program.body.some((statement) =>
    statement.type === "ImportDeclaration" && statement.source.value === module
    && statement.specifiers.some((specifier) => specifier.type === "ImportSpecifier"
      && specifier.imported.type === "Identifier" && specifier.imported.name === name
      && specifier.local.name === name),
  );
  if (!hasLocalNamedImport("framediff/gsap", "defineGsapTimeline")) {
    imports.push('import { defineGsapTimeline } from "framediff/gsap";');
  }
  if (combinesSetups && !hasLocalNamedImport("framediff", "combineCompositionSetups")) {
    imports.push('import { combineCompositionSetups } from "framediff";');
  }
  return { ok: true, text: imports.length ? `${imports.join("\n")}\n${text}` : text };
}

function timingOf(
  expression: Expression | null | undefined,
  fps: number,
): GsapTimingSnapshot | undefined {
  const node = unwrap(expression);
  if (!node) return undefined;
  const numeric = literalOf(node);
  if (typeof numeric === "number" && Number.isFinite(numeric)) {
    return { frame: Math.round(numeric * fps), authority: "seconds" };
  }
  if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "frames") {
    const value = literalOf(node.arguments[0] && node.arguments[0].type !== "SpreadElement" ? node.arguments[0] as Expression : undefined);
    if (typeof value === "number" && Number.isInteger(value)) return { frame: value, authority: "frames" };
  }
  return undefined;
}

function literalRecord(value: Record<string, JsonValue> | undefined): Record<string, GsapLiteral> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(
    (entry): entry is [string, GsapLiteral] => !controlKeys.has(entry[0]) && ["string", "number", "boolean"].includes(typeof entry[1]),
  ));
}

function keyframeBindings(
  keyframes: JsonValue[],
  startFrame: number,
  fps: number,
): { bindings: Record<string, ParamBinding<GsapLiteral>>; durationInFrames: number; frameAuthored: boolean } {
  const propertyKeys = new Set<string>();
  const rows = keyframes.filter((entry): entry is Record<string, JsonValue> => !!entry && !Array.isArray(entry) && typeof entry === "object");
  for (const row of rows) for (const key of Object.keys(row)) if (!controlKeys.has(key)) propertyKeys.add(key);
  const bindings: Record<string, ParamBinding<GsapLiteral>> = {};
  const keysByProperty = Object.fromEntries([...propertyKeys].map((key) => [key, [] as { frame: number; value: GsapLiteral; ease?: string }[]]));
  let cursor = startFrame;
  let frameAuthored = true;
  for (const row of rows) {
    const rawDuration = row.duration;
    const duration = typeof rawDuration === "number"
      ? { frame: Math.round(rawDuration * fps), authority: "seconds" as const }
      : rawDuration && !Array.isArray(rawDuration) && typeof rawDuration === "object" && typeof rawDuration.$frames === "number"
        ? { frame: rawDuration.$frames, authority: "frames" as const }
        : undefined;
    cursor += Math.max(0, duration?.frame ?? 0);
    if (duration?.authority !== "frames") frameAuthored = false;
    for (const property of propertyKeys) {
      const value = row[property];
      if (["string", "number", "boolean"].includes(typeof value)) {
        const ease = typeof row.ease === "string" ? row.ease : undefined;
        keysByProperty[property].push({ frame: cursor, value: value as GsapLiteral, ...(ease ? { ease } : {}) });
      }
    }
  }
  for (const property of propertyKeys) bindings[property] = { kind: "keyframes", keys: keysByProperty[property] };
  return { bindings, durationInFrames: Math.max(0, cursor - startFrame), frameAuthored };
}

function bindingsFor(
  kind: CanonicalTweenKind,
  from: Record<string, GsapLiteral>,
  to: Record<string, GsapLiteral>,
  startFrame: number,
  durationInFrames: number,
  ease?: string,
): Record<string, ParamBinding<GsapLiteral>> {
  const bindings: Record<string, ParamBinding<GsapLiteral>> = {};
  for (const property of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const fromValue = from[property];
    const toValue = to[property];
    if (kind === "set" && toValue !== undefined) {
      bindings[property] = { kind: "const", value: toValue };
      continue;
    }
    const keys = [] as { frame: number; value: GsapLiteral; ease?: string }[];
    if (fromValue !== undefined) keys.push({ frame: startFrame, value: fromValue });
    if (toValue !== undefined) keys.push({ frame: startFrame + durationInFrames, value: toValue, ...(ease ? { ease } : {}) });
    if (keys.length) bindings[property] = { kind: "keyframes", keys };
  }
  return bindings;
}

function argumentExpression(call: CallExpression, index: number): Expression | undefined {
  const argument = call.arguments[index];
  return argument && argument.type !== "SpreadElement" && argument.type !== "ArgumentPlaceholder"
    ? argument as Expression
    : undefined;
}

/** Parse registered FrameDiff GSAP source without executing project code. */
export function analyzeGsapSource(source: string, options: AnalyzeGsapSourceOptions): GsapSourceAnalysis {
  const diagnostics: GsapSourceDiagnostic[] = [];
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      errorRecovery: false,
      plugins: ["typescript", "jsx", "decorators-legacy"],
    });
  } catch (error) {
    diagnostics.push({ code: "parse", severity: "error", message: error instanceof Error ? error.message : String(error) });
    return { registered: false, operations: [], diagnostics, opaqueCallCount: 0 };
  }

  const registrations: CallExpression[] = [];
  walk(ast.program, (node) => {
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "defineGsapTimeline") {
      registrations.push(node);
    }
  });
  if (!registrations.length) return { registered: false, operations: [], diagnostics, opaqueCallCount: 0 };

  const operations: GsapAnimationSnapshot[] = [];
  let opaqueCallCount = 0;
  for (const registration of registrations) {
    const factory = argumentExpression(registration, 0);
    if (!factory || (factory.type !== "ArrowFunctionExpression" && factory.type !== "FunctionExpression")) {
      diagnostics.push({ code: "opaque", severity: "warning", message: "Registered GSAP timeline factory is not an inline function.", source: spanOf(registration, options.file) });
      opaqueCallCount += 1;
      continue;
    }

    walk(factory.body, (node) => {
      if (node.type !== "CallExpression") return;
      const member = memberName(node);
      if (member?.owner === "Math" && member.property === "random"
        || member?.owner === "Date" && member.property === "now"
        || member?.owner === "performance" && member.property === "now"
        || member?.owner === "gsap" && member.property === "ticker") {
        diagnostics.push({
          code: "nondeterministic",
          severity: "warning",
          message: `${member.owner}.${member.property} is outside the deterministic registered subset.`,
          source: spanOf(node, options.file),
        });
      }
    });

    const timelineNames = new Set<string>();
    walk(factory.body, (node) => {
      if (node.type !== "VariableDeclarator" || node.id.type !== "Identifier" || !node.init || node.init.type !== "CallExpression") return;
      const member = memberName(node.init);
      if (member?.property === "timeline") timelineNames.add(node.id.name);
    });

    const calls: CallExpression[] = [];
    walk(factory.body, (node) => {
      if (node.type !== "CallExpression") return;
      const member = memberName(node);
      if (member && timelineNames.has(member.owner) && member.property !== "timeline") calls.push(node);
    });
    calls.sort((left, right) => (left.start ?? 0) - (right.start ?? 0));

    let cursor = 0;
    for (const call of calls) {
      const member = memberName(call)!;
      if (!tweenKinds.has(member.property as CanonicalTweenKind)) {
        opaqueCallCount += 1;
        diagnostics.push({ code: "opaque", severity: "info", message: `timeline.${member.property}() remains valid but is not Studio-editable.`, source: spanOf(call, options.file) });
        continue;
      }
      const kind = member.property as CanonicalTweenKind;
      const target = literalOf(argumentExpression(call, 0));
      const fromIndex = kind === "fromTo" ? 1 : -1;
      const toIndex = kind === "fromTo" ? 2 : 1;
      const positionIndex = kind === "fromTo" ? 3 : 2;
      const fromObject = fromIndex >= 0 ? literalOf(argumentExpression(call, fromIndex)) : undefined;
      const toObject = literalOf(argumentExpression(call, toIndex));
      if (typeof target !== "string" || !toObject || Array.isArray(toObject) || typeof toObject !== "object"
        || (fromIndex >= 0 && (!fromObject || Array.isArray(fromObject) || typeof fromObject !== "object"))) {
        opaqueCallCount += 1;
        diagnostics.push({ code: "opaque", severity: "warning", message: `timeline.${kind}() needs a literal target and literal vars to round-trip.`, source: spanOf(call, options.file) });
        continue;
      }

      const rawFrom = fromObject as Record<string, JsonValue> | undefined;
      const rawTo = toObject as Record<string, JsonValue>;
      const start = timingOf(argumentExpression(call, positionIndex), options.fps)
        ?? { frame: cursor, authority: "implicit" as const };
      const durationNode = kind === "fromTo" ? argumentExpression(call, 2) : argumentExpression(call, 1);
      let durationExpression: Expression | undefined;
      if (durationNode?.type === "ObjectExpression") {
        const property = durationNode.properties.find((entry): entry is ObjectProperty =>
          entry.type === "ObjectProperty" && propertyName(entry) === "duration",
        );
        if (property) durationExpression = property.value as Expression;
      }
      let duration = kind === "set"
        ? { frame: 0, authority: "frames" as const }
        : timingOf(durationExpression, options.fps) ?? { frame: 0, authority: "implicit" as const };
      const keyframes = Array.isArray(rawTo.keyframes) ? rawTo.keyframes : undefined;
      const rawMotionPath = rawTo.motionPath && !Array.isArray(rawTo.motionPath) && typeof rawTo.motionPath === "object"
        ? rawTo.motionPath as Record<string, JsonValue>
        : undefined;
      const pathSource = typeof rawMotionPath?.path === "string" ? rawMotionPath.path : undefined;
      const pathSegments = pathSource ? parseMotionPathSvg(pathSource) : null;
      const motionPath: MotionPathSnapshot | undefined = pathSource && pathSegments ? {
        path: pathSource,
        segments: pathSegments,
        autoRotate: rawMotionPath?.autoRotate === true,
      } : undefined;
      const from = literalRecord(kind === "from" ? rawTo : rawFrom);
      const to = literalRecord(kind === "from" ? undefined : rawTo);
      const ease = typeof rawTo.ease === "string" ? rawTo.ease : undefined;
      let bindings = bindingsFor(kind, from, to, start.frame, duration.frame, ease);
      let keyframesFrameAuthored = true;
      if (keyframes) {
        const projected = keyframeBindings(keyframes, start.frame, options.fps);
        bindings = projected.bindings;
        for (const [property, value] of Object.entries(from)) {
          const binding = bindings[property];
          const initial = { frame: start.frame, value };
          bindings[property] = binding?.kind === "keyframes"
            ? { kind: "keyframes", keys: [initial, ...binding.keys.filter((key) => key.frame !== start.frame)] }
            : { kind: "keyframes", keys: [initial] };
        }
        keyframesFrameAuthored = projected.frameAuthored;
        if (duration.authority === "implicit") duration = { frame: projected.durationInFrames, authority: "implicit" };
      }
      if (motionPath) {
        bindings = {
          x: { kind: "keyframes", keys: [
            { frame: start.frame, value: motionPath.segments[0].from.x },
            { frame: start.frame + duration.frame, value: motionPath.segments.at(-1)!.to.x, ...(ease ? { ease } : {}) },
          ] },
          y: { kind: "keyframes", keys: [
            { frame: start.frame, value: motionPath.segments[0].from.y },
            { frame: start.frame + duration.frame, value: motionPath.segments.at(-1)!.to.y, ...(ease ? { ease } : {}) },
          ] },
        };
      }
      const authoredId = typeof rawTo.id === "string" ? rawTo.id : undefined;
      const id = authoredId ?? `gsap@${call.start ?? operations.length}`;
      const completeValues = kind === "fromTo" || kind === "set" || !!keyframes || !!motionPath;
      const frameAuthored = start.authority !== "seconds" && duration.authority !== "seconds" && keyframesFrameAuthored;
      const callbacks = Object.keys(rawTo).some((key) => key.startsWith("on"));
      const unsupportedControls = Object.keys(rawTo).filter((key) => unsupportedControlKeys.has(key));
      const editable = !!authoredId && frameAuthored && completeValues && !callbacks && !unsupportedControls.length;
      if (!authoredId) diagnostics.push({ code: "unstable-id", severity: "info", message: `Add a literal id to timeline.${kind}() vars before editing it in Studio.`, source: spanOf(call, options.file) });
      if (!completeValues) diagnostics.push({ code: "implicit-value", severity: "info", message: `timeline.${kind}() depends on a computed current value; it is inspectable but not safely writable.`, source: spanOf(call, options.file) });
      if (callbacks) diagnostics.push({ code: "nondeterministic", severity: "warning", message: "Timeline callbacks are outside the side-effect-free editable subset.", source: spanOf(call, options.file) });
      if (unsupportedControls.length) diagnostics.push({ code: "opaque", severity: "info", message: `${unsupportedControls.join(", ")} timing remains valid at runtime but is outside the editable subset.`, source: spanOf(call, options.file) });

      operations.push({
        id,
        target,
        kind,
        startFrame: start.frame,
        durationInFrames: duration.frame,
        ...(Object.keys(from).length ? { from } : {}),
        to,
        ...(ease ? { ease } : {}),
        bindings,
        authority: editable ? "literal" : completeValues && !callbacks ? "computed" : "opaque",
        editable,
        source: spanOf(call, options.file),
        start,
        duration,
        ...(motionPath ? { motionPath } : {}),
      });
      cursor = Math.max(cursor, start.frame + duration.frame);
    }
  }

  return { registered: true, operations, diagnostics, opaqueCallCount };
}

type MutableKey = { frame: number; value: GsapLiteral; ease?: string };

function mutableBindings(animation: GsapAnimationSnapshot): Map<string, MutableKey[]> {
  const bindings = new Map<string, MutableKey[]>();
  for (const [property, binding] of Object.entries(animation.bindings)) {
    if (binding.kind === "keyframes") {
      bindings.set(property, binding.keys.map((key) => ({ frame: key.frame, value: key.value, ...(key.ease ? { ease: key.ease } : {}) })));
    } else if (binding.kind === "const") {
      bindings.set(property, [{ frame: animation.startFrame, value: binding.value }]);
    }
  }
  return bindings;
}

function sourceKey(key: string): string {
  return /^[$A-Z_a-z][$\w]*$/.test(key) ? key : JSON.stringify(key);
}

function sourceValue(value: GsapLiteral): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function renderCanonicalCall(
  owner: string,
  animation: GsapAnimationSnapshot,
  bindings: Map<string, MutableKey[]>,
  startFrame: number,
  indent: string,
): string {
  const frames = [...new Set([...bindings.values()].flatMap((keys) => keys.map((key) => key.frame)))].sort((left, right) => left - right);
  const firstFrame = frames[0] ?? startFrame;
  const initialProperties = [...bindings.entries()].flatMap(([property, keys]) => {
    const key = keys.find((candidate) => candidate.frame === firstFrame);
    return key ? [[property, key] as const] : [];
  });
  if (frames.length <= 1) {
    const values = initialProperties.map(([property, key]) => `${sourceKey(property)}: ${sourceValue(key.value)}`).join(", ");
    return `${owner}.set(${JSON.stringify(animation.target)}, { id: ${JSON.stringify(animation.id)}${values ? `, ${values}` : ""} }, frames(${startFrame}))`;
  }

  const from = initialProperties.map(([property, key]) => `${sourceKey(property)}: ${sourceValue(key.value)}`).join(", ");
  const rows: string[] = [];
  let previous = firstFrame;
  for (const frame of frames.slice(1)) {
    const properties = [...bindings.entries()].flatMap(([property, keys]) => {
      const key = keys.find((candidate) => candidate.frame === frame);
      return key ? [[property, key] as const] : [];
    });
    const values = properties.map(([property, key]) => `${sourceKey(property)}: ${sourceValue(key.value)}`);
    const ease = properties.map(([, key]) => key.ease).find((value): value is string => !!value);
    values.push(`duration: frames(${Math.max(0, frame - previous)})`);
    if (ease) values.push(`ease: ${JSON.stringify(ease)}`);
    rows.push(`${indent}    { ${values.join(", ")} }`);
    previous = frame;
  }
  return `${owner}.fromTo(\n${indent}  ${JSON.stringify(animation.target)},\n${indent}  { ${from} },\n${indent}  { id: ${JSON.stringify(animation.id)}, keyframes: [\n${rows.join(",\n")},\n${indent}  ] },\n${indent}  frames(${startFrame}),\n${indent})`;
}

/** Rewrite one registered animation as explicit frame-authored keys. */
export function rewriteGsapAnimationSource(source: string, options: RewriteGsapAnimationOptions): GsapSourceRewriteResult {
  const analysis = analyzeGsapSource(source, options);
  const animation = analysis.operations.find((entry) => entry.id === options.animationId);
  if (!animation) return { ok: false, error: `Registered animation "${options.animationId}" was not found.` };
  if (!animation.editable) return { ok: false, error: `Animation "${options.animationId}" is inspectable but not safely editable.` };
  const bindings = mutableBindings(animation);
  let startFrame = animation.startFrame;
  const mutation = options.mutation;
  if (mutation.type === "timing") {
    if (mutation.startFrame != null) {
      const delta = Math.round(mutation.startFrame) - startFrame;
      for (const keys of bindings.values()) for (const key of keys) key.frame += delta;
      startFrame += delta;
    }
    if (mutation.durationInFrames != null) {
      const nextDuration = Math.max(0, Math.round(mutation.durationInFrames));
      const currentDuration = Math.max(0, animation.durationInFrames);
      for (const keys of bindings.values()) for (const key of keys) {
        const relative = key.frame - startFrame;
        key.frame = startFrame + (currentDuration ? Math.round(relative / currentDuration * nextDuration) : 0);
      }
    }
  } else {
    const propertyKeys = bindings.get(mutation.property) ?? [];
    const frame = Math.round(mutation.frame);
    const index = propertyKeys.findIndex((key) => key.frame === frame);
    if (mutation.type === "upsert-key") {
      const next = { frame, value: mutation.value, ...(mutation.ease ? { ease: mutation.ease } : {}) };
      if (index >= 0) propertyKeys[index] = { ...propertyKeys[index], ...next };
      else propertyKeys.push(next);
      bindings.set(mutation.property, propertyKeys);
      startFrame = Math.min(startFrame, frame);
    } else {
      if (index < 0) return { ok: false, error: `No ${mutation.property} key exists at frame ${frame}.` };
      if (mutation.type === "move-key") propertyKeys[index].frame = Math.round(mutation.toFrame);
      else if (mutation.type === "delete-key") propertyKeys.splice(index, 1);
      else if (mutation.ease) propertyKeys[index].ease = mutation.ease;
      else delete propertyKeys[index].ease;
      if (propertyKeys.length) bindings.set(mutation.property, propertyKeys);
      else bindings.delete(mutation.property);
    }
  }
  if (!bindings.size) return { ok: false, error: "An animation must keep at least one keyed property." };
  for (const keys of bindings.values()) keys.sort((left, right) => left.frame - right.frame);
  const original = source.slice(animation.source.start, animation.source.end);
  const owner = original.match(/^\s*([$A-Z_a-z][$\w]*)\s*\./)?.[1];
  if (!owner) return { ok: false, error: "Could not resolve the registered timeline variable." };
  const lineStart = source.lastIndexOf("\n", animation.source.start - 1) + 1;
  const indent = source.slice(lineStart, animation.source.start).match(/^\s*/)?.[0] ?? "";
  const replacement = renderCanonicalCall(owner, animation, bindings, startFrame, indent);
  return { ok: true, text: source.slice(0, animation.source.start) + replacement + source.slice(animation.source.end) };
}

/** Add a stable literal fromTo tween immediately before a registered timeline is returned. */
export function insertGsapTweenSource(source: string, options: InsertGsapTweenOptions): GsapSourceRewriteResult {
  const analysis = analyzeGsapSource(source, options);
  if (!analysis.registered) return { ok: false, error: "This module has no inline defineGsapTimeline() registration." };
  if (analysis.operations.some((entry) => entry.id === options.id)) return { ok: false, error: `Animation id "${options.id}" already exists.` };
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, { sourceType: "unambiguous", plugins: ["typescript", "jsx", "decorators-legacy"] });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const returns: { node: Node; owner: string }[] = [];
  walk(ast.program, (node) => {
    if (node.type === "ReturnStatement" && node.argument?.type === "Identifier") returns.push({ node, owner: node.argument.name });
  });
  const returned = returns.find(({ owner }) => new RegExp(`\\b(?:const|let|var)\\s+${owner}\\s*=\\s*gsap\\.timeline\\s*\\(`).test(source));
  if (!returned || returned.node.start == null) return { ok: false, error: "Could not find the registered timeline return statement." };
  const lineStart = source.lastIndexOf("\n", returned.node.start - 1) + 1;
  const indent = source.slice(lineStart, returned.node.start).match(/^\s*/)?.[0] ?? "";
  const property = sourceKey(options.property);
  const call = `${indent}${returned.owner}.fromTo(\n`
    + `${indent}  ${JSON.stringify(options.target)},\n`
    + `${indent}  { ${property}: ${sourceValue(options.from)} },\n`
    + `${indent}  { id: ${JSON.stringify(options.id)}, ${property}: ${sourceValue(options.to)}, duration: frames(${Math.max(0, Math.round(options.durationInFrames))}), ease: ${JSON.stringify(options.ease ?? "power2.out")} },\n`
    + `${indent}  frames(${Math.round(options.startFrame)}),\n`
    + `${indent});\n`;
  return { ok: true, text: source.slice(0, lineStart) + call + source.slice(lineStart) };
}

/** Convert or update one registered animation as a literal GSAP cubic motion path. */
export function rewriteGsapMotionPathSource(source: string, options: RewriteGsapMotionPathOptions): GsapSourceRewriteResult {
  const segments = parseMotionPathSvg(options.path);
  if (!segments) return { ok: false, error: "Motion path must be an absolute M/C cubic SVG path." };
  const analysis = analyzeGsapSource(source, options);
  const animation = analysis.operations.find((entry) => entry.id === options.animationId);
  if (!animation) return { ok: false, error: `Registered animation "${options.animationId}" was not found.` };
  if (!animation.editable) return { ok: false, error: `Animation "${options.animationId}" is not safely writable.` };
  const original = source.slice(animation.source.start, animation.source.end);
  const owner = original.match(/^\s*([$A-Z_a-z][$\w]*)\s*\./)?.[1];
  if (!owner) return { ok: false, error: "Could not resolve the registered timeline variable." };
  const lineStart = source.lastIndexOf("\n", animation.source.start - 1) + 1;
  const indent = source.slice(lineStart, animation.source.start).match(/^\s*/)?.[0] ?? "";
  const replacement = `${owner}.to(\n`
    + `${indent}  ${JSON.stringify(animation.target)},\n`
    + `${indent}  { id: ${JSON.stringify(animation.id)}, duration: frames(${animation.durationInFrames}), ease: "none", motionPath: { path: ${JSON.stringify(motionPathToStableSvg(segments))}, autoRotate: ${options.autoRotate === true} } },\n`
    + `${indent}  frames(${animation.startFrame}),\n`
    + `${indent})`;
  return { ok: true, text: source.slice(0, animation.source.start) + replacement + source.slice(animation.source.end) };
}

function motionPathToStableSvg(segments: NonNullable<ReturnType<typeof parseMotionPathSvg>>): string {
  const first = segments[0].from;
  const number = (value: number) => String(Math.round(value * 1_000) / 1_000);
  return `M${number(first.x)},${number(first.y)} ` + segments.map((segment) =>
    `C${number(segment.control1.x)},${number(segment.control1.y)} ${number(segment.control2.x)},${number(segment.control2.y)} ${number(segment.to.x)},${number(segment.to.y)}`,
  ).join(" ");
}

/** Locate explicit helper/loop trace boundaries without executing their code. */
export function analyzeGsapUnrollGroups(source: string, options: AnalyzeGsapSourceOptions): GsapUnrollGroupSource[] {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, { sourceType: "unambiguous", plugins: ["typescript", "jsx", "decorators-legacy"] });
  } catch {
    return [];
  }
  const groups: GsapUnrollGroupSource[] = [];
  walk(ast.program, (node) => {
    if (node.type !== "CallExpression" || node.callee.type !== "Identifier" || node.callee.name !== "unroll") return;
    const id = literalOf(argumentExpression(node, 0));
    const timeline = argumentExpression(node, 1);
    const factory = argumentExpression(node, 2);
    if (typeof id !== "string" || timeline?.type !== "Identifier" || !factory
      || (factory.type !== "ArrowFunctionExpression" && factory.type !== "FunctionExpression")) return;
    const issues: string[] = [];
    walk(factory.body, (child) => {
      if (child.type === "CallExpression") {
        const member = memberName(child);
        if (member && ["Math.random", "Date.now", "performance.now", "gsap.ticker"].includes(`${member.owner}.${member.property}`)) {
          issues.push(`${member.owner}.${member.property} is nondeterministic`);
        }
        if (member && ["getBoundingClientRect", "getClientRects", "getComputedStyle"].includes(member.property)) {
          issues.push(`${member.property}() reads runtime DOM geometry`);
        }
        if (child.callee.type === "Identifier" && child.callee.name === "getComputedStyle") {
          issues.push("getComputedStyle() reads runtime DOM state");
        }
      }
      if (child.type === "MemberExpression" || child.type === "OptionalMemberExpression") {
        const property = child.computed
          ? literalOf(child.property as Expression)
          : child.property.type === "Identifier" ? child.property.name : undefined;
        if (typeof property === "string" && ["offsetWidth", "offsetHeight", "clientWidth", "clientHeight", "scrollWidth", "scrollHeight"].includes(property)) {
          issues.push(`${property} reads runtime DOM geometry`);
        }
      }
    });
    groups.push({ id, timeline: timeline.name, source: spanOf(node, options.file), staticallySafe: !issues.length, issues });
  });
  return groups;
}

function renderTraceRecord(record: Record<string, string | number | boolean>): string {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${sourceKey(key)}: ${sourceValue(value)}`).join(", ");
}

/** Replace one traced helper boundary and prove its normalized explicit trace before returning text. */
export function rewriteGsapUnrollSource(source: string, options: RewriteGsapUnrollOptions): GsapUnrollRewriteResult {
  const group = analyzeGsapUnrollGroups(source, options).find((entry) => entry.id === options.groupId);
  if (!group) return { ok: false, error: `Unroll group "${options.groupId}" was not found.` };
  if (!group.staticallySafe) return { ok: false, error: group.issues.join("; ") };
  if (!options.operations.length) return { ok: false, error: "The runtime trace did not contain any tweens." };
  const lineStart = source.lastIndexOf("\n", group.source.start - 1) + 1;
  const indent = source.slice(lineStart, group.source.start).match(/^\s*/)?.[0] ?? "";
  const rendered = options.operations.map((operation, index) => {
    const id = `${group.id}-${index + 1}`;
    const position = `frames(${Math.round(operation.startFrame)})`;
    const duration = `duration: frames(${Math.max(0, Math.round(operation.durationInFrames))})`;
    const ease = operation.ease ? `, ease: ${JSON.stringify(operation.ease)}` : "";
    if (operation.kind === "set") {
      const values = renderTraceRecord(operation.to);
      return `${group.timeline}.set(${JSON.stringify(operation.target)}, { id: ${JSON.stringify(id)}${values ? `, ${values}` : ""} }, ${position})`;
    }
    if (operation.kind === "fromTo" && operation.from) {
      const from = renderTraceRecord(operation.from);
      const to = renderTraceRecord(operation.to);
      return `${group.timeline}.fromTo(${JSON.stringify(operation.target)}, { ${from} }, { id: ${JSON.stringify(id)}${to ? `, ${to}` : ""}, ${duration}${ease} }, ${position})`;
    }
    const values = renderTraceRecord(operation.to);
    return `${group.timeline}.to(${JSON.stringify(operation.target)}, { id: ${JSON.stringify(id)}${values ? `, ${values}` : ""}, ${duration}${ease} }, ${position})`;
  });
  const replacement = rendered.join(`;\n${indent}`);
  const text = source.slice(0, group.source.start) + replacement + source.slice(group.source.end);
  const explicit = analyzeGsapSource(text, options).operations
    .filter((entry) => entry.id.startsWith(`${group.id}-`))
    .map(({ id: _id, bindings: _bindings, authority: _authority, editable: _editable, source: _source, start: _start, duration: _duration, motionPath: _motionPath, ...operation }) => operation);
  if (!tweenTracesEqual(options.operations, explicit)) {
    return { ok: false, error: "Unroll validation failed: normalized pre/post traces differ." };
  }
  return { ok: true, text, traceVerified: true };
}
