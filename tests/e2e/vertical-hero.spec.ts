import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { openComposition } from "./helpers";

const verticalBase = "http://127.0.0.1:4180";
const lowerDocumentFile = "examples/vertical-hero/src/compositions/VerticalLowerThird.comp.json";
const lowerHtmlFile = "examples/vertical-hero/src/compositions/VerticalLowerThird.html";
const backdropModuleFile = "examples/vertical-hero/src/compositions/VerticalBackdrop.ts";
const mainTimelineFile = "examples/vertical-hero/src/compositions/VerticalMain.timeline.json";
const mainHtmlFile = "examples/vertical-hero/src/compositions/VerticalMain.html";
const generatorFile = "examples/vertical-hero/src/gen/VerticalAtmosphere.gen.ts";
const generatorDataFile = "examples/vertical-hero/src/gen/VerticalAtmosphere.gen.json";

async function readOptionalFile(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

test("the from-scratch portrait comp edits JSON without rebuilding Studio", async ({ page }) => {
  const originalDocumentText = await readFile(lowerDocumentFile, "utf8");
  const originalHtml = await readFile(lowerHtmlFile, "utf8");
  const originalName = JSON.parse(originalDocumentText).name.text as string;
  const editedName = `${originalName} · live`;

  try {
    await openComposition(page, "vertical-lower-third", verticalBase);
    await expect(page.locator(".transport")).toBeVisible();
    await expect(page.getByRole("group", { name: /Timeline/ })).toHaveCount(0);
    await expect(page.getByRole("slider", { name: "Preview frame" })).toBeVisible();
    await expect(page.locator('[data-fd-id="lower-name"]')).toHaveText(originalName);

    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.locator('[data-fd-id="VerticalLowerThird"]').evaluate((root) => root.setAttribute("data-hot-patch-probe", "same-root"));
    const nameBounds = await page.locator('[data-fd-id="lower-name"]').boundingBox();
    expect(nameBounds).not.toBeNull();
    await page.mouse.click(nameBounds!.x + nameBounds!.width / 2, nameBounds!.y + nameBounds!.height / 2);
    await expect(page.getByText("composition JSON", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Copy text" }).fill(editedName);
    await page.getByRole("button", { name: "INSPECT", exact: true }).click();

    await expect.poll(async () => JSON.parse(await readFile(lowerDocumentFile, "utf8")).name.text).toBe(editedName);
    await expect(page.locator('[data-fd-id="lower-name"]')).toHaveText(editedName);
    expect(await readFile(lowerHtmlFile, "utf8")).toBe(originalHtml);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await expect(page.locator('[data-fd-id="VerticalLowerThird"]')).toHaveAttribute("data-hot-patch-probe", "same-root");

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(lowerDocumentFile, "utf8")).name.text).toBe(originalName);
  } finally {
    if (await readFile(lowerDocumentFile, "utf8") !== originalDocumentText) await writeFile(lowerDocumentFile, originalDocumentText);
    if (await readFile(lowerHtmlFile, "utf8") !== originalHtml) await writeFile(lowerHtmlFile, originalHtml);
  }
});

test("the first recorded gesture bootstraps motion source and commits without an error", async ({ page }) => {
  const originalModule = await readFile(backdropModuleFile, "utf8");

  try {
    await openComposition(page, "vertical-backdrop", verticalBase);
    const scrubber = page.getByRole("slider", { name: "Preview frame" });
    await expect(scrubber).toBeVisible();
    await scrubber.fill("90");
    await expect(page.locator(".timecode")).toHaveText("0090f");
    await expect(page.getByRole("heading", { name: "COMPOSITION PROPERTIES" })).toBeVisible();
    await expect(page.getByText("Drift", { exact: true })).toBeVisible();
    await expect(page.getByText("Select a clip for timing, trim, layers, grade and production state.", { exact: true })).toHaveCount(0);
    const orbBounds = await page.locator('[data-fd-id="backdrop-orb-a"]').boundingBox();
    const compositionBounds = await page.locator('[data-fd-id="VerticalBackdrop"]').boundingBox();
    expect(orbBounds).not.toBeNull();
    expect(compositionBounds).not.toBeNull();
    // Orb B overlaps most of Orb A at this frame; use A's exposed right edge so the
    // canvas hit test selects the intended layer instead of the topmost sibling.
    const start = { x: compositionBounds!.x + compositionBounds!.width - 16, y: orbBounds!.y + orbBounds!.height / 2 };
    await page.mouse.click(start.x, start.y);
    await expect(page.locator(".inspector > header strong")).toHaveText("backdrop-orb-a");
    await page.getByRole("button", { name: "Record a move" }).click();

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let index = 1; index <= 14; index += 1) {
      await page.mouse.move(start.x - index * 7, start.y + Math.sin(index / 3) * 28, { steps: 2 });
      await page.waitForTimeout(38);
    }
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "Save move" })).toBeEnabled();
    await page.getByRole("button", { name: "Save move" }).click();

    await expect.poll(async () => readOptionalFile(backdropModuleFile)).toContain("defineGsapTimeline");
    const committed = await readFile(backdropModuleFile, "utf8");
    expect(committed).toContain("setup: framediffRecordedMotionSetup");
    expect(committed).toContain('id: "backdrop-orb-a-motion-path"');
    expect(committed).toContain("motionPath:");
    await expect.poll(async () => page.evaluate(async () => {
      const inspected = await window.__framediffAgent!.inspect();
      return inspected.compositions
        .find((entry) => entry.composition.key === "vertical-backdrop")
        ?.animations.some((animation) => animation.id === "backdrop-orb-a-motion-path");
    })).toBe(true);
    await expect(page.getByText("This module has no inline defineGsapTimeline() registration.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => readOptionalFile(backdropModuleFile)).toBe(originalModule);
  } finally {
    if (await readOptionalFile(backdropModuleFile) !== originalModule) await writeFile(backdropModuleFile, originalModule);
  }
});

test("a library comp writes only to the portrait edit's external timeline and undoes atomically", async ({ page }) => {
  const originalTimeline = await readFile(mainTimelineFile, "utf8");
  const originalHtml = await readFile(mainHtmlFile, "utf8");
  const originalItems = JSON.parse(originalTimeline).items.length as number;

  try {
    await openComposition(page, "vertical-main", verticalBase);
    const primaryCompositions = page.locator('.composition-list[role="list"]').first();
    const lowerThird = primaryCompositions.locator(".composition-row").filter({ hasText: "VerticalLowerThird" });
    const timeline = page.getByRole("group", { name: "Timeline; drop a composition to add it at a frame" });

    await lowerThird.dragTo(timeline, { targetPosition: { x: 610, y: 135 } });
    await expect.poll(async () => JSON.parse(await readFile(mainTimelineFile, "utf8")).items.length).toBe(originalItems + 1);
    await expect(timeline.locator(".clip")).toHaveCount(originalItems + 1);
    await expect(timeline.locator(".clip").filter({ hasText: "VerticalLowerThird" })).toHaveCount(1);
    expect(await readFile(mainHtmlFile, "utf8")).toBe(originalHtml);

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => readFile(mainTimelineFile, "utf8")).toBe(originalTimeline);
    await expect.poll(async () => readFile(mainHtmlFile, "utf8")).toBe(originalHtml);
  } finally {
    if (await readFile(mainTimelineFile, "utf8") !== originalTimeline) await writeFile(mainTimelineFile, originalTimeline);
    if (await readFile(mainHtmlFile, "utf8") !== originalHtml) await writeFile(mainHtmlFile, originalHtml);
  }
});

test("a comp drags into the portrait generative recipe as a comp reference", async ({ page }) => {
  const originalGenerator = await readFile(generatorFile, "utf8");
  const originalGeneratorData = await readFile(generatorDataFile, "utf8");

  try {
    await openComposition(page, "vertical-atmosphere", verticalBase);
    const primaryCompositions = page.locator('.composition-list[role="list"]').first();
    const main = primaryCompositions.locator(".composition-row").filter({ hasText: "VerticalMain" });
    const references = page.getByRole("group", { name: "Generation input references; drop media or a composition to add it" });

    await main.dragTo(references);
    await expect(page.getByRole("button", { name: "Remove video reference VerticalMain", exact: true })).toBeVisible();
    await expect.poll(async () => {
      const recipe = JSON.parse(await readFile(generatorDataFile, "utf8")) as { refs: Array<{ src: string }> };
      return recipe.refs.some((ref) => ref.src === "comp://vertical-main");
    }).toBe(true);
    expect(await readFile(generatorFile, "utf8")).toBe(originalGenerator);

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => readFile(generatorDataFile, "utf8")).toBe(originalGeneratorData);
    expect(await readFile(generatorFile, "utf8")).toBe(originalGenerator);
  } finally {
    if (await readFile(generatorFile, "utf8") !== originalGenerator) await writeFile(generatorFile, originalGenerator);
    if (await readFile(generatorDataFile, "utf8") !== originalGeneratorData) await writeFile(generatorDataFile, originalGeneratorData);
  }
});

test("the portrait root can render an exact non-empty frame", async ({ page }) => {
  await openComposition(page, "vertical-main", verticalBase);
  const result = await page.evaluate(async () => {
    const inspected = await window.__framediffAgent!.inspect();
    const frame = await window.__framediffAgent!.snapshot("vertical-main", 60);
    const main = inspected.compositions.find((entry) => entry.composition.key === "vertical-main")!;
    return {
      width: main.composition.width,
      height: main.composition.height,
      dataUrlLength: frame.dataUrl.length,
    };
  });
  expect(result).toEqual({ width: 1080, height: 1920, dataUrlLength: expect.any(Number) });
  expect(result.dataUrlLength).toBeGreaterThan(10_000);
});
