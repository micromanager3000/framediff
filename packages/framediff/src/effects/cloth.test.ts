import { describe, expect, it } from "vitest";
import { createClothComposition, createClothSimulation } from "./cloth";
import type { CompositionConfig } from "../composition";

const base = {
  fps: 30,
  width: 2,
  height: 1.2,
  segmentsX: 6,
  segmentsY: 4,
  substeps: 2,
  iterations: 4,
  seed: 17,
  checkpointIntervalFrames: 5,
} as const;

describe("cloth simulation", () => {
  it("derives the same frame through forward, backward, and direct seeks", () => {
    const simulation = createClothSimulation({
      ...base,
      wind: (time) => [Math.sin(time) * 0.4, 0, 0.8 + Math.cos(time * 1.3) * 0.2],
      impulses: [{ frame: 8, uv: [0.5, 0.5], force: [0, 0, 3], radius: 0.3 }],
    });
    simulation.seek(24);
    const forward = Array.from(simulation.positions);

    simulation.seek(3);
    simulation.seek(24);
    expect(Array.from(simulation.positions)).toEqual(forward);

    const direct = createClothSimulation({
      ...base,
      wind: (time) => [Math.sin(time) * 0.4, 0, 0.8 + Math.cos(time * 1.3) * 0.2],
      impulses: [{ frame: 8, uv: [0.5, 0.5], force: [0, 0, 3], radius: 0.3 }],
    });
    direct.seek(24);
    expect(Array.from(direct.positions)).toEqual(forward);
    expect(direct.currentFrame).toBe(24);
  });

  it("keeps the selected pin set fixed", () => {
    const simulation = createClothSimulation({ ...base, pins: "top", wind: [0.5, 0, 1] });
    const initial = simulation.positions.slice();
    simulation.seek(30);

    for (let column = 0; column < simulation.columns; column++) {
      const offset = column * 3;
      expect(Array.from(simulation.positions.slice(offset, offset + 3)))
        .toEqual(Array.from(initial.slice(offset, offset + 3)));
      expect(simulation.pinned[column]).toBe(1);
    }
  });

  it("applies scripted UV impulses without mutating pinned vertices", () => {
    const still = createClothSimulation({ ...base, gravity: [0, 0, 0], initialPerturbation: 0 });
    const poked = createClothSimulation({
      ...base,
      gravity: [0, 0, 0],
      initialPerturbation: 0,
      impulses: [{ frame: 2, uv: [0.5, 0.5], force: [0, 0, 5], radius: 0.35 }],
    });
    still.seek(6);
    poked.seek(6);

    const center = (2 * poked.columns + 3) * 3 + 2;
    expect(poked.positions[center]).toBeGreaterThan(still.positions[center] + 0.01);
    expect(poked.positions[2]).toBe(still.positions[2]);
  });

  it("projects vertices outside sphere and plane colliders", () => {
    const radius = 0.34;
    const floor = -0.42;
    const simulation = createClothSimulation({
      ...base,
      gravity: [0, -4, 0],
      colliders: [
        { type: "sphere", center: [0, 0, 0], radius },
        { type: "plane", normal: [0, 1, 0], offset: floor },
      ],
    });
    simulation.seek(12);

    for (let point = 0; point < simulation.positions.length / 3; point++) {
      if (simulation.pinned[point]) continue;
      const offset = point * 3;
      const x = simulation.positions[offset];
      const y = simulation.positions[offset + 1];
      const z = simulation.positions[offset + 2];
      expect(y).toBeGreaterThanOrEqual(floor - 1e-6);
      expect(Math.hypot(x, y, z)).toBeGreaterThanOrEqual(radius - 1e-5);
    }
  });

  it("projects vertices outside capsule colliders", () => {
    const radius = 0.28;
    const start = [0, -0.25, 0] as const;
    const end = [0, 0.25, 0] as const;
    const simulation = createClothSimulation({
      ...base,
      gravity: [0, 0, 0],
      colliders: [{ type: "capsule", start, end, radius }],
    });
    simulation.seek(4);

    for (let point = 0; point < simulation.positions.length / 3; point++) {
      if (simulation.pinned[point]) continue;
      const offset = point * 3;
      const x = simulation.positions[offset];
      const y = simulation.positions[offset + 1];
      const z = simulation.positions[offset + 2];
      const closestY = Math.max(start[1], Math.min(end[1], y));
      expect(Math.hypot(x, y - closestY, z)).toBeGreaterThanOrEqual(radius - 1e-5);
    }
  });

  it("maintains finite unit vertex normals", () => {
    const simulation = createClothSimulation({ ...base, wind: [0.2, 0, 0.6] });
    simulation.seek(18);
    for (let index = 0; index < simulation.normals.length; index += 3) {
      const length = Math.hypot(
        simulation.normals[index],
        simulation.normals[index + 1],
        simulation.normals[index + 2],
      );
      expect(Number.isFinite(length)).toBe(true);
      expect(length).toBeCloseTo(1, 5);
    }
  });
});

describe("cloth composition", () => {
  const source: CompositionConfig = {
    definition: { version: 1, type: "html", kind: "scene" },
    id: "TitleCard",
    html: '<main data-fd-composition data-fd-id="TitleCard" data-fd-width="960" data-fd-height="540" data-fd-fps="24" data-fd-duration="120"></main>',
    width: 960,
    height: 540,
    fps: 24,
    durationInFrames: 120,
    meta: { module: "src/compositions/TitleCard.ts" },
  };

  it("wraps a registered composition as the animated texture source", () => {
    const cloth = createClothComposition(source, {
      id: "TitleCardMaterial",
      sourceKey: "title-card",
      width: 1280,
      height: 720,
      fit: "cover",
      document: { wind: 0.2 },
      meta: { document: { file: "src/TitleCardMaterial.comp.json" } },
    });

    expect(cloth).toMatchObject({
      id: "TitleCardMaterial",
      width: 1280,
      height: 720,
      fps: 24,
      durationInFrames: 120,
      meta: {
        deps: ["src/compositions/TitleCard.ts"],
        authoring: { timeline: "hidden", transport: "always", directManipulation: false },
      },
    });
    expect(cloth.html).toContain('data-fd-comp="title-card"');
    expect(cloth.html).toContain('data-fd-fit="cover"');
    expect(cloth.html).toContain('data-fd-cloth-source="#fd-cloth-input"');
    expect(cloth.setup).toBeTypeOf("function");
  });

  it("escapes authored wrapper attributes", () => {
    const cloth = createClothComposition(source, {
      id: 'Material "One"',
      sourceKey: "title&card",
      background: "linear-gradient(#111, #222)",
      document: { wind: 0.2 },
      meta: { document: { file: "src/MaterialOne.comp.json" } },
    });

    expect(cloth.html).toContain('data-fd-id="Material &quot;One&quot;"');
    expect(cloth.html).toContain('data-fd-comp="title&amp;card"');
  });
});
