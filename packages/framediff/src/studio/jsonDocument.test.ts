import { describe, expect, it } from "vitest";
import { inspectorFieldsFromJsonDocument, jsonPointerValue, setJsonPointerValue } from "./jsonDocument";

describe("composition JSON documents", () => {
  it("projects schema primitives into generic Studio controls", () => {
    const document = { params: { strength: 2.5, color: "#ff00aa", solver: "xpbd", visible: true, asset: "asset://cloth" } };
    const schema = {
      type: "object",
      properties: { params: { type: "object", properties: {
        strength: { type: "number", minimum: 0, maximum: 8, multipleOf: 0.1 },
        color: { type: "string", format: "color" },
        solver: { type: "string", enum: ["verlet", "xpbd"] },
        visible: { type: "boolean" },
        asset: { type: "string", format: "asset", "x-accept": "image" },
      } } },
    };
    const fields = inspectorFieldsFromJsonDocument("src/Cloth.comp.json", document, schema, "/params");
    expect(fields.map((field) => field.control?.type)).toEqual(["number", "color", "select", "boolean", "asset"]);
    expect(fields[0].control).toMatchObject({ slider: true, min: 0, max: 8, step: 0.1 });
  });

  it("reads and writes escaped JSON Pointer locations", () => {
    const document = { params: { "a/b": 1 } };
    expect(jsonPointerValue(document, "/params/a~1b")).toBe(1);
    expect(setJsonPointerValue(document, "/params/a~1b", 2)).toBe(true);
    expect(document.params["a/b"]).toBe(2);
  });

  it("resolves local schema definitions for bound object controls", () => {
    const document = { card: { x: 120, title: "Move me" } };
    const schema = {
      type: "object",
      properties: { card: { $ref: "#/$defs/card" } },
      $defs: { card: { type: "object", properties: {
        x: { type: "number", minimum: -100, maximum: 1920, multipleOf: 1 },
        title: { type: "string" },
      } } },
    };

    const fields = inspectorFieldsFromJsonDocument("src/Card.comp.json", document, schema, "/card");
    expect(fields.map((field) => field.control?.type)).toEqual(["number", "text"]);
    expect(fields[0].control).toMatchObject({ slider: true, min: -100, max: 1920, step: 1 });
  });

  it("resolves schemas through array item pointers for camera and spline records", () => {
    const document = { moves: [{ focalLength: 50, label: "A" }] };
    const schema = {
      type: "object",
      properties: {
        moves: {
          type: "array",
          items: {
            type: "object",
            properties: {
              focalLength: { type: "number", title: "Focal length", minimum: 8, maximum: 200 },
              label: { type: "string", title: "Camera" },
            },
          },
        },
      },
    };

    const fields = inspectorFieldsFromJsonDocument("src/cameras.json", document, schema, "/moves/0");
    expect(fields.map((field) => [field.label, field.control?.type])).toEqual([
      ["Focal length", "number"],
      ["Camera", "text"],
    ]);
    expect(fields[0].control).toMatchObject({ min: 8, max: 200, slider: true });
  });

  it("merges allOf properties for extended effect records", () => {
    const document = { motion: { startX: 960, path0X: 700 } };
    const schema = {
      type: "object",
      properties: { motion: { $ref: "#/$defs/motionWithPath" } },
      $defs: {
        motion: { type: "object", properties: { startX: { type: "number", title: "Start X" } } },
        motionWithPath: {
          allOf: [
            { $ref: "#/$defs/motion" },
            { type: "object", properties: { path0X: { type: "number", title: "Path point X" } } },
          ],
        },
      },
    };

    const fields = inspectorFieldsFromJsonDocument("src/Hero.comp.json", document, schema, "/motion");
    expect(fields.map((field) => field.label)).toEqual(["Start X", "Path point X"]);
  });
});
