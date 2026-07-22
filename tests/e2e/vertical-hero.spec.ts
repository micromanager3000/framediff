import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const verticalBase = "http://127.0.0.1:4180";
const lowerDocumentFile = "examples/vertical-hero/src/compositions/VerticalLowerThird.comp.json";
const lowerHtmlFile = "examples/vertical-hero/src/compositions/VerticalLowerThird.html";
const mainTimelineFile = "examples/vertical-hero/src/compositions/VerticalMain.timeline.json";
const mainHtmlFile = "examples/vertical-hero/src/compositions/VerticalMain.html";
const generatorFile = "examples/vertical-hero/src/gen/VerticalAtmosphere.gen.ts";

test("the from-scratch portrait comp edits JSON without rebuilding Studio", async ({ page }) => {
  const originalDocumentText = await readFile(lowerDocumentFile, "utf8");
  const originalHtml = await readFile(lowerHtmlFile, "utf8");
  const originalName = JSON.parse(originalDocumentText).name.text as string;
  const editedName = `${originalName} · live`;

  try {
    await page.goto(`${verticalBase}/?comp=vertical-lower-third`);
    await expect(page.locator(".top-status")).toHaveText("ready");
    await expect(page.locator(".transport")).toBeVisible();
    await expect(page.getByRole("group", { name: /Timeline/ })).toHaveCount(0);
    await expect(page.locator('[data-fd-id="lower-name"]')).toHaveText(originalName);

    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.locator('[data-fd-id="VerticalLowerThird"]').evaluate((root) => root.setAttribute("data-hot-patch-probe", "same-root"));
    const nameBounds = await page.locator('[data-fd-id="lower-name"]').boundingBox();
    expect(nameBounds).not.toBeNull();
    await page.mouse.click(nameBounds!.x + nameBounds!.width / 2, nameBounds!.y + nameBounds!.height / 2);
    await expect(page.getByText("composition JSON", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Copy text" }).fill(editedName);
    await page.getByRole("button", { name: "PROPS", exact: true }).click();

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

test("a library comp drags into the portrait edit's external timeline atomically", async ({ page }) => {
  const originalTimeline = await readFile(mainTimelineFile, "utf8");
  const originalHtml = await readFile(mainHtmlFile, "utf8");
  const originalItems = JSON.parse(originalTimeline).items.length as number;

  try {
    await page.goto(`${verticalBase}/?comp=vertical-main`);
    await expect(page.locator(".top-status")).toHaveText("ready");
    const primaryCompositions = page.locator('.composition-list[role="list"]').first();
    const lowerThird = primaryCompositions.locator(".composition-row").filter({ hasText: "VerticalLowerThird" });
    const timeline = page.getByRole("group", { name: "Timeline; drop a composition to add it at a frame" });

    await lowerThird.dragTo(timeline, { targetPosition: { x: 610, y: 135 } });
    await expect.poll(async () => JSON.parse(await readFile(mainTimelineFile, "utf8")).items.length).toBe(originalItems + 1);
    await expect(timeline.locator(".clip")).toHaveCount(originalItems + 1);
    await expect(timeline.locator(".clip").filter({ hasText: "VerticalLowerThird" })).toHaveCount(1);
    expect(await readFile(mainHtmlFile, "utf8")).not.toBe(originalHtml);

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

  try {
    await page.goto(`${verticalBase}/?comp=vertical-atmosphere`);
    await expect(page.locator(".top-status")).toHaveText("ready");
    const primaryCompositions = page.locator('.composition-list[role="list"]').first();
    const main = primaryCompositions.locator(".composition-row").filter({ hasText: "VerticalMain" });
    const references = page.getByRole("group", { name: "Generation input references; drop a composition to add it" });

    await main.dragTo(references);
    await expect(page.getByRole("button", { name: "Remove video reference VerticalMain", exact: true })).toBeVisible();
    await expect.poll(async () => readFile(generatorFile, "utf8")).toContain('src: "comp://vertical-main"');

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => readFile(generatorFile, "utf8")).toBe(originalGenerator);
  } finally {
    if (await readFile(generatorFile, "utf8") !== originalGenerator) await writeFile(generatorFile, originalGenerator);
  }
});

test("the portrait root can render an exact non-empty frame", async ({ page }) => {
  await page.goto(`${verticalBase}/?comp=vertical-main`);
  await expect(page.locator(".top-status")).toHaveText("ready");
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
