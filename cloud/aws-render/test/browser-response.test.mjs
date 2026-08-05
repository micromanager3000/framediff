import assert from "node:assert/strict";
import test from "node:test";
import { isIgnorableBrowserResponse } from "../src/browser-response.mjs";

test("ignores local encoded SVG fragment requests", () => {
  assert.equal(isIgnorableBrowserResponse({
    status: 404,
    url: "http://127.0.0.1:4179/%23noise",
    harnessOrigin: "http://127.0.0.1:4179",
  }), true);
});

test("does not ignore missing local assets", () => {
  assert.equal(isIgnorableBrowserResponse({
    status: 404,
    url: "http://127.0.0.1:4179/assets/missing.png",
    harnessOrigin: "http://127.0.0.1:4179",
  }), false);
});

test("does not ignore fragment-shaped failures from another origin", () => {
  assert.equal(isIgnorableBrowserResponse({
    status: 404,
    url: "https://example.com/%23noise",
    harnessOrigin: "http://127.0.0.1:4179",
  }), false);
});

test("keeps existing optional probe exceptions scoped to 404", () => {
  assert.equal(isIgnorableBrowserResponse({
    status: 404,
    url: "https://huggingface.co/model/optional.json",
    harnessOrigin: "http://127.0.0.1:4179",
  }), true);
  assert.equal(isIgnorableBrowserResponse({
    status: 500,
    url: "https://huggingface.co/model/optional.json",
    harnessOrigin: "http://127.0.0.1:4179",
  }), false);
});
