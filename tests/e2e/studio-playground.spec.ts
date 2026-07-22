import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

async function openPlayground(page: Page): Promise<void> {
  await page.goto("/?comp=studio-playground");
  await expect(page).toHaveTitle("FrameDiff — Studio Playground");
  await expect(page.locator(".top-status")).toHaveText("ready");
  await expect(page.getByRole("heading", { name: "Every system." })).toBeVisible();
}

test("the default project presents the complete nested acceptance graph", async ({ page }) => {
  const missingLocalMedia: string[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() === 404 && path.startsWith("/audio/")) missingLocalMedia.push(path);
  });

  await page.goto("/");
  await expect(page.locator(".top-status")).toHaveText("ready");
  await expect(page.locator(".breadcrumb button.active")).toHaveText("StudioPlayground");
  await expect(page.locator(".clip[data-item-id^=playground-]")).toHaveCount(7);

  const expected = ["CoverageMap", "AuthoringChapter", "EditorialChapter", "EffectsChapter", "PipelineChapter"];
  for (const id of expected) await expect(page.locator(".composition-row").filter({ hasText: id }).first()).toBeVisible();
  expect(missingLocalMedia).toEqual([]);
});

test("a user can descend root to chapter to leaf and return through breadcrumbs", async ({ page }) => {
  await openPlayground(page);

  await page.locator('.clip[data-item-id="playground-authoring"]').dblclick();
  await expect(page.locator(".breadcrumb button.active")).toHaveText("AuthoringChapter");
  await expect(page.locator('.clip[data-item-id="author-direct"]')).toBeVisible();

  await page.locator('.clip[data-item-id="author-direct"]').dblclick();
  await expect(page.locator(".breadcrumb button")).toHaveText(["StudioPlayground", "AuthoringChapter", "DirectManipulationLab"]);
  await expect(page.locator('[data-fd-id="lab-title"]')).toContainText("Edit JSON at the speed of thought.");

  await page.getByRole("button", { name: "AuthoringChapter", exact: true }).click();
  await expect(page.locator(".breadcrumb button.active")).toHaveText("AuthoringChapter");
});

test("the Guide starts at the map and targets a real nested chapter next", async ({ page }) => {
  await openPlayground(page);

  await page.getByRole("button", { name: "START TOUR" }).click();
  await expect(page.locator(".guide-task-bar strong")).toHaveText("Read the capability map");
  await page.getByRole("button", { name: "DONE · NEXT" }).click();
  await expect(page.locator(".guide-task-bar strong")).toHaveText("Open a chapter, then a focused leaf");
  await expect(page.locator(".breadcrumb button.active")).toHaveText("AuthoringChapter");
  await expect(page.locator('.clip[data-item-id="author-direct"]')).toHaveClass(/selected/);
});

test("the packaged effects lab keeps visual and audio timing on separate lanes", async ({ page }) => {
  await page.goto("/?comp=package-effects-lab");
  await expect(page.locator(".top-status")).toHaveText("ready");
  await expect(page.locator('.clip[data-item-id="effects-scene"]')).toBeVisible();
  await expect(page.locator('.clip[data-item-id="effects-scene"]')).toHaveText(/Packaged DOM effects/);
  await expect(page.locator('.clip[data-item-id="effects-audio"]')).toBeVisible();
  await expect(page.locator('.lane[data-lane-kind="video"] .clip[data-item-id="effects-scene"]')).toHaveCount(1);
  await expect(page.locator('.lane[data-lane-kind="audio"] .clip[data-item-id="effects-audio"]')).toHaveCount(1);
});

test("embedded composition textures never escape into stray network requests", async ({ page }) => {
  const missingTextureRequests: string[] = [];
  page.on("response", (response) => {
    if (response.status() === 404 && response.url().includes("%23n")) missingTextureRequests.push(response.url());
  });

  await page.goto("/?comp=rich-properties-lab");
  await expect(page.locator(".top-status")).toHaveText("ready");
  await expect(page.locator('[data-fd-id="rich-headline"]')).toContainText("Click any object. Edit the document.");
  await expect(page.locator(".transport")).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "Preview frame" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: /Timeline/ })).toHaveCount(0);
  const gradientBounds = await page.locator('[data-fd-id="gradient-panel"]').boundingBox();
  expect(gradientBounds).not.toBeNull();
  await page.mouse.click(gradientBounds!.x + gradientBounds!.width / 2, gradientBounds!.y + gradientBounds!.height / 2);
  await expect(page.locator(".inspector > header strong")).toHaveText("gradient-panel");
  await expect(page.getByText("composition JSON", { exact: true })).toBeVisible();
  expect(missingTextureRequests).toEqual([]);
});

test("direct manipulation is immediate and writes bound geometry to composition JSON", async ({ page }) => {
  const documentFile = "examples/studio-playground/src/compositions/labs/DirectManipulationLab.comp.json";
  const htmlFile = "examples/studio-playground/src/compositions/labs/DirectManipulationLab.html";
  const originalDocumentText = await readFile(documentFile, "utf8");
  const originalHtml = await readFile(htmlFile, "utf8");
  const originalX = JSON.parse(originalDocumentText).moveCard.x as number;

  try {
    await page.goto("/?comp=direct-manipulation-lab");
    await expect(page.locator(".top-status")).toHaveText("ready");
    await expect(page.locator(".transport")).toBeVisible();
    await expect(page.getByRole("slider", { name: "Preview frame" })).toBeVisible();
    await expect(page.getByRole("group", { name: /Timeline/ })).toHaveCount(0);
    await expect(page.getByText("Make movable", { exact: false })).toHaveCount(0);
    await expect(page.locator('[data-fd-id="move-card"]')).toHaveAttribute("data-fd-x", String(originalX));
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.locator('[data-fd-id="DirectManipulationLab"]').evaluate((root) => { root.setAttribute("data-hot-patch-probe", "same-root"); });
    const bounds = await page.locator('[data-fd-id="move-card"]').boundingBox();
    expect(bounds).not.toBeNull();

    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width / 2 + 72, bounds!.y + bounds!.height / 2 + 36, { steps: 4 });
    await page.mouse.up();

    await expect.poll(async () => JSON.parse(await readFile(documentFile, "utf8")).moveCard.x).not.toBe(originalX);
    expect(await readFile(htmlFile, "utf8")).toBe(originalHtml);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await expect(page.locator('[data-fd-id="DirectManipulationLab"]')).toHaveAttribute("data-hot-patch-probe", "same-root");
    await expect(page.getByText("composition JSON", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(documentFile, "utf8")).moveCard.x).toBe(originalX);
    expect(await readFile(htmlFile, "utf8")).toBe(originalHtml);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  } finally {
    if (await readFile(documentFile, "utf8") !== originalDocumentText) await writeFile(documentFile, originalDocumentText);
    if (await readFile(htmlFile, "utf8") !== originalHtml) await writeFile(htmlFile, originalHtml);
  }
});

test("a composition can be dragged directly onto an edit timeline and undone", async ({ page }) => {
  await page.goto("/?comp=editorial-lab");
  await expect(page.locator(".top-status")).toHaveText("ready");

  const primaryCompositions = page.locator('.composition-list[role="list"]').first();
  const endCard = primaryCompositions.locator(".composition-row").filter({ hasText: "EndCard" });
  const timeline = page.getByRole("group", { name: "Timeline; drop a composition to add it at a frame" });
  await expect(endCard).toHaveCount(1);
  await expect(timeline).toBeVisible();

  await endCard.dragTo(timeline, { targetPosition: { x: 430, y: 115 } });
  const nestedClip = timeline.locator(".clip").filter({ hasText: "EndCard" });
  await expect(nestedClip).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(nestedClip).toHaveCount(0);
});

test("a composition can be dragged into a generative recipe and undone", async ({ page }) => {
  await openPlayground(page);
  const primaryCompositions = page.locator('.composition-list[role="list"]').first();
  const rows = primaryCompositions.locator(".composition-row");
  await rows.filter({ hasText: "Blah" }).click();
  await expect(page.locator(".breadcrumb button.active")).toHaveText("Blah");

  const endCard = rows.filter({ hasText: "EndCard" });
  const references = page.getByRole("group", { name: "Generation input references; drop a composition to add it" });
  await expect(endCard).toHaveCount(1);
  await expect(references).toBeVisible();

  await endCard.dragTo(references);
  const addedReference = page.getByRole("button", { name: "Remove video reference EndCard", exact: true });
  await expect(addedReference).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(addedReference).toHaveCount(0);
});

test("a JSON-only property edit hot-patches the comp without reloading Studio", async ({ page }) => {
  const documentFile = "examples/studio-playground/src/compositions/playground/ClothLab.comp.json";
  const originalText = await readFile(documentFile, "utf8");
  const originalDocument = JSON.parse(originalText) as { simulation: { gravityY: number } };
  const originalGravity = originalDocument.simulation.gravityY;
  const editedGravity = originalGravity - 1.1;

  try {
    await page.goto("/?comp=cloth-lab");
    await expect(page.locator(".top-status")).toHaveText("ready");
    await expect(page.locator(".transport")).toBeVisible();
    await expect(page.getByRole("slider", { name: "Preview frame" })).toBeVisible();
    await expect(page.getByRole("group", { name: /Timeline/ })).toHaveCount(0);
    await page.getByRole("button", { name: "PROPS", exact: true }).click();
    const gravity = page.locator('label[title$="/simulation/gravityY"] input[type="number"]');
    await expect(gravity).toHaveValue(String(originalGravity));
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.locator('[data-fd-id="ClothLab"]').evaluate((root) => { root.setAttribute("data-hot-patch-probe", "same-root"); });

    await gravity.fill(String(editedGravity));
    await page.getByRole("button", { name: "PROPS", exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(documentFile, "utf8")).simulation.gravityY).toBe(editedGravity);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await expect(page.locator('[data-fd-id="ClothLab"]')).toHaveAttribute("data-hot-patch-probe", "same-root");

    await page.getByRole("button", { name: "PROPS", exact: true }).click();
    await expect(gravity).toHaveValue(String(editedGravity));
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(documentFile, "utf8")).simulation.gravityY).toBe(originalGravity);
    await expect(gravity).toHaveValue(String(originalGravity));
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  } finally {
    if (await readFile(documentFile, "utf8") !== originalText) await writeFile(documentFile, originalText);
  }
});

test("the agent surface can inspect every new composition kind", async ({ page }) => {
  await openPlayground(page);

  const result = await page.evaluate(async () => {
    const snapshot = await window.__framediffAgent!.inspect();
    const requested = ["studio-playground", "rich-properties-lab", "coverage-map", "cloth-lab", "world-lab", "audio-lab", "skyTimelapse"];
    return requested.map((key) => {
      const entry = snapshot.compositions.find((candidate) => candidate.composition.key === key);
      return { key, kind: entry?.composition.kind, objects: entry?.objects.length ?? 0 };
    });
  });

  expect(result).toEqual([
    { key: "studio-playground", kind: "edit", objects: 7 },
    { key: "rich-properties-lab", kind: "scene", objects: 0 },
    { key: "coverage-map", kind: "doc", objects: 0 },
    { key: "cloth-lab", kind: "3d", objects: 1 },
    { key: "world-lab", kind: "3d", objects: 2 },
    { key: "audio-lab", kind: "audio", objects: 2 },
    { key: "skyTimelapse", kind: "generate", objects: 1 },
  ]);

  const visual = await page.evaluate(async () => {
    const frame = await window.__framediffAgent!.snapshot("studio-playground", 0);
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not decode the exact Playground frame"));
      image.src = frame.dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 54;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    let brightPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const [red, green, blue] = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
      colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
      if (red + green + blue > 430) brightPixels += 1;
    }
    const rail = document.querySelector<HTMLElement>(".playground-rail")!.getBoundingClientRect();
    const root = document.querySelector<HTMLElement>('[data-fd-id="StudioPlayground"]')!.getBoundingClientRect();
    return { colors: colors.size, brightPixels, railTop: (rail.top - root.top) / root.height };
  });
  expect(visual.colors).toBeGreaterThan(40);
  expect(visual.brightPixels).toBeGreaterThan(20);
  expect(visual.railTop).toBeGreaterThan(0.9);
});
