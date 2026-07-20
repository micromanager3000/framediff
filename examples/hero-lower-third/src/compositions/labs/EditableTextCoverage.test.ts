import { describe, expect, it } from "vitest";
import { flattenHtmlElements, parseHtmlSource } from "../../../../../packages/framediff/src/studio/htmlSource";
import directSource from "./DirectManipulationLab.html?raw";
import editorialSource from "./EditorialLab.html?raw";
import motionSource from "./GsapMotionLab.html?raw";
import productionSource from "./ProductionLab.html?raw";
import propertiesSource from "./RichPropertiesLab.html?raw";

const documents = {
  DirectManipulationLab: directSource,
  EditorialLab: editorialSource,
  GsapMotionLab: motionSource,
  ProductionLab: productionSource,
  RichPropertiesLab: propertiesSource,
};

function uneditableLiteralLeaves(source: string): string[] {
  return flattenHtmlElements(parseHtmlSource(source)).flatMap((element) => {
    if (element.children.length || ["br", "html", "head", "body"].includes(element.tagName)) return [];
    const closeStart = source.toLowerCase().lastIndexOf(`</${element.tagName}`, element.end);
    if (closeStart < element.startTagEnd) return [];
    const literal = source.slice(element.startTagEnd, closeStart).trim();
    if (!literal || literal.includes("<")) return [];
    return element.attributes.has("data-fd-id") ? [] : [`<${element.tagName}> ${literal}`];
  });
}

describe("holistic example authored text", () => {
  for (const [name, source] of Object.entries(documents)) {
    it(`${name} gives every literal text leaf a stable editable identity`, () => {
      expect(uneditableLiteralLeaves(source)).toEqual([]);
    });
  }
});
