import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_CHUNK_BYTES = 800_000;
const MAX_EAGER_CHUNK_BYTES = 500_000;
const examplesRoot = path.resolve("examples");

function formatBytes(bytes) {
  return `${(bytes / 1_000).toFixed(1)} kB`;
}

function findRecord(manifest, reference) {
  return manifest[reference] ??
    Object.values(manifest).find((record) => record.file === reference);
}

function eagerRecords(manifest, entryKey) {
  const records = new Map();

  function visit(reference) {
    const record = findRecord(manifest, reference);
    if (!record || records.has(record.file)) return;
    records.set(record.file, record);
    for (const imported of record.imports ?? []) visit(imported);
  }

  visit(entryKey);
  return [...records.values()];
}

async function javascriptChunks(clientRoot, records) {
  const files = [...new Set(records.map((record) => record.file))]
    .filter((file) => file?.endsWith(".js"));
  return Promise.all(files.map(async (file) => ({
    file,
    bytes: (await stat(path.join(clientRoot, file))).size,
  })));
}

const projects = (await readdir(examplesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const failures = [];
const summaries = [];

for (const project of projects) {
  const clientRoot = path.join(examplesRoot, project, ".svelte-kit", "output", "client");
  const manifestPath = path.join(clientRoot, ".vite", "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      failures.push(`${project}: missing production manifest; run the build first`);
      continue;
    }
    throw error;
  }

  const routeEntry = Object.keys(manifest).find((key) => key.endsWith("/nodes/2.js"));
  if (!routeEntry) {
    failures.push(`${project}: could not find the main route entry in the manifest`);
    continue;
  }

  const allChunks = await javascriptChunks(clientRoot, Object.values(manifest));
  const eager = await javascriptChunks(clientRoot, eagerRecords(manifest, routeEntry));
  const largest = allChunks.sort((a, b) => b.bytes - a.bytes)[0];
  const largestEager = eager.sort((a, b) => b.bytes - a.bytes)[0];

  for (const chunk of allChunks) {
    if (chunk.bytes > MAX_CHUNK_BYTES) {
      failures.push(
        `${project}: ${chunk.file} is ${formatBytes(chunk.bytes)} ` +
        `(chunk budget ${formatBytes(MAX_CHUNK_BYTES)})`,
      );
    }
  }
  for (const chunk of eager) {
    if (chunk.bytes > MAX_EAGER_CHUNK_BYTES) {
      failures.push(
        `${project}: eager ${chunk.file} is ${formatBytes(chunk.bytes)} ` +
        `(eager budget ${formatBytes(MAX_EAGER_CHUNK_BYTES)})`,
      );
    }
  }

  summaries.push(
    `${project}: max ${formatBytes(largest.bytes)}, ` +
    `max eager ${formatBytes(largestEager.bytes)}`,
  );

  if (project === "studio-playground") {
    const eagerFiles = new Set(eager.map((chunk) => chunk.file));
    for (const [label, suffix] of [
      ["GSAP source tooling", "/packages/framediff/src/gsap/source.ts"],
      ["render/export tooling", "/packages/framediff/src/render/index.ts"],
    ]) {
      const boundary = Object.entries(manifest)
        .find(([key]) => key.endsWith(suffix))?.[1];
      if (!boundary?.isDynamicEntry || eagerFiles.has(boundary.file)) {
        failures.push(`${project}: ${label} is no longer isolated behind a dynamic entry`);
      }
    }
  }
}

console.log(["Bundle budgets:", ...summaries.map((summary) => `- ${summary}`)].join("\n"));

if (failures.length) {
  console.error([
    "Bundle budget check failed.",
    ...failures.map((failure) => `- ${failure}`),
  ].join("\n"));
  process.exitCode = 1;
}
