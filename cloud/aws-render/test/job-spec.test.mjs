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
    renderRequest: undefined,
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
      renderRequest: undefined,
    });
  }
});

test("accepts a bounded immutable hosted render bundle", () => {
  const renderRequest = {
    compositionKey: "main",
    source: { files: { "src/Main.html": {
      sha256: `sha256:${"a".repeat(64)}`,
      contentBase64: "PG1haW4+PC9tYWluPg==",
      executable: false,
    } } },
    settings: { width: 1920, height: 1080, from: 0, to: 30, outputKind: "video" },
  };
  assert.deepEqual(validateJobSpec({ version: 1, kind: "hosted-render", renderRequest }), {
    version: 1,
    kind: "hosted-render",
    outputPrefix: undefined,
    inputS3Key: undefined,
    inputContentType: undefined,
    renderRequest,
  });
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
