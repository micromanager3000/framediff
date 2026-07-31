import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { openComposition } from "./helpers";

test("a draft take is an obvious, repeatable path back to editing", async ({ page }) => {
  await openComposition(page, "harborShot", "http://127.0.0.1:4175/");
  await expect(page).toHaveTitle("FrameDiff — Previz to Generation");
  await expect(page.locator(".top-status")).toHaveText("ready");

  await expect(page.getByRole("button", { name: "Add Take", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "↳ Draft from latest", exact: true })).toHaveCount(0);
  await expect(page.getByText("HISTORICAL TAKE 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview take 5", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider", { name: "Synchronized comparison frame", exact: true })).toBeVisible();
  await expect(page.getByLabel("Generated take 5", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Synchronized comparison of HarborPreviz and take 5").getByText("HarborPreviz", { exact: true }),
  ).toBeVisible();
  const synchronizedFrame = page.getByRole("slider", { name: "Synchronized comparison frame", exact: true });
  await synchronizedFrame.fill("90");
  await expect(synchronizedFrame).toHaveValue("90");
  await expect.poll(() => page.getByLabel("Generated take 5", { exact: true }).evaluate(
    (video: HTMLVideoElement) => Math.round(video.currentTime * 10) / 10,
  )).toBe(3);

  await page.getByRole("button", { name: "Back to current draft", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Generation model", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Reference type", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Reference source", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove video reference HarborPreviz", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use take 4", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Preview take 4", exact: true }).click();
  await expect(page.getByText("HISTORICAL TAKE 4", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Take from This", exact: true })).toBeVisible();

  const draft = page.getByRole("button", { name: "Edit the draft for take 6", exact: true });
  await draft.click();
  const prompt = page.getByRole("textbox", { name: "PROMPT", exact: true });
  await expect(prompt).toBeEditable();
  await expect(prompt).toBeFocused();

  await draft.click();
  await expect(prompt).toBeFocused();
});

test("generative rows advertise their output kind and input comps link to their source", async ({ page }) => {
  await openComposition(page, "harborShot", "http://127.0.0.1:4175/");

  // The rail marks every generative comp with its locked output kind.
  await expect(page.locator('.composition-row[data-composition-key="harborShot"] .out-badge').first()).toHaveText("video");
  await expect(page.locator('.composition-row[data-composition-key="lighthouse-dialogue-audio"] .out-badge').first()).toHaveText("audio");
  await expect(page.locator('.composition-row[data-composition-key="lighthouse-keeper"] .out-badge').first()).toHaveText("image");
  await expect(page.locator('.composition-row[data-composition-key="lighthouse-workflow"] .out-badge')).toHaveCount(0);

  // A comp-backed input reference is a link into its source composition; the geometry
  // line stays behind as the input-handling toggle.
  await page.getByRole("button", { name: "Back to current draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Adjust how HarborPreviz is adapted for the model", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open composition HarborPreviz", exact: true }).click();
  await expect(page.locator('.composition-row[data-composition-key="harbor-previz"]').first()).toHaveClass(/active/);
});

test("legacy phone-local geometry keeps the pinned Lighthouse take visible", async ({ page }) => {
  await openComposition(page, "lighthouse-workflow", "http://127.0.0.1:4175/");

  const editPreview = page.locator(
    '.workspace:not(.generate-workspace) > .preview-panel > .preview-surface > .preview-host > .preview-runtime-host',
  );
  const finalFrame = editPreview.locator('[data-fd-id="workflow-final"]');
  const finalVideo = finalFrame.locator("video[data-gen-output]");
  await expect(finalFrame).toHaveCount(1);
  await expect(finalVideo).toHaveCount(1);
  await expect.poll(() => finalFrame.evaluate((frame) => {
    const phone = frame.closest<HTMLElement>(".phone")!;
    const video = frame.querySelector<HTMLVideoElement>("video[data-gen-output]")!;
    const frameRect = frame.getBoundingClientRect();
    const phoneRect = phone.getBoundingClientRect();
    const overlapWidth = Math.max(0, Math.min(frameRect.right, phoneRect.right) - Math.max(frameRect.left, phoneRect.left));
    const overlapHeight = Math.max(0, Math.min(frameRect.bottom, phoneRect.bottom) - Math.max(frameRect.top, phoneRect.top));
    return {
      layoutSpace: frame.getAttribute("data-fd-layout-space"),
      layoutLocalX: frame.getAttribute("data-fd-layout-local-x"),
      layoutLocalY: frame.getAttribute("data-fd-layout-local-y"),
      visibleInsidePhone: overlapWidth * overlapHeight / Math.max(1, frameRect.width * frameRect.height) > 0.9,
      hasPinnedSource: video.currentSrc.includes("/__framediff-cache/"),
    };
  })).toEqual({
    layoutSpace: null,
    layoutLocalX: null,
    layoutLocalY: null,
    visibleInsidePhone: true,
    hasPinnedSource: true,
  });
});

test("a CUSTOM comp owns frame logic without owning a timeline", async ({ page }) => {
  await openComposition(page, "lighthouse-workflow-steps", "http://127.0.0.1:4175/");

  await expect(page.getByText("custom · video · 400×600 · 420f", { exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Preview frame" })).toBeVisible();
  await expect(page.getByRole("group", { name: /Timeline/ })).toHaveCount(0);

  const customPreview = page.locator(
    '.workspace:not(.generate-workspace) > .preview-panel > .preview-surface > .preview-host > .preview-runtime-host',
  );
  await page.getByRole("slider", { name: "Preview frame" }).fill("75");
  await expect(customPreview.locator('[data-fd-id="workflow-stage-2"]')).toHaveClass(/active/);
  await expect(customPreview.locator('[data-fd-id="workflow-stage-1"]')).not.toHaveClass(/active/);

  await openComposition(page, "lighthouse-workflow", "http://127.0.0.1:4175/");
  const sharedVisualLayer = page.locator('.lane[data-lane-id="v:2"]');
  await expect(sharedVisualLayer).toHaveAttribute("data-visual-rows", "4");
  const visualTops = await sharedVisualLayer.locator(".clip").evaluateAll((clips) =>
    clips.map((clip) => Math.round(clip.getBoundingClientRect().top)));
  expect(new Set(visualTops).size).toBe(4);

  const editPreview = page.locator(
    '.workspace:not(.generate-workspace) > .preview-panel > .preview-surface > .preview-host > .preview-runtime-host',
  );
  const nestedCustom = editPreview.locator(
    '[data-fd-id="workflow-steps"] [data-fd-id="LighthouseWorkflowSteps"]',
  );
  await expect(nestedCustom).toHaveCount(1);
  await expect(nestedCustom.locator('[data-fd-id="workflow-stage-1"]')).toHaveClass(/active/);

  const customClip = page.locator('.clip[data-item-id="workflow-steps"]');
  await expect(customClip).toBeVisible();
  await customClip.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.getByRole("textbox", { name: "composition text" })).toHaveValue("lighthouse-workflow-steps");
  await expect(page.getByRole("spinbutton", { name: "width number" })).toHaveValue("400");
  await expect(page.getByRole("spinbutton", { name: "height number" })).toHaveValue("600");
  await expect(page.getByRole("spinbutton", { name: "corner radius number" })).toHaveValue("0");
});

test("image and audio composition outputs embed as media instead of authoring UI", async ({ page }) => {
  await openComposition(page, "lighthouse-workflow", "http://127.0.0.1:4175/");

  const editPreview = page.locator(
    '.workspace:not(.generate-workspace) > .preview-panel > .preview-surface > .preview-host > .preview-runtime-host',
  );
  const referenceBoard = editPreview.locator('[data-fd-id="workflow-concept"]');
  await expect(referenceBoard).toHaveAttribute("data-fd-output-kind", "image");
  await expect(referenceBoard.locator('[data-fd-id="LighthouseConcept"]')).toHaveCount(0);
  await expect.poll(() => referenceBoard.evaluate((element) =>
    getComputedStyle(element).backgroundImage)).toContain("/__framediff-cache/");
  await expect.poll(() => referenceBoard.evaluate(async (element) => {
    const outputUrl = getComputedStyle(element).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
    if (!outputUrl) return null;
    return (await fetch(outputUrl)).headers.get("content-type");
  })).toContain("image/png");

  const audioLane = page.locator('.lane[data-lane-id="a:0"]');
  await expect(audioLane.locator('.clip[data-item-id="workflow-audio"]')).toHaveCount(1);
  const lockedAudio = editPreview.locator('audio[data-fd-id="workflow-audio"]');
  await expect(lockedAudio).toHaveAttribute("data-fd-output-kind", "audio");
  await expect(lockedAudio.locator(".gen-slate")).toHaveCount(0);
  await expect(lockedAudio.locator(".framediff-nested-host")).toHaveCount(0);
  await expect.poll(() => lockedAudio.evaluate((audio: HTMLAudioElement) =>
    audio.currentSrc)).toContain("/__framediff-cache/");

  await audioLane.locator('.clip[data-item-id="workflow-audio"]').click();
  await expect(page.locator(".canvas-selection")).toHaveCount(0);

  const approvalCard = page.locator('.clip[data-item-id="workflow-audio-card"]');
  await expect(approvalCard).toBeVisible();
  const approvalCardNode = editPreview.locator('[data-fd-id="workflow-audio-card"]');
  const approvalCardBounds = await approvalCardNode.boundingBox();
  expect(approvalCardBounds).not.toBeNull();
  await page.mouse.click(
    approvalCardBounds!.x + approvalCardBounds!.width / 2,
    approvalCardBounds!.y + approvalCardBounds!.height / 2,
  );
  await expect(page.getByLabel("Selected Audio approval card")).toBeVisible();
  await expect(page.locator(".resize-handle")).toHaveCount(8);
});

test("a JSON-authored audio-output composition controls preview and export gain", async ({ page }) => {
  const timelineFile = "examples/previz-to-gen/src/compositions/LighthouseWorkflow.timeline.json";
  const htmlFile = "examples/previz-to-gen/src/compositions/LighthouseWorkflow.html";
  const originalTimeline = await readFile(timelineFile, "utf8");
  const originalHtml = await readFile(htmlFile, "utf8");
  try {
    await openComposition(page, "lighthouse-workflow", "http://127.0.0.1:4175/");

    const timeline = JSON.parse(originalTimeline) as { items: Array<{ id: string; volume?: number }> };
    expect(timeline.items.find((item) => item.id === "workflow-audio")?.volume).toBe(1);
    expect(originalHtml).not.toContain("data-fd-volume");

    await page.locator('.clip[data-item-id="workflow-audio"]').evaluate((element) =>
      (element as HTMLButtonElement).click());
    await expect(page.getByRole("heading", { name: "COMPOSITION AUDIO" })).toBeVisible();
    const volume = page.getByRole("spinbutton", { name: "volume number" });
    await expect(volume).toHaveValue("1");

    const editPreview = page.locator(
      '.workspace:not(.generate-workspace) > .preview-panel > .preview-surface > .preview-host > .preview-runtime-host',
    );
    await expect(editPreview).toHaveCount(1);
    const approvalAudio = editPreview.locator('audio[data-fd-id="workflow-audio"][data-framediff-audio]');
    await expect(approvalAudio).toHaveCount(1);
    await expect.poll(() => approvalAudio.evaluate((audio: HTMLAudioElement) => ({
      clipVolume: audio.dataset.fdVolume,
      previewVolume: audio.volume,
      exportVolume: audio.dataset.framediffVolume,
    }))).toEqual({
      clipVolume: "1",
      previewVolume: 1,
      exportVolume: "1",
    });

    await volume.fill("0.25");
    await volume.press("Tab");
    await expect.poll(async () => {
      const document = JSON.parse(await readFile(timelineFile, "utf8")) as { items: Array<{ id: string; volume?: number }> };
      return document.items.find((item) => item.id === "workflow-audio")?.volume;
    }).toBe(0.25);
    await expect.poll(() => approvalAudio.evaluate((audio: HTMLAudioElement) => ({
      previewVolume: audio.volume,
      exportVolume: audio.dataset.framediffVolume,
    }))).toEqual({ previewVolume: 0.25, exportVolume: "0.25" });
    expect(await readFile(htmlFile, "utf8")).toBe(originalHtml);

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => readFile(timelineFile, "utf8")).toBe(originalTimeline);
    await expect.poll(() => approvalAudio.evaluateAll((audio) =>
      audio.map((element) => (element as HTMLAudioElement).dataset.framediffVolume))).toEqual(["1"]);

    // The final generated video supplies picture only. The locked audio composition is the sole
    // audio authority in the edit, so the two outputs cannot double up.
    const finalVideo = editPreview.locator('[data-fd-id="workflow-final"] video[data-framediff-video]');
    await expect(finalVideo).toHaveCount(1);
    await expect.poll(() => finalVideo.evaluate((video: HTMLVideoElement) => ({
      previewVolume: video.volume,
      exportVolume: video.dataset.framediffVolume,
    }))).toEqual({
      previewVolume: 0,
      exportVolume: "0",
    });

    await page.locator('.clip[data-item-id="workflow-audio"]').evaluate((element) =>
      (element as HTMLButtonElement).click());
    await expect(page.getByText(
      "Removes only this timeline placement. The source composition remains available. Undo restores it.",
      { exact: true },
    )).toBeVisible();
    await page.getByRole("button", { name: "DELETE FROM TIMELINE" }).click();
    await page.getByRole("button", { name: "CONFIRM DELETE" }).click();

    await expect.poll(async () => {
      const document = JSON.parse(await readFile(timelineFile, "utf8")) as { items: Array<{ id: string }> };
      return document.items.some((item) => item.id === "workflow-audio");
    }).toBe(false);
    await expect(page.locator('.clip[data-item-id="workflow-audio"]')).toHaveCount(0);
    await expect(page.locator('.clip[data-item-id="workflow-audio-card"]')).toHaveCount(1);
    await expect(finalVideo).toHaveCount(1);
    await expect.poll(() => finalVideo.evaluate((video: HTMLVideoElement) => ({
      display: getComputedStyle(video).display,
      readyState: video.readyState,
      source: video.currentSrc,
    }))).toMatchObject({
      display: "block",
      readyState: 4,
      source: expect.stringContaining("/__framediff-cache/"),
    });
    const libraryAudio = page.locator('.library-zone .composition-row[data-composition-key="lighthouse-dialogue-audio"]');
    await expect(libraryAudio).toHaveCount(1);
    await expect(page.getByText(
      "Removed Locked dialogue performance from the timeline. lighthouseDialogueAudio remains available.",
      { exact: true },
    )).toBeVisible();

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => readFile(timelineFile, "utf8")).toBe(originalTimeline);
    await expect.poll(async () => readFile(htmlFile, "utf8")).toBe(originalHtml);
    await expect(page.locator('.clip[data-item-id="workflow-audio"]')).toHaveCount(1);
    await expect(finalVideo).toHaveCount(1);
  } finally {
    if (await readFile(timelineFile, "utf8") !== originalTimeline) await writeFile(timelineFile, originalTimeline);
    if (await readFile(htmlFile, "utf8") !== originalHtml) await writeFile(htmlFile, originalHtml);
  }
});
