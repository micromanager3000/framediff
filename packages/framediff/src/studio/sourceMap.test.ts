// Safety-critical: these functions rewrite user source files, so every span they report must
// point at exactly the token the author typed. Fixtures are the REAL example sources, verbatim
// (examples/hero-lower-third/src/*), plus synthetic edge cases for the scanner.

import { describe, expect, it } from "vitest";
import {
  compExportCount,
  compReferenceFiles,
  findCompExport,
  findCompExportName,
  findStringLiteral,
  insertNestedSequence,
  insertRegistryEntry,
  relModule,
  removeRegistryEntry,
  setCompLibrary,
  transformCopiedCompText,
  parseNumericArrayProperty,
  parseObjectArray,
  parseObjectArrayStrings,
  parseSequences,
  pinGradeLayerToClip,
  resolveExpr,
  rewriteLiteral,
  rewriteStringLiteral,
  setSequenceGrade,
  type FileSet,
  type LiteralLoc,
  type ResolvedExpr,
} from "./sourceMap";

// ---------------------------------------------------------------------------
// Fixtures — examples/hero-lower-third/src, copied verbatim
// ---------------------------------------------------------------------------

const HERO = `// The assembly — a composition of compositions:
//   Main ▸ HeroFootage (the AE render + its music, as a nested comp)
//        ▸ LowerThird  (nested comp, windowed 180→348)
//        ▸ EndCard     (nested comp incl. its shine sting, windowed 953→1091)
// Timing matches lt-marketing/src/HeroWithLowerThird.tsx frame-for-frame.

import { AbsoluteFill, Sequence, Nested } from "framediff";
import { heroFootageComp, heroRebuiltComp, lowerThirdComp, endCardComp } from "./comps";
import { TL, VIDEO_FRAMES } from "./constants";

/** ?hero=rebuilt swaps the AE render for the rebuilt-from-raw-footage comp. */
const HERO_SOURCE =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("hero") === "rebuilt"
    ? heroRebuiltComp
    : heroFootageComp;

export function Main() {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <Sequence from={0} durationInFrames={VIDEO_FRAMES}>
        <Nested comp={HERO_SOURCE} />
      </Sequence>

      <Sequence from={TL.lowerThird.from} durationInFrames={TL.lowerThird.dur}>
        <Nested comp={lowerThirdComp} />
      </Sequence>

      <Sequence from={TL.endCard.from} durationInFrames={TL.endCard.dur}>
        <Nested comp={endCardComp} />
      </Sequence>
    </AbsoluteFill>
  );
}
`;

const COMPS = `// Every piece is a composition. Main nests these; each is also individually openable in the
// Studio (hero / lower-third / end-card / excerpt) and individually bakeable.

import type { CompositionConfig } from "framediff";
import { Nested } from "framediff";
import { HeroFootage } from "./HeroFootage";
import { HeroRebuilt, REBUILT_FRAMES } from "./HeroRebuilt";
import { LowerThird } from "./LowerThird";
import { EndCard } from "./EndCard";
import { FPS, TL, VIDEO_FRAMES } from "./constants";

/** The hero footage — the AE-graded render as a composition (video + its music). */
export const heroFootageComp: CompositionConfig = {
  id: "HeroFootage",
  component: HeroFootage,
  width: 1920,
  height: 1080,
  fps: FPS,
  durationInFrames: VIDEO_FRAMES,
};

/** The hero rebuilt from raw footage + the AEP-recovered grade (approximate, switchable). */
export const heroRebuiltComp: CompositionConfig = {
  id: "HeroRebuilt",
  component: HeroRebuilt,
  width: 1920,
  height: 1080,
  fps: FPS,
  durationInFrames: REBUILT_FRAMES,
};

/** The lower-third as its own composition (props bound here — its "exposed props"). */
export const lowerThirdComp: CompositionConfig = {
  id: "LowerThird",
  component: () => (
    <LowerThird
      text="Rendered in realtime at 1080p at 30 FPS in"
      brand="LightTwist"
      durationInFrames={TL.lowerThird.dur}
    />
  ),
  width: 1920,
  height: 1080,
  fps: FPS,
  durationInFrames: TL.lowerThird.dur,
};

/** The end card as its own composition — the shine sting lives inside it. */
export const endCardComp: CompositionConfig = {
  id: "EndCard",
  component: () => <EndCard durationInFrames={TL.endCard.dur} />,
  width: 1920,
  height: 1080,
  fps: FPS,
  durationInFrames: TL.endCard.dur,
};

/** Clipping demo on the real engine: a 10s excerpt playing the hero's seconds 20→30. */
export const heroExcerptComp: CompositionConfig = {
  id: "HeroExcerpt",
  component: () => <Nested comp={heroFootageComp} trimStart={20} />,
  width: 1920,
  height: 1080,
  fps: FPS,
  durationInFrames: Math.round(10 * FPS),
};
`;

const CONSTANTS = `// Values ported 1:1 from lt-marketing (the Remotion project that produced the reference video).

export const FPS = 24000 / 1001; // 23.976 — matches the source mp4 exactly

export const VIDEO_FRAMES = 971; // hero.mp4 — 40.5s of footage
export const END_FRAMES = Math.round(5 * FPS); // 5s outro ≈ 120 frames
export const CROSSFADE = 18; // end card enters over the last ~0.75s of footage

export const TL = {
  durationInFrames: VIDEO_FRAMES + END_FRAMES, // 1091 ≈ 45.5s
  lowerThird: { from: 180, dur: 168 }, // ~7.5s → ~14.5s
  endCard: { from: VIDEO_FRAMES - CROSSFADE, dur: END_FRAMES + CROSSFADE }, // 953 → 1091
  audioFadeStart: VIDEO_FRAMES - 24, // hero audio fades out over the last second of footage
} as const;

// lt-marketing/src/constants.ts — COLORS + FONTS, verbatim (subset used by this piece).
export const COLORS = {
  bg: "#0a0a0f",
  accent: "#6c5ce7",
  accentLight: "#a29bfe",
  accentWarm: "#fd79a8",
  white: "#ffffff",
} as const;

export const FONTS = {
  heading: "SF Pro Display, -apple-system, Helvetica Neue, sans-serif",
} as const;
`;

const HERO_FILE = "src/HeroWithLowerThird.tsx";
const COMPS_FILE = "src/comps.tsx";
const CONSTANTS_FILE = "src/constants.ts";

const files: FileSet = {
  [HERO_FILE]: HERO,
  [COMPS_FILE]: COMPS,
  [CONSTANTS_FILE]: CONSTANTS,
};

/** Assert literal-ness, then hand back the narrowed loc. */
function lit(r: ResolvedExpr): LiteralLoc {
  expect(r.kind).toBe("literal");
  return r as LiteralLoc;
}

/** The exact source text a LiteralLoc points at — what rewriteLiteral would splice over. */
function sliceOf(fs: FileSet, loc: LiteralLoc): string {
  return fs[loc.file].slice(loc.start, loc.end);
}

// ---------------------------------------------------------------------------
// parseSequences on the real assembly
// ---------------------------------------------------------------------------

describe("parseSequences: HeroWithLowerThird.tsx (real fixture)", () => {
  const seqs = parseSequences(HERO_FILE, files);

  it("finds exactly the 3 real sequences (none in comments/strings)", () => {
    expect(seqs).toHaveLength(3);
    expect(seqs.map((s) => s.index)).toEqual([0, 1, 2]);
    for (const s of seqs) {
      expect(HERO.slice(s.start, s.start + 9)).toBe("<Sequence");
      expect(HERO[s.end - 1]).toBe(">");
      expect(s.name).toBeUndefined();
    }
  });

  it("#0: from is an in-file literal 0; duration chains VIDEO_FRAMES → 971 in constants", () => {
    const from = lit(seqs[0].from);
    expect(from.value).toBe(0);
    expect(from.file).toBe(HERO_FILE);
    expect(sliceOf(files, from)).toBe("0");
    expect(from.start).toBeGreaterThan(HERO.indexOf("<Sequence")); // inside the JSX, not line 1

    const dur = lit(seqs[0].duration);
    expect(dur.value).toBe(971);
    expect(dur.file).toBe(CONSTANTS_FILE);
    expect(sliceOf(files, dur)).toBe("971");
    expect(seqs[0].nested).toEqual({ compExpr: "HERO_SOURCE" });
  });

  it("#1: TL.lowerThird.from/dur drill to the 180 and 168 literals in constants", () => {
    const from = lit(seqs[1].from);
    expect(from).toMatchObject({ file: CONSTANTS_FILE, value: 180 });
    expect(sliceOf(files, from)).toBe("180");
    // it's THE 180 in the TL object, not some other token
    expect(from.start).toBe(CONSTANTS.indexOf("from: 180") + "from: ".length);

    const dur = lit(seqs[1].duration);
    expect(dur).toMatchObject({ file: CONSTANTS_FILE, value: 168 });
    expect(sliceOf(files, dur)).toBe("168");
    expect(seqs[1].nested).toEqual({ compExpr: "lowerThirdComp" });
  });

  it("#2: endCard from/dur are arithmetic → computed 953 / 138", () => {
    expect(seqs[2].from).toEqual({ kind: "computed", expr: "TL.endCard.from", value: 953 });
    // END_FRAMES = Math.round(5 * 24000/1001) = 120; dur = 120 + 18 = 138
    expect(seqs[2].duration).toEqual({ kind: "computed", expr: "TL.endCard.dur", value: 138 });
    expect(seqs[2].nested).toEqual({ compExpr: "endCardComp" });
  });
});

describe("parseSequences: comps.tsx", () => {
  it("a <Nested> outside any <Sequence> (heroExcerptComp) is not a sequence", () => {
    expect(parseSequences(COMPS_FILE, files)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// resolveExpr semantics
// ---------------------------------------------------------------------------

describe("resolveExpr: literals through identifier chains", () => {
  it("bare identifier → the literal it was initialized from", () => {
    const r = lit(resolveExpr("VIDEO_FRAMES", COMPS_FILE, files));
    expect(r).toMatchObject({ file: CONSTANTS_FILE, value: 971 });
    expect(sliceOf(files, r)).toBe("971");
  });

  it("dotted path through an `as const` object → the leaf literal", () => {
    const r = lit(resolveExpr("TL.lowerThird.dur", COMPS_FILE, files));
    expect(r).toMatchObject({ file: CONSTANTS_FILE, value: 168 });
    expect(sliceOf(files, r)).toBe("168");
  });

  it("dotted path landing on arithmetic → computed", () => {
    expect(resolveExpr("TL.durationInFrames", HERO_FILE, files)).toEqual({
      kind: "computed",
      expr: "TL.durationInFrames",
      value: 1091,
    });
  });
});

describe("resolveExpr: computed expressions", () => {
  it("VIDEO_FRAMES + END_FRAMES evaluates to 1091", () => {
    expect(resolveExpr("VIDEO_FRAMES + END_FRAMES", CONSTANTS_FILE, files)).toEqual({
      kind: "computed",
      expr: "VIDEO_FRAMES + END_FRAMES",
      value: 1091,
    });
  });

  it("Math.round(10 * FPS) → 240 (the heroExcerpt duration)", () => {
    const r = resolveExpr("Math.round(10 * FPS)", COMPS_FILE, files);
    expect(r).toEqual({ kind: "computed", expr: "Math.round(10 * FPS)", value: 240 });
  });

  it("division: 24000 / 1001 and FPS both ≈ 23.976", () => {
    const direct = resolveExpr("24000 / 1001", HERO_FILE, files);
    expect(direct.kind).toBe("computed");
    expect(direct.value).toBeCloseTo(23.976, 3);
    // FPS resolves to a division, not a literal — so it must come back computed
    const fps = resolveExpr("FPS", COMPS_FILE, files);
    expect(fps.kind).toBe("computed");
    expect(fps.value).toBeCloseTo(23.976, 3);
  });

  it("unary minus", () => {
    expect(resolveExpr("-CROSSFADE", CONSTANTS_FILE, files).value).toBe(-18);
    expect(resolveExpr("-(2 + 3) * 4", HERO_FILE, files).value).toBe(-20);
  });

  it("Math.min/max/floor/ceil", () => {
    expect(resolveExpr("Math.min(4, Math.max(1, 2))", HERO_FILE, files).value).toBe(2);
    expect(resolveExpr("Math.floor(7 / 2)", HERO_FILE, files).value).toBe(3);
    expect(resolveExpr("Math.ceil(7 / 2)", HERO_FILE, files).value).toBe(4);
  });

  it("the same identifier twice in one expression (diamond) still resolves", () => {
    expect(resolveExpr("END_FRAMES + END_FRAMES", CONSTANTS_FILE, files).value).toBe(240);
  });

  it("unresolvable → computed with undefined value", () => {
    // HERO_SOURCE's initializer is a ternary — outside the grammar
    expect(resolveExpr("HERO_SOURCE", HERO_FILE, files)).toEqual({
      kind: "computed",
      expr: "HERO_SOURCE",
      value: undefined,
    });
    expect(resolveExpr("NO_SUCH_NAME", HERO_FILE, files).value).toBeUndefined();
    expect(resolveExpr("foo ? 1 : 2", HERO_FILE, files).value).toBeUndefined();
  });

  it("a bare number with no in-file anchor is computed (no span to edit)", () => {
    expect(resolveExpr("42", HERO_FILE, files)).toEqual({ kind: "computed", expr: "42", value: 42 });
  });
});

// ---------------------------------------------------------------------------
// rewriteLiteral — the actual editing path
// ---------------------------------------------------------------------------

describe("rewriteLiteral", () => {
  it("round-trips TL.lowerThird.from 180 → 204 without touching anything else", () => {
    const loc = lit(resolveExpr("TL.lowerThird.from", HERO_FILE, files));
    const { file, text } = rewriteLiteral(files, loc, 204);
    expect(file).toBe(CONSTANTS_FILE);

    const next: FileSet = { ...files, [file]: text };
    const seqs = parseSequences(HERO_FILE, next);

    const from = lit(seqs[1].from);
    expect(from.value).toBe(204);
    expect(sliceOf(next, from)).toBe("204");
    // neighbors untouched
    expect(lit(seqs[1].duration).value).toBe(168);
    expect(lit(seqs[0].duration).value).toBe(971);
    // endCard.from = VIDEO_FRAMES - CROSSFADE — unaffected by the lowerThird edit
    expect(seqs[2].from.value).toBe(953);
    expect(seqs[2].duration.value).toBe(138);
    // originals never mutated
    expect(files[CONSTANTS_FILE]).toBe(CONSTANTS);
  });

  it("formats compactly: integers plain, decimals trimmed to ≤3 places", () => {
    const tiny: FileSet = { "a.ts": "export const X = 1;\n" };
    const loc = lit(resolveExpr("X", "a.ts", tiny));
    expect(rewriteLiteral(tiny, loc, 10).text).toBe("export const X = 10;\n");
    expect(rewriteLiteral(tiny, loc, 2.5).text).toBe("export const X = 2.5;\n");
    expect(rewriteLiteral(tiny, loc, 23.976023976).text).toBe("export const X = 23.976024;\n");
    expect(rewriteLiteral(tiny, loc, 1.2).text).toBe("export const X = 1.2;\n");
  });

  it("round-trips a decimal", () => {
    const tiny: FileSet = { "a.ts": "export const X = 1;\n" };
    const first = lit(resolveExpr("X", "a.ts", tiny));
    const next: FileSet = { "a.ts": rewriteLiteral(tiny, first, 0.125).text };
    expect(lit(resolveExpr("X", "a.ts", next)).value).toBe(0.125);
  });
});

// ---------------------------------------------------------------------------
// Scanner edge cases
// ---------------------------------------------------------------------------

const EDGE = `// decoy: <Sequence from={999} durationInFrames={999}>
/* block decoy <Sequence from={888}> */
import { FPS } from "./constants";
export const SNIPPET = "<Sequence from={777}>";
export const LABEL = "from: not an attr";
export const BOX = { pad: 4, inner: { gap: 2 } } as const;
export function Edge() {
  return (
    <>
      <Sequence
        name="styled"
        from={BOX.inner.gap}
        durationInFrames={Math.round(10 * FPS)}
        style={{ margin: 4, nested: { deep: 1 } }}
      >
        <Nested comp={someComp} trimStart={20} />
      </Sequence>
      <Sequence from={-BOX.pad} />
      <Sequence>
        <div>plain</div>
      </Sequence>
      <Sequence from={/* mid */ 7} durationInFrames={(3 + 4) * 2}>
        <Nested comp={other.deep} />
      </Sequence>
    </>
  );
}
`;

const edgeFiles: FileSet = { "src/edge.tsx": EDGE, [CONSTANTS_FILE]: CONSTANTS };

describe("parseSequences: edge cases", () => {
  const seqs = parseSequences("src/edge.tsx", edgeFiles);

  it("ignores <Sequence in comments and strings — only the 4 real tags", () => {
    expect(seqs).toHaveLength(4);
    for (const s of seqs) {
      expect(s.from.value).not.toBe(999);
      expect(s.from.value).not.toBe(888);
      expect(s.from.value).not.toBe(777);
    }
  });

  it("survives nested braces in attrs (style={{...}}) and multi-line tags", () => {
    const s = seqs[0];
    expect(s.name).toBe("styled");
    // from drills BOX.inner.gap through nested object braces + as const, in the same file
    const from = lit(s.from);
    expect(from).toMatchObject({ file: "src/edge.tsx", value: 2 });
    expect(sliceOf(edgeFiles, from)).toBe("2");
    // duration pulls FPS from the constants fixture
    expect(s.duration).toEqual({ kind: "computed", expr: "Math.round(10 * FPS)", value: 240 });
    // nested with trimStart: the 20 is editable in place
    expect(s.nested?.compExpr).toBe("someComp");
    const trim = lit(s.nested!.trimStart!);
    expect(trim).toMatchObject({ file: "src/edge.tsx", value: 20 });
    expect(sliceOf(edgeFiles, trim)).toBe("20");
  });

  it("self-closing tag: unary-minus from, no nested", () => {
    expect(seqs[1].from).toEqual({ kind: "computed", expr: "-BOX.pad", value: -4 });
    expect(seqs[1].nested).toBeUndefined();
  });

  it("missing attrs get the documented placeholders", () => {
    expect(seqs[2].from).toEqual({ kind: "computed", expr: "0", value: 0 });
    expect(seqs[2].duration).toEqual({ kind: "computed", expr: "Infinity", value: undefined });
    expect(seqs[2].nested).toBeUndefined(); // a <div> is not a <Nested>
  });

  it("comment inside an attr expr does not shift the literal span; parens in duration", () => {
    const from = lit(seqs[3].from);
    expect(from.value).toBe(7);
    expect(sliceOf(edgeFiles, from)).toBe("7");
    expect(seqs[3].duration.value).toBe(14);
    expect(seqs[3].nested?.compExpr).toBe("other.deep");
  });
});

// ---------------------------------------------------------------------------
// Data-backed timelines
// ---------------------------------------------------------------------------

const DATA = `export interface Shot { name: string; from: number; durationInFrames: number; trimStart: number; playbackRate: number; }
export const HERO_SHOTS: Shot[] = [
  { name: "open", from: 0, durationInFrames: 46, trimStart: 0.719, playbackRate: 1.432 },
  { name: "news_a", from: 145, durationInFrames: 119, trimStart: 0.756, playbackRate: 1.0 },
];
export const CAMERA_MOVES = [
  { name: "news_a", endCameraX: -0.2, planeRotYDeg: -7, planeRotZDeg: -0.5 },
];
export const CORNERS: Record<string, [number, number][]> = {
  news_a: [[0.0287, -0.1001], [0.9885, -0.1134], [1.0004, 1.0612], [-0.0005, 1.0737]],
} as const;
`;

describe("parseObjectArray", () => {
  const dataFiles: FileSet = { "src/data.ts": DATA };

  it("maps keyed object-array fields back to typed const literals", () => {
    const rows = parseObjectArray("src/data.ts", dataFiles, "HERO_SHOTS", [
      "from",
      "durationInFrames",
      "trimStart",
      "playbackRate",
    ]);
    expect(rows.map((r) => r.key)).toEqual(["open", "news_a"]);
    const news = rows[1];
    expect(lit(news.fields.from)).toMatchObject({ file: "src/data.ts", value: 145 });
    expect(sliceOf(dataFiles, lit(news.fields.durationInFrames))).toBe("119");
    expect(sliceOf(dataFiles, lit(news.fields.trimStart))).toBe("0.756");
    expect(sliceOf(dataFiles, lit(news.fields.playbackRate))).toBe("1.0");
  });

  it("keeps direct negative object-array literals editable", () => {
    const rows = parseObjectArray("src/data.ts", dataFiles, "CAMERA_MOVES", [
      "endCameraX",
      "planeRotYDeg",
      "planeRotZDeg",
    ]);
    const move = rows[0];
    expect(lit(move.fields.endCameraX)).toMatchObject({ file: "src/data.ts", value: -0.2 });
    expect(sliceOf(dataFiles, lit(move.fields.endCameraX))).toBe("-0.2");
    expect(sliceOf(dataFiles, lit(move.fields.planeRotYDeg))).toBe("-7");
    expect(sliceOf(dataFiles, lit(move.fields.planeRotZDeg))).toBe("-0.5");
  });

  it("maps and safely rewrites string fields in object arrays", () => {
    const rows = parseObjectArrayStrings("src/data.ts", dataFiles, "HERO_SHOTS", ["name"]);
    const name = rows[1].fields.name;

    expect(name).toMatchObject({ kind: "string-literal", value: "news_a", quote: '"' });
    expect(rewriteStringLiteral(dataFiles, name, 'News: "Today"').text).toContain('name: "News: \\"Today\\""');
  });

  it("maps numeric object-array properties such as corner pins", () => {
    const nums = parseNumericArrayProperty("src/data.ts", dataFiles, "CORNERS", "news_a");
    expect(nums.map((n) => n.value)).toEqual([0.0287, -0.1001, 0.9885, -0.1134, 1.0004, 1.0612, -0.0005, 1.0737]);
    expect(sliceOf(dataFiles, nums[1])).toBe("-0.1001");
  });
});

// ---------------------------------------------------------------------------
// findStringLiteral
// ---------------------------------------------------------------------------

describe("findStringLiteral", () => {
  it("unique match → span inside the quotes", () => {
    const hit = findStringLiteral(COMPS_FILE, files, "LightTwist");
    expect(hit).not.toBeNull();
    expect(COMPS.slice(hit!.start, hit!.end)).toBe("LightTwist");
    expect(COMPS[hit!.start - 1]).toBe('"');
    expect(COMPS[hit!.end]).toBe('"');
  });

  it("single-quoted strings match too", () => {
    const fs: FileSet = { "q.ts": "export const q = 'solo';\n" };
    const hit = findStringLiteral("q.ts", fs, "solo");
    expect(fs["q.ts"].slice(hit!.start, hit!.end)).toBe("solo");
  });

  it("ambiguous (2+ occurrences) → null", () => {
    // "framediff" appears in two import specifiers in comps.tsx
    expect(findStringLiteral(COMPS_FILE, files, "framediff")).toBeNull();
  });

  it("zero occurrences → null", () => {
    expect(findStringLiteral(COMPS_FILE, files, "definitely-not-here")).toBeNull();
  });

  it("a lookalike inside a comment is not a string literal", () => {
    const fs: FileSet = { "c.ts": '// "ghost"\nexport const g = 1;\n' };
    expect(findStringLiteral("c.ts", fs, "ghost")).toBeNull();
    // ...and a comment copy does not make a real one ambiguous
    const fs2: FileSet = { "d.ts": '// "dup"\nexport const s = "dup";\n' };
    const hit = findStringLiteral("d.ts", fs2, "dup");
    expect(hit).not.toBeNull();
    expect(hit!.start).toBeGreaterThan(fs2["d.ts"].indexOf("const"));
  });
});

// ---------------------------------------------------------------------------
// grade attrs on tags inside a <Sequence> (clip grades + floating grade layers)
// ---------------------------------------------------------------------------

describe("parseSequences · grade attrs", () => {
  const GRADED = `import { Sequence, GradedVideo, GradeLayer } from "framediff";
import { DESK_LOOK } from "./looks";

export function Lab() {
  return (
    <>
      <Sequence name="shot-a" from={0} durationInFrames={120}>
        <GradedVideo assetId="proxy-desk" grade={{ temperature: 0.18, saturation: 1.08, vignette: 0.3 }} lutIntensity={0.8} />
      </Sequence>
      <Sequence name="shot-b" from={120} durationInFrames={120}>
        <GradedVideo assetId="proxy-tripod" grade={DESK_LOOK} />
      </Sequence>
      <Sequence name="wash" from={60} durationInFrames={220}>
        <GradeLayer grade={{ temperature: -0.35, contrast: 0.08 }} />
      </Sequence>
      <Sequence name="opaque" from={280} durationInFrames={60}>
        <GradedVideo assetId="x" grade={someLook(name).grade} />
      </Sequence>
    </>
  );
}
`;
  const LOOKS = `export const DESK_LOOK = { exposure: 0.05, saturation: 0.9 };\n`;
  const fs: FileSet = { "Lab.tsx": GRADED, "looks.ts": LOOKS };
  const occs = parseSequences("Lab.tsx", fs);

  it("inline object grade → one literal per key, spans splice back", () => {
    const g = occs[0].grade!;
    expect(g.expr).toBeUndefined();
    const t = g.fields.temperature as LiteralLoc;
    expect(t.kind).toBe("literal");
    expect(t.value).toBe(0.18);
    expect(GRADED.slice(t.start, t.end)).toBe("0.18");
    const v = g.fields.vignette as LiteralLoc;
    expect(GRADED.slice(v.start, v.end)).toBe("0.3");
    // round-trip: rewriting the literal keeps the next parse pointing at the new token
    const { text } = rewriteLiteral(fs, t, 0.25);
    const again = parseSequences("Lab.tsx", { ...fs, "Lab.tsx": text });
    expect((again[0].grade!.fields.temperature as LiteralLoc).value).toBe(0.25);
  });

  it("bare lutIntensity attr resolves as a literal", () => {
    const li = occs[0].grade!.lutIntensity as LiteralLoc;
    expect(li.kind).toBe("literal");
    expect(li.value).toBe(0.8);
    expect(GRADED.slice(li.start, li.end)).toBe("0.8");
  });

  it("grade={CONST} chases each key into the defining file", () => {
    const g = occs[1].grade!;
    expect(g.expr).toBe("DESK_LOOK");
    const e = g.fields.exposure as LiteralLoc;
    expect(e.kind).toBe("literal");
    expect(e.file).toBe("looks.ts");
    expect(LOOKS.slice(e.start, e.end)).toBe("0.05");
    expect(g.fields.temperature).toBeUndefined(); // absent keys stay absent
  });

  it("a GradeLayer's grade parses the same way", () => {
    const g = occs[2].grade!;
    expect((g.fields.temperature as LiteralLoc).value).toBe(-0.35);
    expect((g.fields.contrast as LiteralLoc).value).toBe(0.08);
  });

  it("an unresolvable grade expr is kept as computed, not faked", () => {
    const g = occs[3].grade!;
    expect(g.expr).toBe("someLook(name).grade");
    expect(Object.keys(g.fields)).toHaveLength(0);
  });

  it("sequences without grade tags report no grade", () => {
    const plain = parseSequences("Lab.tsx", {
      "Lab.tsx": `<Sequence from={0} durationInFrames={10}><Video src="a.mp4" /></Sequence>`,
    });
    expect(plain[0].grade).toBeUndefined();
  });

  it("setSequenceGrade replaces an existing grade expression with an inline preset", () => {
    const next = setSequenceGrade("Lab.tsx", fs, 1, { temperature: -0.25, contrast: 0.14, saturation: 1.2 });
    expect(next).not.toBeNull();
    expect(next!.text).toContain('<GradedVideo assetId="proxy-tripod" grade={{ temperature: -0.25, contrast: 0.14, saturation: 1.2 }} />');
    const again = parseSequences("Lab.tsx", { ...fs, "Lab.tsx": next!.text });
    expect((again[1].grade!.fields.temperature as LiteralLoc).value).toBe(-0.25);
    expect((again[1].grade!.fields.saturation as LiteralLoc).value).toBe(1.2);
  });

  it("setSequenceGrade inserts a grade attr on a plain self-closing clip tag", () => {
    const plainFs: FileSet = {
      "Plain.tsx": `<Sequence name="plain" from={0} durationInFrames={10}>
  <GradedVideo assetId="x" />
</Sequence>`,
    };
    const next = setSequenceGrade("Plain.tsx", plainFs, 0, { exposure: 0.1, vignette: 0.35 });
    expect(next!.text).toContain('<GradedVideo assetId="x" grade={{ exposure: 0.1, vignette: 0.35 }} />');
  });

  it("pinGradeLayerToClip copies the floating grade to a clip and removes the layer sequence", () => {
    const next = pinGradeLayerToClip("Lab.tsx", fs, 2, 1, { temperature: -0.35, contrast: 0.08 });
    expect(next).not.toBeNull();
    expect(next!.text).not.toContain('name="wash"');
    expect(next!.text).toContain('<GradedVideo assetId="proxy-tripod" grade={{ temperature: -0.35, contrast: 0.08 }} />');
    const again = parseSequences("Lab.tsx", { ...fs, "Lab.tsx": next!.text });
    expect(again.map((o) => o.name)).toEqual(["shot-a", "shot-b", "opaque"]);
    expect((again[1].grade!.fields.temperature as LiteralLoc).value).toBe(-0.35);
  });
});

// ---------------------------------------------------------------------------
// Composition-level rewrites: nesting, registry entries, library flags, copies
// ---------------------------------------------------------------------------

const CONFIG = `import type { CompRegistry, StudioComposition } from "framediff";
import { Main } from "./HeroWithLowerThird";
import { FPS, TL } from "./constants";
import { heroFootageComp, lowerThirdComp, endCardComp } from "./comps";
import { gradeLabComp } from "./GradeLab";

export const composition: StudioComposition = {
  id: "HeroWithLowerThird",
  component: Main,
  width: 1920,
  height: 1080,
  fps: FPS,
  durationInFrames: TL.durationInFrames,
  meta: { kind: "edit", file: "src/HeroWithLowerThird.tsx" },
};

/** The Studio registry. */
export const COMPOSITIONS: CompRegistry = {
  main: composition,
  "lower-third": lowerThirdComp,
  "end-card": endCardComp,
  "grade-lab": gradeLabComp,
};
`;

const GRADELAB = `// A single-comp file — the clean verbatim-copy case.
import type { StudioComposition } from "framediff";
import { AbsoluteFill } from "framediff";
import { FPS } from "./constants";

export function GradeLab() {
  return <AbsoluteFill style={{ backgroundColor: "#111" }} />;
}

export const gradeLabComp: StudioComposition = {
  id: "GradeLab",
  component: GradeLab,
  width: 1920,
  height: 1080,
  fps: FPS,
  durationInFrames: 240,
  meta: { kind: "edit", file: "src/GradeLab.tsx", deps: ["src/constants.ts"], library: true },
};
`;

const EMPTY_COMP = `import type { StudioComposition } from "framediff";
import { AbsoluteFill } from "framediff";

export function TitleCard() {
  return <AbsoluteFill style={{ backgroundColor: "#000" }} />;
}

export const titleCardComp: StudioComposition = {
  id: "TitleCard",
  component: TitleCard,
  width: 1920,
  height: 1080,
  fps: 24000 / 1001,
  durationInFrames: 120,
  meta: { kind: "edit", file: "src/TitleCard.tsx" },
};
`;

const CONFIG_FILE = "src/config.ts";
const GRADELAB_FILE = "src/GradeLab.tsx";
const TITLE_FILE = "src/TitleCard.tsx";
const compFiles: FileSet = {
  [HERO_FILE]: HERO,
  [COMPS_FILE]: COMPS,
  [CONSTANTS_FILE]: CONSTANTS,
  [CONFIG_FILE]: CONFIG,
  [GRADELAB_FILE]: GRADELAB,
  [TITLE_FILE]: EMPTY_COMP,
};

describe("findCompExport / findCompExportName", () => {
  it("locates a single-comp file's export with sibling count 1", () => {
    const exp = findCompExport("GradeLab", compFiles)!;
    expect(exp.file).toBe(GRADELAB_FILE);
    expect(exp.varName).toBe("gradeLabComp");
    expect(exp.siblings).toBe(1);
  });

  it("counts siblings in a multi-comp file", () => {
    const exp = findCompExport("LowerThird", compFiles)!;
    expect(exp.file).toBe(COMPS_FILE);
    expect(exp.varName).toBe("lowerThirdComp");
    expect(exp.siblings).toBeGreaterThan(1);
  });

  it("findCompExportName agrees on the identifier", () => {
    expect(findCompExportName("EndCard", compFiles)).toMatchObject({ file: COMPS_FILE, varName: "endCardComp" });
  });
});

describe("relModule", () => {
  it("same directory", () => expect(relModule("src/A.tsx", "src/comps.tsx")).toBe("./comps"));
  it("into a subdirectory", () => expect(relModule("src/A.tsx", "src/gen/sky.gen.tsx")).toBe("./gen/sky.gen"));
  it("up out of a subdirectory", () => expect(relModule("src/gen/sky.gen.tsx", "src/comps.tsx")).toBe("../comps"));
});

describe("insertNestedSequence", () => {
  it("appends after the last </Sequence> with the file's indentation, plus the import", () => {
    const res = insertNestedSequence(HERO_FILE, compFiles, {
      varName: "gradeLabComp",
      from: 214,
      durationInFrames: 240,
      importFrom: "./GradeLab",
    })!;
    expect(res.text).toContain('import { gradeLabComp } from "./GradeLab";');
    expect(res.text).toContain("      <Sequence from={214} durationInFrames={240}>\n        <Nested comp={gradeLabComp} />\n      </Sequence>");
    // lands after the endCard sequence, before </AbsoluteFill>
    expect(res.text.indexOf("comp={gradeLabComp}")).toBeGreaterThan(res.text.indexOf("comp={endCardComp}"));
    expect(res.text.indexOf("comp={gradeLabComp}")).toBeLessThan(res.text.indexOf("</AbsoluteFill>"));
    // round-trips through the parser as one more sequence
    const occs = parseSequences(HERO_FILE, { ...compFiles, [HERO_FILE]: res.text });
    expect(occs.length).toBe(4);
    expect(occs[3].from.value).toBe(214);
    expect(occs[3].nested?.compExpr).toBe("gradeLabComp");
  });

  it("extends an existing import from the same module instead of duplicating it", () => {
    const res = insertNestedSequence(HERO_FILE, compFiles, {
      varName: "heroRawComp",
      from: 0,
      durationInFrames: 100,
      importFrom: "./comps",
    })!;
    expect(res.text.match(/from "\.\/comps"/g)!.length).toBe(1);
    expect(res.text).toContain("endCardComp, heroRawComp }");
  });

  it("opens up a self-closing root <AbsoluteFill /> in an empty comp", () => {
    const res = insertNestedSequence(TITLE_FILE, compFiles, {
      varName: "lowerThirdComp",
      from: 0,
      durationInFrames: 168,
      importFrom: "./comps",
    })!;
    expect(res.text).toContain("</AbsoluteFill>");
    // the JSX components must be in scope — the scaffold only imported AbsoluteFill
    expect(res.text).toMatch(/import \{ AbsoluteFill(, \w+)+ \} from "framediff"/);
    expect(res.text).toContain("Sequence");
    expect(res.text.match(/from "framediff"/g)!.length).toBe(2); // the type import + the one value import
    const occs = parseSequences(TITLE_FILE, { [TITLE_FILE]: res.text });
    expect(occs.length).toBe(1);
    expect(occs[0].nested?.compExpr).toBe("lowerThirdComp");
  });

  it("skips the import when the export lives in the target file", () => {
    const res = insertNestedSequence(HERO_FILE, compFiles, { varName: "x", from: 0, durationInFrames: 1 })!;
    expect(res.text).not.toContain('import { x }');
  });
});

describe("insertRegistryEntry", () => {
  it("adds the key before the closing brace plus the import", () => {
    const res = insertRegistryEntry(CONFIG_FILE, compFiles, {
      key: "title-card",
      varName: "titleCardComp",
      importFrom: "./TitleCard",
    })!;
    expect(res.text).toContain('import { titleCardComp } from "./TitleCard";');
    expect(res.text).toContain('  "title-card": titleCardComp,\n};');
  });

  it("adds a separator to an inline registry without a trailing comma", () => {
    const file = "src/inline-config.ts";
    const files = {
      [file]: 'import { base } from "./base";\nexport const COMPOSITIONS = { ...base, existing };\n',
    };
    const first = insertRegistryEntry(file, files, {
      key: "test-generate",
      varName: "testGenerateComp",
      importFrom: "./TestGenerate",
    })!;
    const second = insertRegistryEntry(file, { [file]: first.text }, {
      key: "asdf",
      varName: "asdfComp",
      importFrom: "./Asdf",
    })!;

    expect(first.text).toContain('{ ...base, existing, "test-generate": testGenerateComp, }');
    expect(second.text).toContain('{ ...base, existing, "test-generate": testGenerateComp, "asdf": asdfComp, }');
  });

  it("adds a separator after a multiline entry without a trailing comma", () => {
    const file = "src/multiline-config.ts";
    const files = {
      [file]: 'export const COMPOSITIONS = {\n  main: composition\n};\n',
    };
    const res = insertRegistryEntry(file, files, {
      key: "title-card",
      varName: "titleCardComp",
      importFrom: "./TitleCard",
    })!;

    expect(res.text).toContain('  main: composition,\n  "title-card": titleCardComp,\n};');
  });

  it("edits a registry wrapped by the versioned project boundary", () => {
    const file = "src/versioned-config.ts";
    const files = {
      [file]: 'import { defineCompositionRegistry } from "framediff";\nexport const COMPOSITIONS = defineCompositionRegistry({\n  main: composition,\n});\n',
    };
    const inserted = insertRegistryEntry(file, files, {
      key: "title-card",
      varName: "titleCardComp",
      importFrom: "./TitleCard",
    })!;
    expect(inserted.text).toContain('  "title-card": titleCardComp,\n});');
    const removed = removeRegistryEntry(file, { [file]: inserted.text }, "titleCardComp")!;
    expect(removed.text).toContain("defineCompositionRegistry({\n  main: composition,\n});");
    expect(removed.text).not.toContain("titleCardComp");
  });
});

describe("removeRegistryEntry", () => {
  it("removes a quoted-key entry and its now-unused import line", () => {
    const res = removeRegistryEntry(CONFIG_FILE, compFiles, "gradeLabComp")!;
    expect(res.text).not.toContain('"grade-lab"');
    expect(res.text).not.toContain("gradeLabComp");
    expect(res.text).not.toContain('from "./GradeLab"');
    expect(res.text).toContain('"end-card": endCardComp,');
  });

  it("shrinks a shared import instead of removing it", () => {
    const res = removeRegistryEntry(CONFIG_FILE, compFiles, "lowerThirdComp")!;
    expect(res.text).not.toContain('"lower-third"');
    expect(res.text).toContain('import { heroFootageComp, endCardComp } from "./comps";');
  });

  it("keeps a same-file declaration when removing its bare-key entry", () => {
    const res = removeRegistryEntry(CONFIG_FILE, compFiles, "composition")!;
    expect(res.text).not.toContain("main: composition");
    expect(res.text).toContain("export const composition: StudioComposition");
  });

  it("returns null for an unknown entry", () => {
    expect(removeRegistryEntry(CONFIG_FILE, compFiles, "ghostComp")).toBeNull();
  });
});

describe("compExportCount", () => {
  it("counts comp exports of any shape — object literals and generative() calls", () => {
    expect(compExportCount(GRADELAB_FILE, compFiles)).toBe(1);
    expect(compExportCount(COMPS_FILE, compFiles)).toBeGreaterThan(1);
    const gen = `import { generative } from "framediff";\nexport const shotComp = generative({\n  id: "Shot",\n  prompt: "a harbor at dusk",\n});\n`;
    expect(compExportCount("src/Shot.gen.tsx", { "src/Shot.gen.tsx": gen })).toBe(1);
  });
});

describe("compReferenceFiles", () => {
  it("lists files still nesting the comp — the delete guard", () => {
    expect(compReferenceFiles("lowerThirdComp", compFiles, [CONFIG_FILE, COMPS_FILE])).toEqual([HERO_FILE]);
  });

  it("is empty for an unreferenced comp, and masks comments out", () => {
    expect(compReferenceFiles("gradeLabComp", compFiles, [CONFIG_FILE, GRADELAB_FILE])).toEqual([]);
  });
});

describe("setCompLibrary", () => {
  it("adds library: true into meta", () => {
    const res = setCompLibrary("TitleCard", compFiles, true)!;
    expect(res.file).toBe(TITLE_FILE);
    expect(res.text).toContain('meta: { library: true, kind: "edit", file: "src/TitleCard.tsx" }');
  });

  it("removes an existing library flag", () => {
    const res = setCompLibrary("GradeLab", compFiles, false)!;
    expect(res.text).not.toContain("library");
    expect(res.text).toContain('deps: ["src/constants.ts"] }');
  });
});

describe("transformCopiedCompText", () => {
  it("renames id, meta.file, the export, and forces library: true when asked", () => {
    const text = transformCopiedCompText(GRADELAB, {
      oldId: "GradeLab",
      newId: "GradeLabCopy",
      newVar: "gradeLabCopyComp",
      newFile: "src/GradeLabCopy.tsx",
      library: true,
    })!;
    expect(text).toContain('id: "GradeLabCopy"');
    expect(text).toContain('file: "src/GradeLabCopy.tsx"');
    expect(text).toContain("export const gradeLabCopyComp: StudioComposition");
    expect(text).toContain("library: true");
    // the component function itself is untouched — same JSX, new identity
    expect(text).toContain("export function GradeLab()");
    expect(text).toContain("component: GradeLab,");
  });

  it("keeps the source's placement when library is not requested", () => {
    const text = transformCopiedCompText(EMPTY_COMP, {
      oldId: "TitleCard",
      newId: "TitleCardCopy",
      newVar: "titleCardCopyComp",
      newFile: "src/TitleCardCopy.tsx",
    })!;
    expect(text).toContain('id: "TitleCardCopy"');
    expect(text).not.toContain("library");
  });

  it("refuses multi-comp files", () => {
    expect(
      transformCopiedCompText(COMPS, { oldId: "LowerThird", newId: "X", newVar: "xComp", newFile: "src/X.tsx" }),
    ).toBeNull();
  });

  it("forks a generative recipe: new identity, file rewritten, take reset", () => {
    const gen = `import { generative } from "framediff";

export const shotComp = generative({
  id: "Shot",
  file: "src/Shot.gen.tsx",
  prompt: "a harbor at dusk",
  duration: 5,
  take: 4,
});
`;
    const text = transformCopiedCompText(gen, {
      oldId: "Shot",
      newId: "ShotCopy",
      newVar: "shotCopyComp",
      newFile: "src/ShotCopy.gen.tsx",
      library: true,
    })!;
    expect(text).toContain('id: "ShotCopy"');
    expect(text).toContain('file: "src/ShotCopy.gen.tsx"');
    expect(text).toContain("export const shotCopyComp = generative({");
    expect(text).toContain('prompt: "a harbor at dusk"');
    // the fork has no takes of its own — the pin resets
    expect(text).toContain("take: 0");
    expect(text).not.toContain("take: 4");
  });
});
