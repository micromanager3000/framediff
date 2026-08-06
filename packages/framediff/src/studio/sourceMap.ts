// Studio source-mapper: pure, browser-safe text analysis over a FileSet (path → source text).
// Locates the numeric literal behind a JSX timing expression (so dragging a clip can rewrite the
// ONE token the author typed — `TL.lowerThird.from` → the `180` in constants.ts) or, when the
// expression is arithmetic/calls/unresolvable, evaluates it to a plain number for display.
//
// Deliberately NOT a TypeScript compiler: a comment/string-aware scanner plus a tiny recursive-
// descent expression grammar (numbers, + - * /, unary minus, parens, Math.round/floor/ceil/min/max,
// identifiers and dotted paths through `export const` object literals). Original offsets are always
// preserved — comments/strings are masked to spaces, never removed — so every reported span splices
// straight back into the user's file.
//
// Known limits (fine for the sources this drives): no <Sequence> nested inside <Sequence> (the
// first `</Sequence>` closes the region), no template-literal `${}` re-entry, unterminated '/"
// strings end at the newline.

export type FileSet = Record<string, string>; // path → text

/** An expression that resolved to exactly one numeric literal token: editable in place. */
export interface LiteralLoc { kind: "literal"; file: string; start: number; end: number; value: number; }
/** A directly authored string literal, with a span inside its quote delimiters. */
export interface StringLiteralLoc { kind: "string-literal"; file: string; start: number; end: number; value: string; quote: "\"" | "'"; }
/** Anything else — arithmetic, calls, unresolvable: display-only, with the value when computable. */
export interface ComputedLoc { kind: "computed"; expr: string; value: number | undefined; }
export type ResolvedExpr = LiteralLoc | ComputedLoc;

/** Grade params a clip/layer tag can carry — the drill/resolve keys for `grade={...}`. */
export const GRADE_PARAM_KEYS = [
  "temperature",
  "tint",
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "saturation",
  "vignette",
  "bloom",
  "bloomThreshold",
  "lutIntensity",
] as const;
export type GradeParamKey = (typeof GRADE_PARAM_KEYS)[number];
export type GradeValues = Partial<Record<GradeParamKey, number>>;

/** One `<Sequence ...>` open tag found in a file, with its timing attrs resolved. */
export interface SeqOccurrence {
  index: number;              // 0-based order of <Sequence in the file
  name?: string;              // name="..." attr if present
  start: number; end: number; // span of the <Sequence ...> open tag in the file
  from: ResolvedExpr;         // from={EXPR}; missing attr → {expr:"0", value:0}
  duration: ResolvedExpr;     // durationInFrames={EXPR}; missing → {expr:"Infinity", value:undefined}
  nested?: { compExpr: string; trimStart?: ResolvedExpr }; // first <Nested comp={X}/> inside
  /** The first grade-bearing tag inside (<GradedVideo grade=…>, <GradeLayer grade=…>, …):
   *  per-key resolution of the grade object (inline literal or a dotted-path const), plus a
   *  bare `lutIntensity={…}` attr. `expr` holds the raw attr text when it isn't an inline object. */
  grade?: {
    fields: Partial<Record<GradeParamKey, ResolvedExpr>>;
    expr?: string;
    lutIntensity?: ResolvedExpr;
    /** Source tag carrying the grade; spans index into the original file. */
    tag?: { start: number; end: number; insertAt: number; gradeAttr?: { start: number; end: number } };
  };
  closeStart?: number;
  closeEnd?: number;
}

/** One object entry inside an exported object array, e.g. HERO_SHOTS[n]. */
export interface ObjectArrayOccurrence {
  index: number;
  key?: string;
  file: string;
  start: number;
  end: number;
  fields: Record<string, ResolvedExpr>;
}

export interface ObjectArrayStringOccurrence {
  index: number;
  key?: string;
  file: string;
  start: number;
  end: number;
  fields: Record<string, StringLiteralLoc>;
}

// ---------------------------------------------------------------------------
// Masking: same length, same offsets — comment bodies and string contents → spaces
// (quote delimiters kept so string boundaries stay visible; newlines kept).
// ---------------------------------------------------------------------------

const maskCache = new Map<string, string>();

function mask(text: string): string {
  const hit = maskCache.get(text);
  if (hit !== undefined) return hit;
  const out = text.split("");
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") out[i++] = " ";
    } else if (c === "/" && text[i + 1] === "*") {
      out[i++] = " "; out[i++] = " ";
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < n) { out[i++] = " "; out[i++] = " "; }
    } else if (c === '"' || c === "'") {
      i++; // keep the opening quote
      while (i < n && text[i] !== c && text[i] !== "\n") {
        out[i++] = " ";
        if (text[i - 1] === "\\" && i < n && text[i] !== "\n") out[i++] = " "; // escaped char
      }
      if (i < n && text[i] === c) i++; // keep the closing quote
    } else if (c === "`") {
      i++; // keep the opening backtick
      while (i < n && text[i] !== "`") {
        if (text[i] !== "\n") out[i] = " ";
        if (text[i] === "\\") { i++; if (i < n && text[i] !== "\n") out[i] = " "; }
        i++;
      }
      if (i < n) i++; // keep the closing backtick
    } else {
      i++;
    }
  }
  const masked = out.join("");
  maskCache.set(text, masked);
  return masked;
}

// ---------------------------------------------------------------------------
// Expression grammar (recursive descent)
// ---------------------------------------------------------------------------

type Tok = { t: "num" | "id" | "punc"; v: string; s: number; e: number };

function lex(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      toks.push({ t: "num", v: m[0], s: i, e: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))!;
      toks.push({ t: "id", v: m[0], s: i, e: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if ("+-*/().,".includes(c)) {
      toks.push({ t: "punc", v: c, s: i, e: i + 1 });
      i++;
      continue;
    }
    return null; // outside the grammar (ternaries, typeof, JSX, ...)
  }
  return toks;
}

type Ast =
  | { t: "num"; v: number; s: number; e: number }
  | { t: "path"; parts: string[] }
  | { t: "bin"; op: string; l: Ast; r: Ast }
  | { t: "neg"; a: Ast; s: number }
  | { t: "call"; fn: string; args: Ast[] };

const MATH_FNS = new Set(["round", "floor", "ceil", "min", "max"]);

/** Parse an expression string; null when it falls outside the supported grammar. */
function parse(src: string): Ast | null {
  const toks = lex(src);
  if (!toks || toks.length === 0) return null;
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string): Tok | null => {
    const t = toks[p];
    if (!t || (v !== undefined && !(t.t === "punc" && t.v === v))) return null;
    p++;
    return t;
  };

  function expr(): Ast | null {
    let l = term();
    if (!l) return null;
    for (let t = peek(); t && t.t === "punc" && (t.v === "+" || t.v === "-"); t = peek()) {
      p++;
      const r = term();
      if (!r) return null;
      l = { t: "bin", op: t.v, l, r };
    }
    return l;
  }
  function term(): Ast | null {
    let l = unary();
    if (!l) return null;
    for (let t = peek(); t && t.t === "punc" && (t.v === "*" || t.v === "/"); t = peek()) {
      p++;
      const r = unary();
      if (!r) return null;
      l = { t: "bin", op: t.v, l, r };
    }
    return l;
  }
  function unary(): Ast | null {
    const minus = eat("-");
    if (minus) {
      const a = unary();
      return a && { t: "neg", a, s: minus.s };
    }
    return primary();
  }
  function primary(): Ast | null {
    const t = peek();
    if (!t) return null;
    if (t.t === "num") { p++; return { t: "num", v: parseFloat(t.v), s: t.s, e: t.e }; }
    if (t.t === "punc" && t.v === "(") {
      p++;
      const a = expr();
      return a && eat(")") ? a : null;
    }
    if (t.t === "id") {
      p++;
      const parts = [t.v];
      while (peek()?.t === "punc" && peek().v === ".") {
        p++;
        const id = peek();
        if (!id || id.t !== "id") return null;
        p++;
        parts.push(id.v);
      }
      if (peek()?.t === "punc" && peek().v === "(") {
        if (parts.length !== 2 || parts[0] !== "Math" || !MATH_FNS.has(parts[1])) return null;
        p++;
        const args: Ast[] = [];
        if (!(peek()?.t === "punc" && peek().v === ")")) {
          for (;;) {
            const a = expr();
            if (!a) return null;
            args.push(a);
            if (eat(",")) continue;
            break;
          }
        }
        return eat(")") ? { t: "call", fn: parts[1], args } : null;
      }
      return { t: "path", parts };
    }
    return null;
  }

  const root = expr();
  return root && p === toks.length ? root : null;
}

// ---------------------------------------------------------------------------
// Declarations and object-literal drilling (over masked text; offsets = original)
// ---------------------------------------------------------------------------

/** End of the value starting at `i`: index of the `,` or closing `}` at bracket depth 0. */
function scanValueEnd(masked: string, i: number): number {
  let depth = 0;
  for (; i < masked.length; i++) {
    const c = masked[i];
    if (depth === 0 && (c === "," || c === "}")) return i;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
  }
  return masked.length;
}

/** In the object literal whose `{` is at `start`, find `key:`'s value span (trimmed). */
function drill(masked: string, start: number, key: string): { s: number; e: number } | null {
  let i = start + 1;
  const n = masked.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(masked[i])) i++;
    if (i >= n || masked[i] === "}") return null;
    const m = /^[A-Za-z_$][\w$]*/.exec(masked.slice(i));
    const name = m ? m[0] : null;
    if (name) i += name.length;
    while (i < n && /\s/.test(masked[i])) i++;
    if (masked[i] !== ":") { i = scanValueEnd(masked, i); continue; } // shorthand/spread — skip
    i++;
    while (i < n && /\s/.test(masked[i])) i++;
    const vs = i;
    const ve = scanValueEnd(masked, i);
    if (name === key) {
      let e = ve;
      while (e > vs && /\s/.test(masked[e - 1])) e--; // masked comments trim away too
      return { s: vs, e };
    }
    i = ve;
  }
  return null;
}

/** `(export) const NAME = <RHS>` in any file — RHS span (masked-trimmed, `as const` stripped). */
export function findDecl(name: string, contextFile: string, files: FileSet): { file: string; s: number; e: number } | null {
  const order = [contextFile, ...Object.keys(files).filter((f) => f !== contextFile)];
  const re = new RegExp("(?:\\bexport\\s+)?\\bconst\\s+" + name.replace(/\$/g, "\\$") + "(?:\\s*:[^=;\\n]+)?\\s*=(?![=>])");
  for (const file of order) {
    const text = files[file];
    if (text === undefined) continue;
    const masked = mask(text);
    const m = re.exec(masked);
    if (!m) continue;
    let s = m.index + m[0].length;
    // RHS runs to `;` at depth 0, or a depth-0 newline where the statement looks complete.
    let depth = 0;
    let e = masked.length;
    for (let i = s; i < masked.length; i++) {
      const c = masked[i];
      if (depth === 0 && c === ";") { e = i; break; }
      if (depth === 0 && c === "\n") {
        const sofar = masked.slice(s, i).trim();
        if (sofar && !/[+\-*/(,.=<>&|?:]$/.test(sofar)) {
          let j = i;
          while (j < masked.length && /\s/.test(masked[j])) j++;
          if (!/[.+\-*/?:)&|]/.test(masked[j] ?? "")) { e = i; break; }
        }
      }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
    }
    while (s < e && /\s/.test(masked[s])) s++;
    while (e > s && /\s/.test(masked[e - 1])) e--;
    const asConst = /\s+as\s+const$/.exec(masked.slice(s, e));
    if (asConst) e = s + asConst.index;
    while (e > s && /\s/.test(masked[e - 1])) e--;
    if (e > s) return { file, s, e };
  }
  return null;
}

function matching(masked: string, start: number, open: string, close: string): number | null {
  if (masked[start] !== open) return null;
  let depth = 0;
  for (let i = start; i < masked.length; i++) {
    const c = masked[i];
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return null;
}

function stringValue(text: string, s: number, e: number): string | undefined {
  const raw = text.slice(s, e).trim();
  const m = /^["']([^"']*)["']$/.exec(raw);
  return m?.[1];
}

// ---------------------------------------------------------------------------
// Resolution: AST → one literal token, or an evaluated value
// ---------------------------------------------------------------------------

type Res = { lit?: { file: string; start: number; end: number; value: number }; value: number | undefined };

function resolveAst(ast: Ast, file: string, files: FileSet, visited: Set<string>, base: number): Res {
  if (ast.t === "num") {
    if (base >= 0) return { lit: { file, start: base + ast.s, end: base + ast.e, value: ast.v }, value: ast.v };
    return { value: ast.v };
  }
  if (ast.t === "neg" && ast.a.t === "num") {
    const value = -ast.a.v;
    if (base >= 0) return { lit: { file, start: base + ast.s, end: base + ast.a.e, value }, value };
    return { value };
  }
  if (ast.t === "path") return resolvePath(ast.parts, file, files, visited);
  return { value: evalAst(ast, file, files, visited) };
}

function evalAst(ast: Ast, file: string, files: FileSet, visited: Set<string>): number | undefined {
  switch (ast.t) {
    case "num": return ast.v;
    case "neg": {
      const v = evalAst(ast.a, file, files, visited);
      return v === undefined ? undefined : -v;
    }
    case "bin": {
      const l = evalAst(ast.l, file, files, visited);
      const r = evalAst(ast.r, file, files, visited);
      if (l === undefined || r === undefined) return undefined;
      return ast.op === "+" ? l + r : ast.op === "-" ? l - r : ast.op === "*" ? l * r : l / r;
    }
    case "call": {
      const args = ast.args.map((a) => evalAst(a, file, files, visited));
      if (args.some((v) => v === undefined)) return undefined;
      return (Math as unknown as Record<string, (...xs: number[]) => number>)[ast.fn](...(args as number[]));
    }
    case "path": return resolvePath(ast.parts, file, files, visited).value;
  }
}

function resolvePath(parts: string[], file: string, files: FileSet, visited: Set<string>): Res {
  if (parts[0] === "Math") return { value: undefined }; // Math only appears as a call
  const decl = findDecl(parts[0], file, files);
  if (!decl) return { value: undefined };
  const key = decl.file + "#" + parts[0];
  if (visited.has(key)) return { value: undefined }; // cycle
  visited.add(key);
  try {
    const masked = mask(files[decl.file]);
    let s = decl.s;
    let e = decl.e;
    for (let i = 1; i < parts.length; i++) {
      if (masked[s] !== "{") return { value: undefined }; // dotting into a non-object
      const hit = drill(masked, s, parts[i]);
      if (!hit) return { value: undefined };
      s = hit.s; e = hit.e;
    }
    const ast = parse(masked.slice(s, e));
    if (!ast) return { value: undefined };
    return resolveAst(ast, decl.file, files, visited, s);
  } finally {
    visited.delete(key); // per-branch guard: siblings may resolve the same name (diamonds)
  }
}

/**
 * Resolve a TS expression string against the FileSet. A bare numeric literal, or an identifier /
 * dotted path that lands (possibly through chained consts) on one, → LiteralLoc pointing at that
 * token; anything else → ComputedLoc with the evaluated value (undefined when unresolvable).
 * `at` — offset of `expr` within `file` — lets an in-file literal like `from={0}` report its span;
 * without it a bare number has no location and comes back computed.
 */
export function resolveExpr(expr: string, file: string, files: FileSet, at?: number): ResolvedExpr {
  const ast = parse(expr);
  const computed = (value: number | undefined): ComputedLoc => ({ kind: "computed", expr: expr.trim(), value });
  if (!ast) return computed(undefined);
  const res = resolveAst(ast, file, files, new Set(), at ?? -1);
  if (res.lit) return { kind: "literal", ...res.lit };
  return computed(res.value);
}

// ---------------------------------------------------------------------------
// <Sequence> scanning
// ---------------------------------------------------------------------------

type Attr = { vs: number; ve: number; quoted: boolean };

/** End index (exclusive of `>`) of an open tag whose attrs start at `i`; braces balanced. */
function tagEnd(masked: string, i: number): number {
  let depth = 0;
  for (; i < masked.length; i++) {
    const c = masked[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return masked.length;
}

/** Parse `name={expr}` / `name="str"` attrs in [s, e); spans index into the original text. */
function parseAttrs(masked: string, s: number, e: number): Map<string, Attr> {
  const attrs = new Map<string, Attr>();
  let i = s;
  while (i < e) {
    while (i < e && /[\s/]/.test(masked[i])) i++;
    const m = /^[A-Za-z_][\w-]*/.exec(masked.slice(i, e));
    if (!m) break;
    const name = m[0];
    i += name.length;
    while (i < e && /\s/.test(masked[i])) i++;
    if (masked[i] !== "=") { attrs.set(name, { vs: i, ve: i, quoted: false }); continue; } // boolean attr
    i++;
    while (i < e && /\s/.test(masked[i])) i++;
    const c = masked[i];
    if (c === "{") {
      let depth = 0;
      let j = i;
      for (; j < e; j++) {
        if (masked[j] === "{") depth++;
        else if (masked[j] === "}" && --depth === 0) break;
      }
      attrs.set(name, { vs: i + 1, ve: j, quoted: false });
      i = j + 1;
    } else if (c === '"' || c === "'") {
      const close = masked.indexOf(c, i + 1);
      const j = close === -1 || close >= e ? e : close;
      attrs.set(name, { vs: i + 1, ve: j, quoted: true });
      i = j + 1;
    } else {
      let j = i;
      while (j < e && !/\s/.test(masked[j])) j++;
      attrs.set(name, { vs: i, ve: j, quoted: false });
      i = j;
    }
  }
  return attrs;
}

/** True when the open tag ending at `end` (index of `>`) is self-closing (`/>`). */
function selfCloses(masked: string, end: number): boolean {
  let i = end - 1;
  while (i >= 0 && /\s/.test(masked[i])) i--;
  return masked[i] === "/";
}

function findTag(masked: string, tag: string, from: number, to: number): number {
  const needle = "<" + tag;
  for (let i = masked.indexOf(needle, from); i !== -1 && i < to; i = masked.indexOf(needle, i + 1)) {
    const c = masked[i + needle.length];
    if (c === undefined || /[\s/>]/.test(c)) return i;
  }
  return -1;
}

type ComponentTag = { start: number; end: number; insertAt: number; attrs: Map<string, Attr> };

function componentTag(masked: string, start: number, to: number): ComponentTag | null {
  const m = /^[A-Z][\w.]*/.exec(masked.slice(start + 1, Math.min(start + 64, to)));
  if (!m) return null;
  const attrsStart = start + 1 + m[0].length;
  const end = tagEnd(masked, attrsStart);
  if (end >= to) return null;
  let insertAt = end;
  if (selfCloses(masked, end)) {
    let i = end - 1;
    while (i > attrsStart && /\s/.test(masked[i])) i--;
    if (masked[i] === "/") {
      while (i > attrsStart && /\s/.test(masked[i - 1])) i--;
      insertAt = i;
    }
  }
  return { start, end, insertAt, attrs: parseAttrs(masked, attrsStart, end) };
}

/** First component open tag in [from, to). */
function findComponentTag(masked: string, from: number, to: number): ComponentTag | null {
  for (let i = from; i < to; i++) {
    if (masked[i] !== "<") continue;
    const tag = componentTag(masked, i, to);
    if (!tag) continue;
    return tag;
  }
  return null;
}

/** First component open tag in [from, to) carrying a `grade` (or `lutIntensity`) attr. */
function findGradeTag(masked: string, from: number, to: number): ComponentTag | null {
  for (let i = from; i < to; i++) {
    if (masked[i] !== "<") continue;
    const tag = componentTag(masked, i, to);
    if (!tag) continue;
    if (tag.attrs.has("grade") || tag.attrs.has("lutIntensity")) return tag;
    i = tag.end;
  }
  return null;
}

/** Resolve a tag's grade/lutIntensity attrs — inline object literals drill per key; a dotted
 *  path (`SOME_LOOK.grade`) chases each key through the consts; anything else stays computed. */
function resolveGradeAttrs(
  masked: string,
  file: string,
  files: FileSet,
  tag: ComponentTag,
): SeqOccurrence["grade"] {
  const grade: NonNullable<SeqOccurrence["grade"]> = { fields: {} };
  const attrs = tag.attrs;
  const g = attrs.get("grade");
  grade.tag = {
    start: tag.start,
    end: tag.end,
    insertAt: tag.insertAt,
    gradeAttr: g ? { start: g.vs, end: g.ve } : undefined,
  };
  if (g) {
    let s = g.vs;
    while (s < g.ve && /\s/.test(masked[s])) s++;
    if (masked[s] === "{") {
      for (const key of GRADE_PARAM_KEYS) {
        const hit = drill(masked, s, key);
        if (!hit || hit.e > g.ve) continue;
        grade.fields[key] = resolveExpr(masked.slice(hit.s, hit.e), file, files, hit.s);
      }
    } else {
      const expr = masked.slice(g.vs, g.ve).trim();
      grade.expr = expr;
      for (const key of GRADE_PARAM_KEYS) {
        const r = resolveExpr(`${expr}.${key}`, file, files);
        if (r.kind === "literal" || r.value !== undefined) grade.fields[key] = r;
      }
    }
  }
  const li = attrs.get("lutIntensity");
  if (li) grade.lutIntensity = resolveExpr(masked.slice(li.vs, li.ve), file, files, li.vs);
  if (!Object.keys(grade.fields).length && !grade.lutIntensity && !grade.expr) return undefined;
  return grade;
}

/**
 * Find every `<Sequence ...>` open tag in `file` (comments/strings ignored) and resolve its
 * from/durationInFrames/name attrs, plus the first `<Nested comp={X}/>` before the matching
 * `</Sequence>`. Sequences nested inside Sequences are not supported (first close tag wins).
 */
export function parseSequences(file: string, files: FileSet): SeqOccurrence[] {
  const text = files[file];
  if (text === undefined) return [];
  const masked = mask(text);
  const out: SeqOccurrence[] = [];
  for (let i = findTag(masked, "Sequence", 0, masked.length); i !== -1; i = findTag(masked, "Sequence", i + 1, masked.length)) {
    const attrsStart = i + "<Sequence".length;
    const gt = tagEnd(masked, attrsStart);
    const attrs = parseAttrs(masked, attrsStart, gt);

    const resolveAttr = (a: Attr | undefined, missing: ComputedLoc): ResolvedExpr =>
      a ? resolveExpr(masked.slice(a.vs, a.ve), file, files, a.vs) : missing;

    const nameAttr = attrs.get("name");
    const occ: SeqOccurrence = {
      index: out.length,
      start: i,
      end: gt + 1,
      from: resolveAttr(attrs.get("from"), { kind: "computed", expr: "0", value: 0 }),
      duration: resolveAttr(attrs.get("durationInFrames"), { kind: "computed", expr: "Infinity", value: undefined }),
    };
    if (nameAttr?.quoted) occ.name = text.slice(nameAttr.vs, nameAttr.ve);

    if (!selfCloses(masked, gt)) {
      const close = masked.indexOf("</Sequence", gt);
      const region = close === -1 ? masked.length : close;
      if (close !== -1) {
        occ.closeStart = close;
        occ.closeEnd = tagEnd(masked, close + "</Sequence".length) + 1;
      }
      const nested = findTag(masked, "Nested", gt + 1, region);
      if (nested !== -1) {
        const nGt = tagEnd(masked, nested + "<Nested".length);
        const nAttrs = parseAttrs(masked, nested + "<Nested".length, nGt);
        const comp = nAttrs.get("comp");
        if (comp) {
          occ.nested = { compExpr: text.slice(comp.vs, comp.ve).trim() };
          const trim = nAttrs.get("trimStart");
          if (trim) occ.nested.trimStart = resolveExpr(masked.slice(trim.vs, trim.ve), file, files, trim.vs);
        }
      }
      const gradeAttrs = findGradeTag(masked, gt + 1, region);
      if (gradeAttrs) occ.grade = resolveGradeAttrs(masked, file, files, gradeAttrs);
    }
    out.push(occ);
  }
  return out;
}

/** Parse numeric fields out of an exported object array, keyed by a string field such as `name`.
 *  Used by Studio for data-driven timelines where JSX contains `HERO_SHOTS.map(...)`, so the
 *  sequence open tag itself only contains computed `s.from` / `s.durationInFrames` expressions. */
export function parseObjectArray(
  file: string,
  files: FileSet,
  exportName: string,
  fieldNames: string[],
  keyField = "name",
): ObjectArrayOccurrence[] {
  const decl = findDecl(exportName, file, files);
  if (!decl) return [];
  const text = files[decl.file];
  const masked = mask(text);
  if (masked[decl.s] !== "[") return [];
  const arrayEnd = matching(masked, decl.s, "[", "]");
  if (arrayEnd == null) return [];

  const out: ObjectArrayOccurrence[] = [];
  for (let i = decl.s + 1; i < arrayEnd; ) {
    while (i < arrayEnd && /[\s,]/.test(masked[i])) i++;
    if (i >= arrayEnd) break;
    if (masked[i] !== "{") {
      i = scanValueEnd(masked, i) + 1;
      continue;
    }
    const objEnd = matching(masked, i, "{", "}");
    if (objEnd == null || objEnd > arrayEnd) break;

    const fields: Record<string, ResolvedExpr> = {};
    for (const field of fieldNames) {
      const hit = drill(masked, i, field);
      if (!hit || hit.s >= objEnd) continue;
      fields[field] = resolveExpr(masked.slice(hit.s, hit.e), decl.file, files, hit.s);
    }
    const keyHit = drill(masked, i, keyField);
    out.push({
      index: out.length,
      key: keyHit && keyHit.s < objEnd ? stringValue(text, keyHit.s, keyHit.e) : undefined,
      file: decl.file,
      start: i,
      end: objEnd + 1,
      fields,
    });
    i = objEnd + 1;
  }
  return out;
}

/** Parse directly-authored string fields from an exported object array. */
export function parseObjectArrayStrings(
  file: string,
  files: FileSet,
  exportName: string,
  fieldNames: string[],
  keyField = "name",
): ObjectArrayStringOccurrence[] {
  const decl = findDecl(exportName, file, files);
  if (!decl) return [];
  const text = files[decl.file];
  const masked = mask(text);
  if (masked[decl.s] !== "[") return [];
  const arrayEnd = matching(masked, decl.s, "[", "]");
  if (arrayEnd == null) return [];

  const out: ObjectArrayStringOccurrence[] = [];
  for (let i = decl.s + 1; i < arrayEnd;) {
    while (i < arrayEnd && /[\s,]/.test(masked[i])) i += 1;
    if (i >= arrayEnd) break;
    if (masked[i] !== "{") {
      i = scanValueEnd(masked, i) + 1;
      continue;
    }
    const objEnd = matching(masked, i, "{", "}");
    if (objEnd == null || objEnd > arrayEnd) break;
    const fields: Record<string, StringLiteralLoc> = {};
    for (const field of fieldNames) {
      const hit = drill(masked, i, field);
      if (!hit || hit.s >= objEnd) continue;
      let start = hit.s;
      let end = hit.e;
      while (start < end && /\s/.test(text[start])) start += 1;
      while (end > start && /\s/.test(text[end - 1])) end -= 1;
      const quote = text[start];
      if ((quote !== "\"" && quote !== "'") || text[end - 1] !== quote) continue;
      fields[field] = {
        kind: "string-literal",
        file: decl.file,
        start: start + 1,
        end: end - 1,
        value: text.slice(start + 1, end - 1),
        quote,
      };
    }
    const keyHit = drill(masked, i, keyField);
    out.push({
      index: out.length,
      key: keyHit && keyHit.s < objEnd ? stringValue(text, keyHit.s, keyHit.e) : undefined,
      file: decl.file,
      start: i,
      end: objEnd + 1,
      fields,
    });
    i = objEnd + 1;
  }
  return out;
}

/** Parse every numeric literal inside `export const OBJECT = { key: [numbers...] }`. */
export function parseNumericArrayProperty(
  file: string,
  files: FileSet,
  exportName: string,
  propertyKey: string,
): LiteralLoc[] {
  const decl = findDecl(exportName, file, files);
  if (!decl) return [];
  const text = files[decl.file];
  const masked = mask(text);
  if (masked[decl.s] !== "{") return [];
  const hit = drill(masked, decl.s, propertyKey);
  if (!hit) return [];
  const out: LiteralLoc[] = [];
  const re = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
  const src = masked.slice(hit.s, hit.e);
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out.push({
      kind: "literal",
      file: decl.file,
      start: hit.s + m.index,
      end: hit.s + m.index + m[0].length,
      value: parseFloat(m[0]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

/** Compact source form: integers plain, else enough precision for camera/world-space editing. */
function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

type TextEdit = { start: number; end: number; text: string };

const GRADE_OBJECT_KEYS = GRADE_PARAM_KEYS.filter((key) => key !== "lutIntensity");

function applyTextEdits(text: string, edits: TextEdit[]): string {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

function gradeObjectLiteral(values: GradeValues): string {
  const parts = GRADE_OBJECT_KEYS.flatMap((key) => {
    const value = values[key];
    return value === undefined ? [] : [`${key}: ${fmt(value)}`];
  });
  return `{ ${parts.join(", ")} }`;
}

function gradeEditForSequence(masked: string, occ: SeqOccurrence, values: GradeValues): TextEdit | null {
  const regionEnd = occ.closeStart ?? masked.length;
  const sourceTag = occ.grade?.tag;
  const fallbackTag = sourceTag ? undefined : findComponentTag(masked, occ.end, regionEnd);
  const tag = sourceTag ?? fallbackTag;
  if (!tag) return null;
  const literal = gradeObjectLiteral(values);
  if (sourceTag?.gradeAttr) return { start: sourceTag.gradeAttr.start, end: sourceTag.gradeAttr.end, text: literal };
  return { start: tag.insertAt, end: tag.insertAt, text: ` grade={${literal}}` };
}

function sequenceRemovalEdit(text: string, occ: SeqOccurrence): TextEdit | null {
  if (occ.closeEnd === undefined) return null;
  let start = occ.start;
  const lineStart = text.lastIndexOf("\n", occ.start - 1) + 1;
  if (/^\s*$/.test(text.slice(lineStart, occ.start))) start = lineStart;
  let end = occ.closeEnd;
  if (text[end] === "\r" && text[end + 1] === "\n") end += 2;
  else if (text[end] === "\n") end += 1;
  return { start, end, text: "" };
}

/** Replace or insert the grade object on the first grade-capable component inside a Sequence. */
export function setSequenceGrade(
  file: string,
  files: FileSet,
  sequenceIndex: number,
  values: GradeValues,
): { file: string; text: string } | null {
  const text = files[file];
  if (text === undefined) return null;
  const occ = parseSequences(file, files)[sequenceIndex];
  if (!occ) return null;
  const edit = gradeEditForSequence(mask(text), occ, values);
  return edit ? { file, text: applyTextEdits(text, [edit]) } : null;
}

/** Pin a floating grade layer to one clip: copy its grade to the target, then remove the layer. */
export function pinGradeLayerToClip(
  file: string,
  files: FileSet,
  gradeSequenceIndex: number,
  targetSequenceIndex: number,
  values: GradeValues,
): { file: string; text: string } | null {
  if (gradeSequenceIndex === targetSequenceIndex) return null;
  const text = files[file];
  if (text === undefined) return null;
  const occs = parseSequences(file, files);
  const gradeOcc = occs[gradeSequenceIndex];
  const targetOcc = occs[targetSequenceIndex];
  if (!gradeOcc || !targetOcc) return null;
  const setGrade = gradeEditForSequence(mask(text), targetOcc, values);
  const removeLayer = sequenceRemovalEdit(text, gradeOcc);
  return setGrade && removeLayer ? { file, text: applyTextEdits(text, [setGrade, removeLayer]) } : null;
}

/**
 * Splice `newValue` over the literal's span; returns the file's new full text (caller persists).
 * Round-trip safe: re-parsing the result finds the new value at the same occurrence.
 */
export function rewriteLiteral(files: FileSet, loc: LiteralLoc, newValue: number): { file: string; text: string } {
  const text = files[loc.file];
  return { file: loc.file, text: text.slice(0, loc.start) + fmt(newValue) + text.slice(loc.end) };
}

export function rewriteStringLiteral(files: FileSet, loc: StringLiteralLoc, newValue: string): { file: string; text: string } {
  const text = files[loc.file];
  const escaped = newValue
    .replaceAll("\\", "\\\\")
    .replaceAll(loc.quote, `\\${loc.quote}`)
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
  return { file: loc.file, text: text.slice(0, loc.start) + escaped + text.slice(loc.end) };
}

/**
 * Find the single occurrence of `"value"` or `'value'` as a real string literal in `file`
 * (comment lookalikes don't count). Returns the span INSIDE the quotes; null when zero or
 * 2+ matches — ambiguous means not safely editable.
 */
export function findStringLiteral(file: string, files: FileSet, value: string): { file: string; start: number; end: number } | null {
  const text = files[file];
  if (text === undefined) return null;
  const masked = mask(text);
  const hits: { file: string; start: number; end: number }[] = [];
  for (const q of ['"', "'"]) {
    const needle = q + value + q;
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
      // in the mask, real string delimiters survive; a quote inside a comment is blanked
      if (masked[i] === q && masked[i + needle.length - 1] === q) {
        hits.push({ file, start: i + 1, end: i + 1 + value.length });
      }
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

// ---------------------------------------------------------------------------
// Composition-level rewrites: nesting a comp into another, registering new comps,
// library promotion — the write path behind the Studio's drag-drop and "＋ New composition".
// ---------------------------------------------------------------------------

export interface CompExportLoc {
  file: string;
  varName: string;
  /** span of the object literal assigned to the export: offsets of `{` and its matching `}` */
  objStart: number;
  objEnd: number;
  /** how many composition-shaped exports this file holds (1 → safe to copy verbatim) */
  siblings: number;
  /** plain StudioComposition object literal, or a `generative({ … })` recipe call */
  shape: "object" | "generative";
}

const EXPORT_CONST_OBJ_RE = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]+?)?=\s*(generative\s*\(\s*)?\{/g;

/** Every composition-shaped export in `file`: `export const NAME(: T)? = { … }` carrying an
 *  `id` string plus `component`/`durationInFrames`, or a `generative({ … })` recipe call. */
function compExportsIn(file: string, files: FileSet): (CompExportLoc & { id: string })[] {
  const text = files[file];
  if (text === undefined) return [];
  const masked = mask(text);
  const out: (CompExportLoc & { id: string })[] = [];
  EXPORT_CONST_OBJ_RE.lastIndex = 0;
  for (let m = EXPORT_CONST_OBJ_RE.exec(masked); m; m = EXPORT_CONST_OBJ_RE.exec(masked)) {
    const shape = m[2] ? "generative" as const : "object" as const;
    const objStart = m.index + m[0].length - 1;
    const objEnd = matching(masked, objStart, "{", "}");
    if (objEnd == null) continue;
    const idHit = drill(masked, objStart, "id");
    if (!idHit || idHit.e > objEnd) continue;
    const id = stringValue(text, idHit.s, idHit.e);
    if (!id) continue;
    if (shape === "object" && !drill(masked, objStart, "component") && !drill(masked, objStart, "durationInFrames")) continue;
    out.push({ file, varName: m[1], objStart, objEnd, siblings: 0, id, shape });
  }
  for (const e of out) e.siblings = out.length;
  return out;
}

/** The `export const X = { id: "<compId>", … }` defining a comp, searched across the FileSet. */
export function findCompExport(compId: string, files: FileSet): CompExportLoc | null {
  for (const file of Object.keys(files)) {
    const hit = compExportsIn(file, files).find((e) => e.id === compId);
    if (hit) return hit;
  }
  return null;
}

/** Loosest form — just {file, varName}, for building imports. Falls back to any
 *  `export const NAME = <RHS whose span contains id: "compId">`, which also covers
 *  non-object-literal exports (generative recipes built by helper calls). */
export function findCompExportName(compId: string, files: FileSet): { file: string; varName: string } | null {
  const strict = findCompExport(compId, files);
  if (strict) return strict;
  const idRe = new RegExp(`\\bid\\s*:\\s*(["'])${compId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`);
  for (const file of Object.keys(files)) {
    const text = files[file];
    const masked = mask(text);
    const im = idRe.exec(text);
    if (!im) continue;
    const quoteAt = im.index + im[0].length - 1;
    if (masked[quoteAt] !== im[1]) continue; // the "match" sits inside a comment
    const nameRe = /\bexport\s+const\s+([A-Za-z_$][\w$]*)/g;
    for (let m = nameRe.exec(masked); m; m = nameRe.exec(masked)) {
      const decl = findDecl(m[1], file, { [file]: text });
      if (decl && decl.s <= im.index && im.index < decl.e) return { file, varName: m[1] };
    }
  }
  return null;
}

/** How many `export const` decls in `file` look composition-shaped (their span carries an
 *  `id:` string) — the sole-occupancy test behind deleting a comp's file. Unlike
 *  compExportsIn, this counts every export shape, helper calls (generative recipes) included. */
export function compExportCount(file: string, files: FileSet): number {
  const text = files[file];
  if (text === undefined) return 0;
  const masked = mask(text);
  let count = 0;
  const nameRe = /\bexport\s+const\s+([A-Za-z_$][\w$]*)/g;
  for (let m = nameRe.exec(masked); m; m = nameRe.exec(masked)) {
    const decl = findDecl(m[1], file, { [file]: text });
    if (decl && /\bid\s*:\s*["']/.test(masked.slice(decl.s, decl.e))) count++;
  }
  return count;
}

/** Relative module specifier from `importer` to `exporter` (both root-relative file paths). */
export function relModule(importer: string, exporter: string): string {
  const a = importer.split("/").slice(0, -1);
  const b = exporter.replace(/\.(tsx|ts|jsx|js)$/, "").split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const ups = a.length - i;
  const tail = b.slice(i).join("/");
  return ups === 0 ? `./${tail}` : `${Array(ups).fill("..").join("/")}/${tail}`;
}

/** TextEdit adding `import { varName } from "module"` — extends an existing import from the
 *  same module, appends after the last import line otherwise; null when already imported. */
function importEdit(file: string, files: FileSet, varName: string, module: string): TextEdit | null {
  const text = files[file];
  const masked = mask(text);
  const named = /\bimport\s+(type\s+)?\{([^}]*)\}\s*from\s*(["'])/g;
  for (let m = named.exec(masked); m; m = named.exec(masked)) {
    const qStart = m.index + m[0].length;
    const qEnd = text.indexOf(m[3], qStart);
    if (qEnd === -1) continue;
    if (m[1]) continue; // `import type` gives no value binding
    const names = m[2].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!.trim());
    if (names.includes(varName)) return null;
    if (text.slice(qStart, qEnd) === module) {
      let at = masked.indexOf("}", m.index);
      while (at > 0 && /\s/.test(text[at - 1])) at--;
      return { start: at, end: at, text: `, ${varName}` };
    }
  }
  // after the last import line (or at the very top)
  let lastEnd = -1;
  for (let ls = 0; ls < masked.length; ) {
    const le = masked.indexOf("\n", ls);
    const end = le === -1 ? masked.length : le;
    if (/^\s*import\b/.test(masked.slice(ls, end))) lastEnd = end;
    if (le === -1) break;
    ls = le + 1;
  }
  const line = `import { ${varName} } from "${module}";`;
  return lastEnd === -1 ? { start: 0, end: 0, text: `${line}\n` } : { start: lastEnd, end: lastEnd, text: `\n${line}` };
}

export interface InsertResult {
  file: string;
  text: string;
  /** offset (in the NEW text) to flash in the CODE view */
  at: number;
}

/**
 * Insert `<Sequence from><Nested comp/></Sequence>` as the LAST child of the comp's root JSX —
 * later siblings paint on top, so a dropped comp lands as the topmost layer. Anchors after the
 * last existing `</Sequence>`, else inside the root `<AbsoluteFill>` (opening a self-closing
 * one up); null when neither anchor exists — that shape needs the code editor.
 */
export function insertNestedSequence(
  file: string,
  files: FileSet,
  opts: { varName: string; from: number; durationInFrames: number; importFrom?: string },
): InsertResult | null {
  const text = files[file];
  if (text === undefined) return null;
  const masked = mask(text);
  const block = (ind: string) =>
    `${ind}<Sequence from={${Math.round(opts.from)}} durationInFrames={${Math.round(opts.durationInFrames)}}>\n` +
    `${ind}  <Nested comp={${opts.varName}} />\n` +
    `${ind}</Sequence>`;
  const indentOf = (offset: number) => {
    const ls = text.lastIndexOf("\n", offset - 1) + 1;
    return (/^[ \t]*/.exec(text.slice(ls, offset)) ?? [""])[0];
  };

  const edits: TextEdit[] = [];
  let anchor: number;
  const occs = parseSequences(file, files);
  const last = occs[occs.length - 1];
  if (last) {
    anchor = last.closeEnd ?? last.end;
    edits.push({ start: anchor, end: anchor, text: `\n\n${block(indentOf(last.start))}` });
  } else {
    const idx = findTag(masked, "AbsoluteFill", 0, masked.length);
    const tag = idx === -1 ? null : componentTag(masked, idx, masked.length);
    if (!tag) return null;
    const indent = indentOf(idx);
    if (selfCloses(masked, tag.end)) {
      anchor = tag.insertAt;
      edits.push({
        start: tag.insertAt,
        end: tag.end + 1,
        text: `>\n${block(indent + "  ")}\n${indent}</AbsoluteFill>`,
      });
    } else {
      const close = masked.indexOf("</AbsoluteFill", tag.end);
      if (close === -1) return null;
      anchor = text.lastIndexOf("\n", close - 1) + 1;
      edits.push({ start: anchor, end: anchor, text: `${block(indent + "  ")}\n` });
    }
  }
  // the JSX needs Sequence/Nested in scope too — a fresh scaffold only imports AbsoluteFill
  const needs: [string, string][] = [
    ["Sequence", "framediff"],
    ["Nested", "framediff"],
    ...(opts.importFrom ? ([[opts.varName, opts.importFrom]] as [string, string][]) : []),
  ];
  for (const [name, module] of needs) {
    const imp = importEdit(file, files, name, module);
    if (imp) {
      edits.push(imp);
      if (imp.start <= anchor) anchor += imp.text.length;
    }
  }
  return { file, text: applyTextEdits(text, edits), at: anchor };
}

/** Add `"key": varName,` to the exported COMPOSITIONS registry object, plus the import. */
function registryObjectStart(masked: string, declarationStart: number, declarationEnd: number): number | null {
  if (masked[declarationStart] === "{") return declarationStart;
  const expression = masked.slice(declarationStart, declarationEnd);
  const wrapper = /^defineCompositionRegistry\s*\(/.exec(expression);
  if (!wrapper) return null;
  const objectOffset = expression.indexOf("{", wrapper[0].length);
  return objectOffset < 0 ? null : declarationStart + objectOffset;
}

export function insertRegistryEntry(
  configFile: string,
  files: FileSet,
  opts: { key: string; varName: string; importFrom: string },
): InsertResult | null {
  const text = files[configFile];
  if (text === undefined) return null;
  const masked = mask(text);
  const decl = findDecl("COMPOSITIONS", configFile, { [configFile]: text });
  if (!decl) return null;
  const objStart = registryObjectStart(masked, decl.s, decl.e);
  if (objStart == null) return null;
  const objEnd = matching(masked, objStart, "{", "}");
  if (objEnd == null) return null;
  const lineStart = text.lastIndexOf("\n", objEnd - 1) + 1;
  const closingLineIsBare = /^\s*$/.test(text.slice(lineStart, objEnd));
  let previousToken = objEnd - 1;
  while (previousToken > decl.s && /\s/.test(masked[previousToken])) previousToken--;
  const hasEntries = previousToken > objStart;
  const needsComma = hasEntries && masked[previousToken] !== ",";
  const hasClosingWhitespace = previousToken + 1 < objEnd;
  const entryEdit: TextEdit = closingLineIsBare
    ? { start: lineStart, end: lineStart, text: `  "${opts.key}": ${opts.varName},\n` }
    : { start: objEnd, end: objEnd, text: `${hasClosingWhitespace ? "" : " "}"${opts.key}": ${opts.varName}, ` };
  const edits: TextEdit[] = [entryEdit];
  let anchor = entryEdit.start;
  if (needsComma) {
    const commaAt = previousToken + 1;
    edits.push({ start: commaAt, end: commaAt, text: "," });
    if (commaAt <= anchor) anchor += 1;
  }
  const imp = importEdit(configFile, files, opts.varName, opts.importFrom);
  if (imp) {
    edits.push(imp);
    if (imp.start <= anchor) anchor += imp.text.length;
  }
  return { file: configFile, text: applyTextEdits(text, edits), at: anchor };
}

/** Remove `"key": varName,` from the COMPOSITIONS registry object, and the import that fed
 *  it when nothing else in the file still uses the name. Null when the entry isn't found. */
export function removeRegistryEntry(configFile: string, files: FileSet, varName: string): InsertResult | null {
  const text = files[configFile];
  if (text === undefined) return null;
  const masked = mask(text);
  const decl = findDecl("COMPOSITIONS", configFile, { [configFile]: text });
  if (!decl) return null;
  const objStart = registryObjectStart(masked, decl.s, decl.e);
  if (objStart == null) return null;
  const objEnd = matching(masked, objStart, "{", "}");
  if (objEnd == null) return null;

  // the entry's value is the bare identifier — find it inside the object literal
  const word = new RegExp(`\\b${varName.replace(/\$/g, "\\$")}\\b`, "g");
  word.lastIndex = objStart;
  const hit = word.exec(masked);
  if (!hit || hit.index >= objEnd) return null;

  // walk back over `:`, whitespace, and the (quoted or bare) key
  let s = hit.index;
  while (s > objStart && /\s/.test(masked[s - 1])) s--;
  if (masked[s - 1] !== ":") return null;
  s--;
  while (s > objStart && /\s/.test(masked[s - 1])) s--;
  if (masked[s - 1] === '"' || masked[s - 1] === "'") {
    const quote = masked[s - 1];
    s = masked.lastIndexOf(quote, s - 2);
  } else {
    while (s > objStart && /[\w$]/.test(masked[s - 1])) s--;
  }
  let e = hit.index + varName.length;
  const trailing = /^\s*,/.exec(masked.slice(e, objEnd));
  if (trailing) e += trailing[0].length;
  else {
    const previousComma = masked.slice(objStart, s).lastIndexOf(",");
    if (previousComma !== -1) s = objStart + previousComma;
  }
  // swallow the whole line when the entry is alone on it
  const lineStart = text.lastIndexOf("\n", s - 1) + 1;
  const lineBreak = text.indexOf("\n", e);
  if (lineBreak !== -1 && /^\s*$/.test(text.slice(lineStart, s)) && /^\s*$/.test(text.slice(e, lineBreak))) {
    s = lineStart;
    e = lineBreak + 1;
  }
  let next = text.slice(0, s) + text.slice(e);

  // the import goes too, unless the name is still used outside it (another alias key, say)
  const escaped = varName.replace(/\$/g, "\\$");
  const nextMasked = mask(next);
  const named = /\bimport\s+\{([^}]*)\}\s*from\s*["'][^"'\n]*["'];?[ \t]*\n?/g;
  for (let m = named.exec(nextMasked); m; m = named.exec(nextMasked)) {
    const open = m.index + m[0].indexOf("{");
    const close = m.index + m[0].indexOf("}");
    const specifiers = next.slice(open + 1, close).split(",").map((entry) => entry.trim()).filter(Boolean);
    if (!specifiers.includes(varName)) continue;
    const without = nextMasked.slice(0, m.index) + nextMasked.slice(m.index + m[0].length);
    if (new RegExp(`\\b${escaped}\\b`).test(without)) break; // still referenced — keep it
    next = specifiers.length === 1
      ? next.slice(0, m.index) + next.slice(m.index + m[0].length)
      : `${next.slice(0, open + 1)} ${specifiers.filter((entry) => entry !== varName).join(", ")} ${next.slice(close)}`;
    break;
  }
  return { file: configFile, text: next, at: Math.min(s, next.length) };
}

/** Files (beyond `ignore`) whose code still references the export — comments and strings
 *  don't count. The delete guard: a comp nested somewhere can't be removed out from under it. */
export function compReferenceFiles(varName: string, files: FileSet, ignore: string[]): string[] {
  const word = new RegExp(`\\b${varName.replace(/\$/g, "\\$")}\\b`);
  return Object.entries(files)
    .filter(([file]) => !ignore.includes(file))
    .filter(([, text]) => word.test(mask(text)))
    .map(([file]) => file);
}

/** Toggle `library: true` inside the comp export's `meta: { … }` — one literal, in place. */
export function setCompLibrary(compId: string, files: FileSet, on: boolean): InsertResult | null {
  const exp = findCompExport(compId, files);
  if (!exp) return null;
  const text = files[exp.file];
  const masked = mask(text);
  const metaHit = drill(masked, exp.objStart, "meta");
  if (!metaHit || metaHit.e > exp.objEnd || masked[metaHit.s] !== "{") return null;
  const lib = drill(masked, metaHit.s, "library");
  if (on) {
    if (lib) return { file: exp.file, text: text.slice(0, lib.s) + "true" + text.slice(lib.e), at: lib.s };
    const at = metaHit.s + 1;
    return { file: exp.file, text: `${text.slice(0, at)} library: true,${text.slice(at)}`, at };
  }
  if (!lib) return { file: exp.file, text, at: metaHit.s };
  let s = masked.lastIndexOf("library", lib.s);
  let e = lib.e;
  const trailing = /^\s*,\s?/.exec(text.slice(e));
  if (trailing) e += trailing[0].length;
  else {
    const before = masked.slice(metaHit.s, s);
    const pc = before.lastIndexOf(",");
    if (pc !== -1) s = metaHit.s + pc;
  }
  return { file: exp.file, text: text.slice(0, s) + text.slice(e), at: s };
}

/** Upsert `render: { from, to }` inside the comp export's `meta: { … }`; null removes it
 *  (the window is back to the whole comp). Mirrors setCompLibrary. */
export function setCompRenderWindow(
  compId: string,
  files: FileSet,
  window: { from: number; to: number } | null,
): InsertResult | null {
  const exp = findCompExport(compId, files);
  if (!exp) return null;
  const text = files[exp.file];
  const masked = mask(text);
  const metaHit = drill(masked, exp.objStart, "meta");
  if (!metaHit || metaHit.e > exp.objEnd || masked[metaHit.s] !== "{") return null;
  const hit = drill(masked, metaHit.s, "render");
  if (window) {
    const literal = `{ from: ${window.from}, to: ${window.to} }`;
    if (hit) return { file: exp.file, text: text.slice(0, hit.s) + literal + text.slice(hit.e), at: hit.s };
    const at = metaHit.s + 1;
    return { file: exp.file, text: `${text.slice(0, at)} render: ${literal},${text.slice(at)}`, at };
  }
  if (!hit) return { file: exp.file, text, at: metaHit.s };
  let s = masked.lastIndexOf("render", hit.s);
  let e = hit.e;
  const trailing = /^\s*,\s?/.exec(text.slice(e));
  if (trailing) e += trailing[0].length;
  else {
    const before = masked.slice(metaHit.s, s);
    const pc = before.lastIndexOf(",");
    if (pc !== -1) s = metaHit.s + pc;
  }
  return { file: exp.file, text: text.slice(0, s) + text.slice(e), at: s };
}

/** Rewrite a verbatim-copied single-comp file for its new identity: id, meta.file, the
 *  export's name, and — when `library` is set — `library: true`; otherwise the copy keeps
 *  the source's placement. A `generative({ … })` recipe forks instead: same prompt and
 *  params, top-level `file:` rewritten, `take:` reset — the fork has no takes of its own.
 *  Null when the text isn't a clean single-comp file. */
export function transformCopiedCompText(
  text: string,
  o: { oldId: string; newId: string; newVar: string; newFile: string; library?: boolean },
): string | null {
  const files: FileSet = { [o.newFile]: text };
  const exps = compExportsIn(o.newFile, files);
  if (exps.length !== 1 || exps[0].id !== o.oldId) return null;
  const exp = exps[0];
  const masked = mask(text);
  const edits: TextEdit[] = [];
  const idHit = drill(masked, exp.objStart, "id")!;
  edits.push({ start: idHit.s, end: idHit.e, text: `"${o.newId}"` });
  if (exp.shape === "generative") {
    const fileHit = drill(masked, exp.objStart, "file");
    if (fileHit) edits.push({ start: fileHit.s, end: fileHit.e, text: `"${o.newFile}"` });
    else edits.push({ start: exp.objStart + 1, end: exp.objStart + 1, text: ` file: "${o.newFile}",` });
    const takeHit = drill(masked, exp.objStart, "take");
    if (takeHit) edits.push({ start: takeHit.s, end: takeHit.e, text: "0" });
  }
  const metaHit = drill(masked, exp.objStart, "meta");
  if (exp.shape === "object" && metaHit && masked[metaHit.s] === "{") {
    const fileHit = drill(masked, metaHit.s, "file");
    if (fileHit) edits.push({ start: fileHit.s, end: fileHit.e, text: `"${o.newFile}"` });
    if (o.library) {
      const libHit = drill(masked, metaHit.s, "library");
      if (libHit) edits.push({ start: libHit.s, end: libHit.e, text: "true" });
      else edits.push({ start: metaHit.s + 1, end: metaHit.s + 1, text: ` library: true,` });
    }
  }
  const declRe = new RegExp(`(\\bexport\\s+const\\s+)${exp.varName.replace(/\$/g, "\\$")}\\b`);
  const dm = declRe.exec(masked);
  if (dm) {
    const at = dm.index + dm[1].length;
    edits.push({ start: at, end: at + exp.varName.length, text: o.newVar });
  }
  return applyTextEdits(text, edits);
}
