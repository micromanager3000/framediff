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
    inputS3Key: undefined,
    inputContentType: undefined,
  });
});

test("accepts vision and background-removal image jobs", () => {
  for (const kind of ["depth-map", "segmentation", "background-removal"]) {
    assert.deepEqual(validateJobSpec({
      version: 1,
      kind,
      outputPrefix: `jobs/${kind}-1`,
      inputS3Key: `inputs/${kind}-1.png`,
      inputContentType: "image/png",
    }), {
      version: 1,
      kind,
      outputPrefix: `jobs/${kind}-1`,
      inputS3Key: `inputs/${kind}-1.png`,
      inputContentType: "image/png",
    });
  }
});

test("rejects unsafe object keys and invalid input types", () => {
  assert.throws(
    () => validateJobSpec({ version: 1, kind: "capability-suite", outputPrefix: "../other" }),
    /safe relative S3 key/,
  );
  assert.throws(
    () => validateJobSpec({ version: 1, kind: "depth-map", inputS3Key: "/other.png" }),
    /safe relative S3 key/,
  );
  assert.throws(
    () => validateJobSpec({ version: 1, kind: "segmentation", inputS3Key: "input.gif", inputContentType: "image/gif" }),
    /inputContentType/,
  );
  assert.throws(
    () => validateJobSpec({ version: 1, kind: "capability-suite", inputS3Key: "input.png" }),
    /do not accept/,
  );
});

test("rejects unknown job kinds and versions", () => {
  assert.throws(() => validateJobSpec({ version: 2, kind: "capability-suite" }), /Unsupported/);
  assert.throws(() => validateJobSpec({ version: 1, kind: "render-arbitrary-code" }), /Unsupported/);
});
