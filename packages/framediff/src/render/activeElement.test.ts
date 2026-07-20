import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAudioElementActive,
  isTimelineElementActive,
  isVisualElementActive,
} from "./activeElement";

interface FakeElement {
  parentElement: FakeElement | null;
  style: { display: string; visibility: string };
  computed: { display: string; visibility: string };
  hasAttribute(name: string): boolean;
}

function element(parent: FakeElement | null = null, attributes: string[] = []): FakeElement {
  const names = new Set(attributes);
  return {
    parentElement: parent,
    style: { display: "", visibility: "" },
    computed: { display: "block", visibility: "visible" },
    hasAttribute: (name) => names.has(name),
  };
}

const dom = (value: FakeElement): Element => value as unknown as Element;
const rootDom = (value: FakeElement): HTMLElement => value as unknown as HTMLElement;

describe("active timeline elements", () => {
  beforeEach(() => {
    vi.stubGlobal("getComputedStyle", (value: Element) => (value as unknown as FakeElement).computed);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("accepts a visible element in the active composition branch", () => {
    const root = element(null, ["data-fd-composition"]);
    const clip = element(root, ["data-fd-clip"]);
    const child = element(clip);
    expect(isTimelineElementActive(dom(child), rootDom(root))).toBe(true);
    expect(isVisualElementActive(dom(child), rootDom(root))).toBe(true);
  });

  it("rejects elements below a runtime-hidden timeline clip", () => {
    const root = element(null, ["data-fd-composition"]);
    const clip = element(root, ["data-fd-clip"]);
    const child = element(clip);
    clip.style.display = "none";
    clip.computed.display = "none";
    expect(isTimelineElementActive(dom(child), rootDom(root))).toBe(false);
    expect(isVisualElementActive(dom(child), rootDom(root))).toBe(false);
  });

  it("follows timeline activity through an outer nested-composition clip", () => {
    const outerRoot = element(null, ["data-fd-composition"]);
    const nestedClip = element(outerRoot, ["data-fd-clip"]);
    const childRoot = element(nestedClip, ["data-fd-composition"]);
    const canvas = element(childRoot);
    nestedClip.style.display = "none";
    nestedClip.computed.display = "none";
    expect(isTimelineElementActive(dom(canvas), rootDom(childRoot))).toBe(false);
    expect(isVisualElementActive(dom(canvas), rootDom(childRoot))).toBe(false);
  });

  it("requires the element to belong to the requested composition root", () => {
    const root = element(null, ["data-fd-composition"]);
    const foreignRoot = element(null, ["data-fd-composition"]);
    expect(isTimelineElementActive(dom(element(foreignRoot)), rootDom(root))).toBe(false);
  });

  it("honors authored CSS visibility for visual layers", () => {
    const root = element(null, ["data-fd-composition"]);
    const wrapper = element(root);
    const child = element(wrapper);
    wrapper.computed.visibility = "hidden";
    expect(isTimelineElementActive(dom(child), rootDom(root))).toBe(true);
    expect(isVisualElementActive(dom(child), rootDom(root))).toBe(false);
  });

  it("ignores an audio element's own display but still gates hidden ancestors", () => {
    const root = element(null, ["data-fd-composition"]);
    const wrapper = element(root);
    const audio = element(wrapper);
    audio.computed.display = "none";
    expect(isAudioElementActive(dom(audio), rootDom(root))).toBe(true);
    wrapper.computed.display = "none";
    expect(isAudioElementActive(dom(audio), rootDom(root))).toBe(false);
  });
});
