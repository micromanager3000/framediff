import { describe, expect, it } from "vitest";
import { defineComposition } from "./composition";
import {
  applyPlanActuals,
  defineEditSkeleton,
  generateEditSkeleton,
  parsePlanRows,
  planDrift,
  swapNestedComp,
} from "./planning";

const PLAN = `<!doctype html><html><head><style></style></head><body>
<main data-fd-composition data-fd-id="Script" data-fd-name="E04 script"
  data-fd-width="1920" data-fd-height="1080" data-fd-fps="30" data-fd-duration="9000"
  data-fd-kind="plan">
  <section data-fd-clip data-fd-id="sc1" data-fd-name="1 · Storm coming"
    data-fd-from="0" data-fd-duration="1050" data-fd-prop-location="loc-headland" data-fd-prop-cast="cast-moth"></section>
  <section data-fd-clip data-fd-id="sc2" data-fd-name="2 · Title" data-fd-from="1050" data-fd-duration="300"></section>
  <section data-fd-clip data-fd-id="sc3" data-fd-name="3 · The flame gutters" data-fd-from="1350" data-fd-duration="7650"></section>
</main>
</body></html>`;

describe("parsePlanRows", () => {
  it("reads timed rows with prop refs", () => {
    const rows = parsePlanRows(PLAN);
    expect(rows.map((row) => row.id)).toEqual(["sc1", "sc2", "sc3"]);
    expect(rows[0]).toMatchObject({
      name: "1 · Storm coming",
      from: 0,
      durationInFrames: 1050,
      props: { location: "loc-headland", cast: "cast-moth" },
    });
  });

  it("ignores reference clips nested inside rows", () => {
    const withThumb = PLAN.replace(
      'data-fd-prop-cast="cast-moth"></section>',
      'data-fd-prop-cast="cast-moth">' +
        '<div data-fd-clip data-fd-id="sc1-ref" data-fd-from="0" data-fd-duration="1050" data-fd-type="nested" data-fd-comp="board-sc1"></div>' +
        "</section>",
    );
    expect(parsePlanRows(withThumb).map((row) => row.id)).toEqual(["sc1", "sc2", "sc3"]);
  });
});

describe("generateEditSkeleton", () => {
  it("emits a master whose placements mirror plan timing", () => {
    const master = generateEditSkeleton(PLAN, { audio: ["asset://vo/scratch.wav"] });
    const config = defineComposition(master);
    expect(config.id).toBe("Script-master");
    expect(config).toMatchObject({ width: 1920, height: 1080, fps: 30, durationInFrames: 9000 });
    expect(config.meta?.kind).toBe("edit");
    expect(master).toContain('data-fd-comp="board-sc1"');
    expect(master).toContain('data-fd-prop-plan="sc2"');
    expect(master).toContain('data-fd-prop-status="animatic"');
    expect(master).toContain('data-fd-src="asset://vo/scratch.wav"');
    const rows = parsePlanRows(master).filter((row) => row.id.startsWith("sc"));
    expect(rows.map((row) => [row.from, row.durationInFrames])).toEqual([
      [0, 1050],
      [1050, 300],
      [1350, 7650],
    ]);
  });

  it("honors comp/status/grade options and stays parseable", () => {
    const master = generateEditSkeleton(PLAN, {
      id: "Ep04",
      compFor: (row) => `${row.id}-previz`,
      statusFor: (row) => (row.id === "sc2" ? "final" : "previz"),
      matchProp: "scene",
      gradeLayer: { "data-fd-lut-name": "storm-glass", "data-fd-grade-bloom": 0.22 },
    });
    expect(master).toContain('data-fd-comp="sc1-previz"');
    expect(master).toContain('data-fd-prop-scene="sc3"');
    expect(master).toContain('data-fd-lut-name="storm-glass"');
    expect(defineEditSkeleton(PLAN).meta?.sourceFormat).toBe("generated");
  });
});

describe("planDrift / applyPlanActuals", () => {
  const master = () => {
    let source = generateEditSkeleton(PLAN, { id: "Ep04" });
    // The edit ran long on sc1 and moved everything downstream.
    source = source.replace('data-fd-id="sc1" data-fd-name="1 · Storm coming" data-fd-from="0" data-fd-duration="1050"',
      'data-fd-id="sc1" data-fd-name="1 · Storm coming" data-fd-from="0" data-fd-duration="1200"');
    source = source.replace('data-fd-from="1050" data-fd-duration="300"', 'data-fd-from="1200" data-fd-duration="300"');
    return source;
  };

  it("measures per-row drift against the plan", () => {
    const drift = planDrift(PLAN, master());
    expect(drift.rows[0]).toMatchObject({ id: "sc1", driftFrames: 150, actual: { from: 0, durationInFrames: 1200 } });
    expect(drift.rows[1]).toMatchObject({ id: "sc2", actual: { from: 1200, durationInFrames: 300 }, driftFrames: 0 });
    expect(drift.totalDriftFrames).toBe(150);
    expect(drift.unplanned).toEqual([]);
  });

  it("reports unmatched rows and unplanned placements", () => {
    const drift = planDrift(PLAN, master().replace('data-fd-prop-plan="sc3"', 'data-fd-prop-plan="sc3-renamed"'));
    expect(drift.rows[2].actual).toBeNull();
    expect(drift.unplanned).toEqual(["sc3"]);
  });

  it("syncs actuals back into the plan source", () => {
    const synced = applyPlanActuals(PLAN, master());
    const rows = parsePlanRows(synced);
    expect(rows.map((row) => [row.from, row.durationInFrames])).toEqual([
      [0, 1200],
      [1200, 300],
      [1350, 7650],
    ]);
    // Only timing attributes changed; the rest of the document is untouched.
    expect(synced).toContain('data-fd-prop-location="loc-headland"');
  });
});

describe("swapNestedComp", () => {
  it("rewrites one slot's comp ref and status", () => {
    const master = generateEditSkeleton(PLAN, { id: "Ep04" });
    const swapped = swapNestedComp(master, "sc3", "sc3-flame-gutters", "final");
    expect(swapped).toContain('data-fd-comp="sc3-flame-gutters"');
    expect(swapped).toContain('data-fd-prop-status="final"');
    expect(swapped).toContain('data-fd-comp="board-sc1"');
    expect(swapNestedComp(master, "nope", "x")).toBeNull();
  });
});

describe("copyHtmlElementInto", () => {
  it("copies a card into another comp with ids re-uniqued", async () => {
    const { copyHtmlElementInto } = await import("./studio/htmlSource");
    const target = PLAN.replace('data-fd-id="sc2"', 'data-fd-id="sc1-text"').replace('data-fd-id="Script"', 'data-fd-id="Other"');
    const card = PLAN.replace(
      'data-fd-prop-cast="cast-moth"></section>',
      'data-fd-prop-cast="cast-moth"><p data-fd-id="sc1-text" data-fd-text="beat"></p></section>',
    );
    const copied = copyHtmlElementInto(card, "sc1", target);
    expect(copied).not.toBeNull();
    expect(copied!.id).toBe("sc1-2");
    expect(copied!.source).toContain('data-fd-id="sc1-2"');
    expect(copied!.source).toContain('data-fd-id="sc1-text-2"');
    // target's own elements untouched; document still parseable with the new row present
    expect(copied!.source).toContain('data-fd-id="sc1-text" data-fd-name="2 · Title"');
    const ids = parsePlanRows(copied!.source).map((row) => row.id);
    expect(ids).toContain("sc1-2");
  });

  it("returns null for unknown elements", async () => {
    const { copyHtmlElementInto } = await import("./studio/htmlSource");
    expect(copyHtmlElementInto(PLAN, "nope", PLAN)).toBeNull();
  });
});
