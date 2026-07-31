import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { openComposition } from "./helpers";

async function openPlayground(page: Page): Promise<void> {
  await openComposition(page, "studio-playground");
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

test("an obsolete composition query is removed and cannot override the project root", async ({ page }) => {
  await page.goto("/?comp=production-lab");
  await expect(page.locator(".top-status")).toHaveText("ready");
  await expect(page).toHaveURL("http://127.0.0.1:4174/");
  await expect(page.locator(".breadcrumb button.active")).toHaveText("StudioPlayground");
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
  await openComposition(page, "package-effects-lab");
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

  await openComposition(page, "rich-properties-lab");
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
  const originalX = JSON.parse(originalDocumentText).resizeCard.x as number;

  try {
    await openComposition(page, "direct-manipulation-lab");
    await expect(page.locator(".transport")).toBeVisible();
    await expect(page.getByRole("slider", { name: "Preview frame" })).toBeVisible();
    await expect(page.getByRole("group", { name: /Timeline/ })).toHaveCount(0);
    await expect(page.getByText("Make movable", { exact: false })).toHaveCount(0);
    await expect(page.locator('[data-fd-id="resize-card"]')).toHaveAttribute("data-fd-x", String(originalX));
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.locator('[data-fd-id="DirectManipulationLab"]').evaluate((root) => { root.setAttribute("data-hot-patch-probe", "same-root"); });
    const bounds = await page.locator('[data-fd-id="resize-card"]').boundingBox();
    expect(bounds).not.toBeNull();
    const dragStart = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };

    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragStart.x + 72, dragStart.y + 36, { steps: 4 });
    await page.mouse.up();

    await expect.poll(async () => JSON.parse(await readFile(documentFile, "utf8")).resizeCard.x).not.toBe(originalX);
    expect(await readFile(htmlFile, "utf8")).toBe(originalHtml);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await expect(page.locator('[data-fd-id="DirectManipulationLab"]')).toHaveAttribute("data-hot-patch-probe", "same-root");
    await expect(page.getByText("composition JSON", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(documentFile, "utf8")).resizeCard.x).toBe(originalX);
    expect(await readFile(htmlFile, "utf8")).toBe(originalHtml);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  } finally {
    if (await readFile(documentFile, "utf8") !== originalDocumentText) await writeFile(documentFile, originalDocumentText);
    if (await readFile(htmlFile, "utf8") !== originalHtml) await writeFile(htmlFile, originalHtml);
  }
});

test("motion paths explain their canvas controls and make drawing mode unmistakable", async ({ page }) => {
  await openComposition(page, "gsap-motion-lab");

  const productFlight = page.locator('.lane[data-animation-id="product-flight"] .animation-span');
  await expect(productFlight).toHaveCount(1);
  await productFlight.click();

  await expect(page.getByRole("heading", { name: "ROUTE", exact: true })).toBeVisible();
  await expect(page.getByText("Shape the object’s route on canvas", { exact: true })).toBeVisible();
  await expect(page.getByText("Solid stops set positions; hollow handles shape the curve. Timing stays in the keys below.", { exact: true })).toBeVisible();
  await expect(page.locator(".path-points")).not.toHaveAttribute("open", "");
  await expect(page.locator(".canvas-context-hud.motion")).toContainText("solid stops set positions");
  await expect(page.locator(".timeline-empty")).toHaveText("No clips in this scene — the motion lanes below drive the composition.");

  await page.getByRole("button", { name: "Record a move" }).click();
  await expect(page.locator(".canvas-overlay")).toHaveClass(/gesture-active/);
  await expect(page.locator(".gesture-mode-hud")).toContainText("Playback starts when you drag the selected object");

  await page.keyboard.press("Escape");
  await expect(page.locator(".gesture-mode-hud")).toHaveCount(0);
  await expect(page.locator(".canvas-overlay")).not.toHaveClass(/gesture-active/);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("a composition can be dragged directly onto an edit timeline and undone", async ({ page }) => {
  await openComposition(page, "editorial-lab");

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

test("timeline v2 shapes share JSON layout, canvas resize, and stacking authority", async ({ page }) => {
  const timelineFile = "examples/studio-playground/src/compositions/labs/EditorialLab.timeline.json";
  const originalTimeline = await readFile(timelineFile, "utf8");

  try {
    await openComposition(page, "editorial-lab");
    await expect(page.getByRole("button", { name: "PATH", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "PATH", exact: true }).click();

    await expect.poll(async () => {
      const document = JSON.parse(await readFile(timelineFile, "utf8"));
      return { version: document.version, shape: document.items.find((item: { id: string }) => item.id === "path-shape") };
    }).toMatchObject({
      version: 2,
      shape: {
        layer: 2,
        content: { type: "shape", shape: "path" },
        layout: { fit: "fill", cornerRadius: 0, opacity: 1 },
      },
    });

    const shapeClip = page.locator('.clip[data-item-id="path-shape"]');
    const shapeNode = page.locator('[data-fd-id="path-shape"]');
    await expect(shapeClip).toBeVisible();
    await expect(shapeNode).toBeVisible();
    await shapeClip.click();
    await expect(page.getByRole("heading", { name: "LAYOUT", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "SHAPE", exact: true })).toBeVisible();
    const shapeBounds = await shapeNode.boundingBox();
    expect(shapeBounds).not.toBeNull();
    await page.mouse.click(shapeBounds!.x + shapeBounds!.width / 2, shapeBounds!.y + shapeBounds!.height / 2);
    await expect(page.locator(".resize-handle")).toHaveCount(8);

    const beforeResize = JSON.parse(await readFile(timelineFile, "utf8")).items
      .find((item: { id: string }) => item.id === "path-shape").layout.rect as number[];
    const resizeHandle = page.locator('.resize-handle[data-resize-handle="se"]');
    const handleBounds = await resizeHandle.boundingBox();
    expect(handleBounds).not.toBeNull();
    await page.mouse.move(handleBounds!.x + handleBounds!.width / 2, handleBounds!.y + handleBounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBounds!.x + handleBounds!.width / 2 + 48, handleBounds!.y + handleBounds!.height / 2 + 28, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => JSON.parse(await readFile(timelineFile, "utf8")).items
      .find((item: { id: string }) => item.id === "path-shape").layout.rect[2]).toBeGreaterThan(beforeResize[2]);

    const cornerRadius = page.getByRole("spinbutton", { name: "corner radius number" });
    await cornerRadius.fill("36");
    await cornerRadius.press("Tab");
    await expect.poll(async () => JSON.parse(await readFile(timelineFile, "utf8")).items
      .find((item: { id: string }) => item.id === "path-shape").layout.cornerRadius).toBe(36);

    const targetLane = page.locator('.lane[data-lane-id="v:1"]');
    const clipBounds = await shapeClip.boundingBox();
    const targetBounds = await targetLane.boundingBox();
    expect(clipBounds).not.toBeNull();
    expect(targetBounds).not.toBeNull();
    await page.mouse.move(clipBounds!.x + clipBounds!.width / 2, clipBounds!.y + clipBounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(clipBounds!.x + clipBounds!.width / 2, targetBounds!.y + targetBounds!.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => JSON.parse(await readFile(timelineFile, "utf8")).items
      .find((item: { id: string }) => item.id === "path-shape").layer).toBe(1);
    await expect(shapeNode).toHaveCSS("z-index", "1");
  } finally {
    if (await readFile(timelineFile, "utf8") !== originalTimeline) await writeFile(timelineFile, originalTimeline);
  }
});

test("edit clips expose video audio controls and reversible item and layer deletion", async ({ page }) => {
  const timelineFile = "examples/studio-playground/src/compositions/labs/EditorialLab.timeline.json";
  const htmlFile = "examples/studio-playground/src/compositions/labs/EditorialLab.html";
  const originalTimeline = await readFile(timelineFile, "utf8");
  const originalHtml = await readFile(htmlFile, "utf8");

  try {
    await openComposition(page, "editorial-lab");
    const mediaClip = page.locator('.clip[data-item-id="editorial-media"]');
    await mediaClip.evaluate((element) => (element as HTMLButtonElement).click());
    await expect(page.getByRole("heading", { name: "VIDEO AUDIO" })).toBeVisible();

    const volume = page.getByRole("spinbutton", { name: "volume number" });
    await expect(volume).toHaveValue("1");
    await volume.fill("0.35");
    await volume.press("Tab");
    await expect.poll(async () => JSON.parse(await readFile(timelineFile, "utf8")).items[0].volume).toBe(0.35);
    const previewVideo = page.locator('[data-fd-id="editorial-media"] video');
    await expect.poll(() => previewVideo.evaluate((video: HTMLVideoElement) => ({
      volume: video.volume,
      exportVolume: video.dataset.framediffVolume,
    }))).toEqual({ volume: 0.35, exportVolume: "0" });

    const muted = page.getByRole("checkbox", { name: "muted" });
    await expect(muted).toBeChecked();
    await muted.uncheck();
    await expect.poll(async () => JSON.parse(await readFile(timelineFile, "utf8")).items[0].muted).toBe(false);
    await expect.poll(() => previewVideo.evaluate((video: HTMLVideoElement) => ({
      muted: video.muted,
      exportVolume: video.dataset.framediffVolume,
    }))).toEqual({ muted: false, exportVolume: "0.35" });

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => readFile(timelineFile, "utf8")).toBe(originalTimeline);

    await mediaClip.evaluate((element) => (element as HTMLButtonElement).click());
    await page.getByRole("button", { name: "DELETE FROM TIMELINE" }).click();
    await page.getByRole("button", { name: "CONFIRM DELETE" }).click();
    await expect.poll(async () => JSON.parse(await readFile(timelineFile, "utf8")).items.some((item: { id: string }) => item.id === "editorial-media")).toBe(false);
    await expect.poll(async () => readFile(htmlFile, "utf8")).not.toContain('data-fd-id="editorial-media"');
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => readFile(timelineFile, "utf8")).toBe(originalTimeline);
    await expect.poll(async () => readFile(htmlFile, "utf8")).toBe(originalHtml);

    const deleteLayer = page.locator('.lane[data-lane-id="v:0"] .delete-lane');
    // Undo restores source first; wait for the follow-up probe to restore the
    // original V1 contents before acting on that lane again.
    await expect(page.locator('.lane[data-lane-id="v:0"] .clip[data-item-id="editorial-media"]')).toBeVisible();
    await expect(deleteLayer).toHaveAttribute("aria-label", "Delete V1");
    await deleteLayer.click();
    await expect(deleteLayer).toHaveAttribute("aria-label", "Confirm delete V1");
    await deleteLayer.click();
    await expect.poll(async () => {
      const items = JSON.parse(await readFile(timelineFile, "utf8")).items as Array<{ id: string }>;
      return items.some((item) => item.id === "editorial-media" || item.id === "editorial-wash");
    }).toBe(false);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => readFile(timelineFile, "utf8")).toBe(originalTimeline);
    await expect.poll(async () => readFile(htmlFile, "utf8")).toBe(originalHtml);
  } finally {
    if (await readFile(timelineFile, "utf8") !== originalTimeline) await writeFile(timelineFile, originalTimeline);
    if (await readFile(htmlFile, "utf8") !== originalHtml) await writeFile(htmlFile, originalHtml);
  }
});

test("a composition can be dragged into a generative recipe and undone", async ({ page }) => {
  await openPlayground(page);
  const primaryCompositions = page.locator('.composition-list[role="list"]').first();
  const rows = primaryCompositions.locator(".composition-row");
  // Previously "Blah" — one of five scratch compositions accidentally committed into this
  // example. skyTimelapse is a real video-output recipe and exercises the same drop target.
  await rows.filter({ hasText: "skyTimelapse" }).click();
  await expect(page.locator(".breadcrumb button.active")).toHaveText("skyTimelapse");

  // Opening a recipe auto-previews its latest saved take, and skyTimelapse ships with one.
  // That view is read only — input references only exist on the editable draft.
  const backToDraft = page.getByRole("button", { name: "Back to current draft", exact: true });
  if (await backToDraft.count()) await backToDraft.click();
  await expect(page.getByRole("combobox", { name: "Generation model", exact: true })).toBeVisible();

  const endCard = rows.filter({ hasText: "EndCard" });
  const references = page.getByRole("group", { name: "Generation input references; drop media or a composition to add it" });
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
    await openComposition(page, "cloth-lab");
    await expect(page.locator(".transport")).toBeVisible();
    await expect(page.getByRole("slider", { name: "Preview frame" })).toBeVisible();
    await expect(page.getByRole("group", { name: /Timeline/ })).toHaveCount(0);
    await page.getByRole("button", { name: "INSPECT", exact: true }).click();
    const gravity = page.locator('label[title$="/simulation/gravityY"] input[type="number"]');
    await expect(gravity).toHaveValue(String(originalGravity));
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.locator('[data-fd-id="ClothLab"]').evaluate((root) => { root.setAttribute("data-hot-patch-probe", "same-root"); });

    await gravity.fill(String(editedGravity));
    await page.getByRole("button", { name: "INSPECT", exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(documentFile, "utf8")).simulation.gravityY).toBe(editedGravity);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await expect(page.locator('[data-fd-id="ClothLab"]')).toHaveAttribute("data-hot-patch-probe", "same-root");

    await page.getByRole("button", { name: "INSPECT", exact: true }).click();
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

test("the 3D camera editor loads its deferred runtime on demand", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await openComposition(page, "HeroPlane3D.uizoom");
  await page.locator('[data-fd-id="plane-uizoom"]').click({ force: true });
  await page.getByRole("button", { name: "OPEN 3D RIG EDITOR" }).click();

  await expect(page.getByRole("dialog", { name: "3D camera rig editor" })).toBeVisible();
  await expect(page.locator(".camera-rig-canvas canvas")).toBeVisible();
  await expect(page.locator(".camera-rig-load-state.error")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
