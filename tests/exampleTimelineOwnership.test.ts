import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defineTimelineDocument } from "../packages/framediff/src/composition";

const examplesRoot = path.join(process.cwd(), "examples");

function filesUnder(directory: string, suffix: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file, suffix) : entry.name.endsWith(suffix) ? [file] : [];
  });
}

const timelineOwnedAttributes = [
  "data-fd-from",
  "data-fd-duration",
  "data-fd-layer",
  "data-fd-trim-start",
  "data-fd-playback-rate",
  "data-fd-volume",
  "data-fd-muted",
  "data-fd-nested-scale",
  "data-fd-comp",
  "data-fd-src",
];

describe("example edit timeline ownership", () => {
  it("keeps every example timeline valid with unique placement ids", () => {
    const timelineFiles = filesUnder(examplesRoot, ".timeline.json");
    expect(timelineFiles.length).toBeGreaterThan(0);
    for (const file of timelineFiles) {
      const document = defineTimelineDocument(JSON.parse(readFileSync(file, "utf8")));
      expect(new Set(document.items.map((item) => item.id)).size, file).toBe(document.items.length);
    }
  });

  it("keeps placement settings in timeline JSON instead of matching HTML placeholders", () => {
    const offenders: string[] = [];
    let externalTimelineCount = 0;
    for (const file of filesUnder(examplesRoot, ".html")) {
      const html = readFileSync(file, "utf8");
      const timelineSource = /\bdata-fd-timeline-source=(["'])(.*?)\1/.exec(html)?.[2];
      if (!timelineSource) continue;
      externalTimelineCount += 1;
      const sourceMarker = `${path.sep}src${path.sep}`;
      const sourceIndex = file.indexOf(sourceMarker);
      expect(sourceIndex, file).toBeGreaterThan(0);
      const timelineFile = path.join(file.slice(0, sourceIndex), timelineSource);
      const document = defineTimelineDocument(JSON.parse(readFileSync(timelineFile, "utf8")));
      const placementIds = new Set(document.items.map((item) => item.id));
      for (const tag of html.match(/<[^>]+\bdata-fd-id=(["']).*?\1[^>]*>/g) ?? []) {
        const id = /\bdata-fd-id=(["'])(.*?)\1/.exec(tag)?.[2];
        if (!id || !placementIds.has(id)) continue;
        for (const attribute of timelineOwnedAttributes) {
          if (new RegExp(`\\b${attribute}(?:\\s|=|>)`).test(tag)) offenders.push(`${file}:${id}:${attribute}`);
        }
      }
    }
    expect(externalTimelineCount).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
