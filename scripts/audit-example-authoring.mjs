import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const examplesRoot = join(root, "examples");
const failures = [];
let timelineCount = 0;
let placementCount = 0;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return files.flat();
}

function fail(file, message) {
  failures.push(`${relative(root, file)}: ${message}`);
}

function validateContent(file, item) {
  const content = item.content;
  if (!content || typeof content !== "object") {
    fail(file, `timeline item "${item.id}" is legacy HTML-backed content`);
    return;
  }
  const types = new Set(["nested", "video", "audio", "layers", "camera", "grade-layer"]);
  if (!types.has(content.type)) fail(file, `timeline item "${item.id}" has unknown content type "${content.type}"`);
  if (content.type === "nested" && typeof content.composition !== "string") {
    fail(file, `nested timeline item "${item.id}" needs a composition`);
  }
  if ((content.type === "video" || content.type === "audio") && typeof content.src !== "string") {
    fail(file, `${content.type} timeline item "${item.id}" needs a source`);
  }
  if (content.type === "camera" && typeof content.camera !== "string") {
    fail(file, `camera timeline item "${item.id}" needs a camera`);
  }
}

const files = await walk(examplesRoot);
for (const file of files.filter((candidate) => candidate.endsWith(".html"))) {
  const html = await readFile(file, "utf8");
  const root = html.match(/<[^>]+\bdata-fd-composition(?:\s|=|>)[^>]*>/i)?.[0] ?? "";
  if (/\bdata-fd-kind="edit"/i.test(root) && !/\bdata-fd-timeline-source="[^"]+"/i.test(root)) {
    fail(file, "edit compositions need an external timeline document");
  }
}

const timelines = files.filter((file) => file.endsWith(".timeline.json"));
for (const file of timelines) {
  timelineCount += 1;
  let document;
  try {
    document = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(file, `cannot parse JSON (${error instanceof Error ? error.message : String(error)})`);
    continue;
  }
  if (document.version !== 1 || !Array.isArray(document.items)) {
    fail(file, "must be a version 1 timeline document");
    continue;
  }
  const ids = new Set();
  for (const item of document.items) {
    placementCount += 1;
    if (typeof item.id !== "string" || !item.id) fail(file, "timeline item needs a stable id");
    if (ids.has(item.id)) fail(file, `timeline item id "${item.id}" is duplicated`);
    ids.add(item.id);
    if (!Number.isFinite(item.from) || !Number.isFinite(item.durationInFrames) || item.durationInFrames <= 0) {
      fail(file, `timeline item "${item.id}" needs finite timing and a positive duration`);
    }
    validateContent(file, item);
  }

  const htmlFile = file.replace(/\.timeline\.json$/, ".html");
  if (!files.includes(htmlFile)) continue;
  const html = await readFile(htmlFile, "utf8");
  const hasInlineCreativeData = /\bdata-fd-text="|\bdata-fd-grade-(?:exposure|contrast|saturation|temperature|tint|highlights|shadows|vignette|bloom|bloom-threshold|lut|lut-intensity)="/.test(html);
  if (hasInlineCreativeData && !html.includes("data-fd-document=")) {
    fail(htmlFile, "timeline-backed editable copy or look values need a JSON composition document");
  }
  const clipIds = [...html.matchAll(/<[^>]*\bdata-fd-(?:clip|type="(?:audio|video|nested)")\b[^>]*\bdata-fd-id="([^"]+)"/g)]
    .map((match) => match[1]);
  for (const id of clipIds) {
    if (!ids.has(id)) fail(htmlFile, `clip "${id}" is missing from ${relative(dirname(htmlFile), file)}`);
  }
}

if (failures.length) {
  console.error(`Example authoring audit failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Example authoring audit passed: ${placementCount} JSON-owned placements across ${timelineCount} timelines.`);
}
