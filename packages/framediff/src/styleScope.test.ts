import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") });

import { scopeCompositionSelectorList } from "./styleScope";

describe("composition style scoping", () => {
  it("isolates root and descendant selectors to one mount", () => {
    const scoped = scopeCompositionSelectorList("[data-fd-composition], .bar", "fd-7");
    expect(scoped).toContain(':is([data-fd-composition]):where([data-framediff-style-scope="fd-7"])');
    expect(scoped).toContain(':is(.bar):where([data-framediff-style-scope="fd-7"])');
  });

  it("keeps commas inside functional selectors intact", () => {
    const scoped = scopeCompositionSelectorList(".card:is(.open, .active) > span", "fd-2");
    expect(scoped.match(/:is\(\.card:is\(\.open, \.active\) > span\)/g)).toHaveLength(2);
  });

  it("places the scope constraint before pseudo-elements", () => {
    const scoped = scopeCompositionSelectorList(".bar::before", "fd-3");
    expect(scoped).toContain(':is(.bar):where([data-framediff-style-scope="fd-3"])::before');
  });

  it("maps document selectors onto the composition root", () => {
    const scoped = scopeCompositionSelectorList(":root, html, body", "fd-4");
    expect(scoped.match(/:is\(\[data-fd-composition\]\)/g)).toHaveLength(6);
  });
});
