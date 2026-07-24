import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { openComposition } from "./helpers";

test("a draft take is an obvious, repeatable path back to editing", async ({ page }) => {
  await openComposition(page, "harborShot", "http://127.0.0.1:4175/");
  await expect(page).toHaveTitle("FrameDiff — Previz to Generation");
  await expect(page.locator(".top-status")).toHaveText("ready");

  await expect(page.getByRole("button", { name: "Add Take", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "↳ Draft from latest", exact: true })).toHaveCount(0);
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

test("a JSON-authored nested volume controls preview and export gain", async ({ page }) => {
  const timelineFile = "examples/previz-to-gen/src/compositions/LighthouseWorkflow.timeline.json";
  const htmlFile = "examples/previz-to-gen/src/compositions/LighthouseWorkflow.html";
  const originalTimeline = await readFile(timelineFile, "utf8");
  const originalHtml = await readFile(htmlFile, "utf8");
  try {
    await openComposition(page, "lighthouse-workflow", "http://127.0.0.1:4175/");

    const timeline = JSON.parse(originalTimeline) as { items: Array<{ id: string; volume?: number }> };
    expect(timeline.items.find((item) => item.id === "workflow-audio")?.volume).toBe(0);
    expect(originalHtml).not.toContain("data-fd-volume");

    await page.locator('.clip[data-item-id="workflow-audio"]').evaluate((element) =>
      (element as HTMLButtonElement).click());
    await expect(page.getByRole("heading", { name: "COMPOSITION AUDIO" })).toBeVisible();
    const volume = page.getByRole("spinbutton", { name: "volume number" });
    await expect(volume).toHaveValue("0");

    const editPreview = page.locator(
      '.workspace:not(.generate-workspace) > .preview-panel > .preview-surface > .preview-host > .preview-runtime-host',
    );
    await expect(editPreview).toHaveCount(1);
    const approvalAudio = editPreview.locator('[data-fd-id="workflow-audio"] audio[data-framediff-audio]');
    await expect(approvalAudio).toHaveCount(1);
    await expect.poll(() => approvalAudio.evaluate((audio: HTMLAudioElement) => ({
      clipVolume: audio.closest<HTMLElement>("[data-fd-comp]")?.dataset.fdVolume,
      previewVolume: audio.volume,
      exportVolume: audio.dataset.framediffVolume,
    }))).toEqual({
      clipVolume: "0",
      previewVolume: 0,
      exportVolume: "0",
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
    await expect.poll(() => approvalAudio.evaluate((audio: HTMLAudioElement) =>
      audio.dataset.framediffVolume)).toBe("0");

    // The final generated video is a separate audible layer. Silencing the approval reference
    // must not accidentally mute that sibling.
    const finalVideo = editPreview.locator('[data-fd-id="workflow-final"] video[data-framediff-video]');
    await expect(finalVideo).toHaveCount(1);
    await expect.poll(() => finalVideo.evaluate((video: HTMLVideoElement) => ({
      previewVolume: video.volume,
      exportVolume: video.dataset.framediffVolume,
    }))).toEqual({
      previewVolume: 1,
      exportVolume: "1",
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
