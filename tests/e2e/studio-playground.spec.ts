import { expect, test, type Page } from "@playwright/test";

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
  await expect(page.locator('[data-fd-id="lab-title"]')).toContainText("Edit source at the speed of thought.");

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
  await expect(page.locator('[data-fd-id="rich-headline"]')).toContainText("Every visual choice stays connected.");
  expect(missingTextureRequests).toEqual([]);
});

test("the agent surface can inspect every new composition kind", async ({ page }) => {
  await openPlayground(page);

  const result = await page.evaluate(async () => {
    const snapshot = await window.__framediffAgent!.inspect();
    const requested = ["studio-playground", "coverage-map", "cloth-lab", "world-lab", "audio-lab", "skyTimelapse"];
    return requested.map((key) => {
      const entry = snapshot.compositions.find((candidate) => candidate.composition.key === key);
      return { key, kind: entry?.composition.kind, objects: entry?.objects.length ?? 0 };
    });
  });

  expect(result).toEqual([
    { key: "studio-playground", kind: "edit", objects: 7 },
    { key: "coverage-map", kind: "doc", objects: 1 },
    { key: "cloth-lab", kind: "3d", objects: 1 },
    { key: "world-lab", kind: "3d", objects: 2 },
    { key: "audio-lab", kind: "audio", objects: 2 },
    { key: "skyTimelapse", kind: "generate", objects: 0 },
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
