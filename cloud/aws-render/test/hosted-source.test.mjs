import assert from "node:assert/strict";
import test from "node:test";
import { withProjectStyles } from "../harness/hosted-source.mjs";

test("bundled project CSS is inlined without leaving a broken local request", () => {
  const html = '<!doctype html><html><head><link href="./styles.css" rel="stylesheet"></head><body></body></html>';
  const result = withProjectStyles(html, "body { background: #123; }");

  assert.doesNotMatch(result, /<link\b/i);
  assert.match(result, /<style data-framediff-hosted-styles>body \{ background: #123; \}<\/style>/);
});

test("remote stylesheets are preserved while bundled root CSS links are removed", () => {
  const html = [
    '<link rel="stylesheet" href="https://fonts.example/type.css">',
    '<link rel="stylesheet preload" href="/src/project.css?v=4">',
  ].join("");
  const result = withProjectStyles(html, ".title { color: white; }");

  assert.match(result, /https:\/\/fonts\.example\/type\.css/);
  assert.doesNotMatch(result, /project\.css/);
});

test("documents without bundled CSS still cannot request a missing bundled stylesheet", () => {
  const result = withProjectStyles('<link rel=stylesheet href=styles.css>', "");
  assert.equal(result, "");
});
