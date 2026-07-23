import assert from "node:assert/strict";
import test from "node:test";
import { validateJobSpec } from "../src/job-spec.mjs";

test("accepts the versioned capability-suite job", () => {
  assert.deepEqual(validateJobSpec({
    version: 1,
    kind: "capability-suite",
    outputPrefix: "jobs/manual-1",
  }), {
    version: 1,
    kind: "capability-suite",
    outputPrefix: "jobs/manual-1",
  });
});

test("rejects unsafe output prefixes", () => {
  assert.throws(
    () => validateJobSpec({ version: 1, kind: "capability-suite", outputPrefix: "../other" }),
    /safe relative S3 prefix/,
  );
});

test("rejects unknown job kinds and versions", () => {
  assert.throws(() => validateJobSpec({ version: 2, kind: "capability-suite" }), /Unsupported/);
  assert.throws(() => validateJobSpec({ version: 1, kind: "render-arbitrary-code" }), /Unsupported/);
});
