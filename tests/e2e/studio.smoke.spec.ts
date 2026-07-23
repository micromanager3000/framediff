import { expect, test, type Page } from "@playwright/test";

async function openProductionLab(page: Page): Promise<void> {
  await page.goto("/?comp=production-lab");
  await expect(page).toHaveTitle("FrameDiff — Studio Playground");
  await expect(page.getByRole("heading", { name: "One project. Every surface." })).toBeVisible();
  await expect(page.locator(".top-status")).toHaveText("ready");
}

test("a new user can discover compositions, media, and cached artifacts", async ({ page }) => {
  await openProductionLab(page);

  const compositionControls = page.getByRole("group", { name: "ProductionLab composition controls" });
  await expect(compositionControls.getByRole("button", { name: "Bake", exact: true })).toBeVisible();
  await expect(page.locator(".topbar").getByRole("button", { name: /^Bake/ })).toHaveCount(0);

  const compositionSearch = page.getByRole("searchbox", { name: "Find a composition" });
  await compositionSearch.fill("motion");
  expect(await page.locator(".composition-row").filter({ hasText: "GsapMotionLab" }).count()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Clear composition search" }).click();

  await page.getByRole("button", { name: "MEDIA", exact: true }).click();
  const mediaSearch = page.getByRole("searchbox", { name: "Find media" });
  await mediaSearch.fill("shine");
  await expect(page.getByRole("status", { name: "Media result count" })).toHaveText(/^2\/\d+$/);
  await expect(page.locator('.asset-row[title^="Preview shine.wav ·"]')).toHaveCount(1);
  await expect(page.locator('.asset-row[title^="Preview playground-shine.wav ·"]')).toHaveCount(1);

  await page.getByRole("button", { name: "Cache", exact: true }).click();
  const cacheSearch = page.getByRole("searchbox", { name: "Find cached artifact" });
  await cacheSearch.fill("LowerThird");
  expect(await page.locator(".cache-list > div").count()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Close cache" }).click();
});

test("the guide lands on a stable object and preserves it across refresh", async ({ page }) => {
  await openProductionLab(page);

  await page.getByRole("button", { name: "START TOUR" }).click();
  await expect(page.locator(".guide-task-bar strong")).toHaveText("Read the capability map");
  await page.getByRole("button", { name: "DONE · NEXT" }).click();
  await expect(page.locator(".guide-task-bar strong")).toHaveText("Open a chapter, then a focused leaf");
  await page.getByRole("button", { name: "DONE · NEXT" }).click();
  await expect(page.locator(".breadcrumb button.active")).toHaveText("DirectManipulationLab");
  await expect(page.locator(".inspector > header strong")).toHaveText("move-card");
  await expect(page.getByRole("spinbutton", { name: /^x number$/i })).toHaveValue("161");

  await page.evaluate(() => history.replaceState(null, "", "/?comp=direct-manipulation-lab"));
  await page.reload();
  await expect(page.locator(".top-status")).toHaveText("ready");
  await expect(page.locator(".inspector > header strong")).toHaveText("move-card");
  await expect(page.getByRole("spinbutton", { name: /^x number$/i })).toHaveValue("161");
});

test("compact desktop windows keep every major panel reachable without horizontal clipping", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await openProductionLab(page);

  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    topbarWidth: document.querySelector<HTMLElement>(".topbar")?.scrollWidth ?? 0,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport);
  expect(layout.topbarWidth).toBeLessThanOrEqual(layout.viewport);
  await expect(page.locator(".right-panel")).toBeHidden();

  await page.getByRole("button", { name: "Open side panel" }).click();
  await expect(page.locator(".right-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "PROPS", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "CODE", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "GUIDE", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close side panel" }).click();
  await expect(page.locator(".right-panel")).toBeHidden();
  await expect(page.getByRole("button", { name: "Render MP4" })).toBeInViewport();
});

test("the studio stays inside a desktop, tablet, phone, and short-landscape viewport matrix", async ({ page }) => {
  await openProductionLab(page);
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1180, height: 720 },
    { width: 1024, height: 768 },
    { width: 900, height: 700 },
    { width: 768, height: 1024 },
    { width: 430, height: 932 },
    { width: 375, height: 667 },
    { width: 932, height: 430 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const metric = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          bottom: Math.round(rect.bottom),
          clientHeight: element.clientHeight,
          clientWidth: element.clientWidth,
          right: Math.round(rect.right),
          scrollHeight: element.scrollHeight,
          scrollWidth: element.scrollWidth,
        };
      };
      return {
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        main: metric(".framediff-studio > main"),
        root: metric(".framediff-studio"),
        topbar: metric(".topbar"),
        workspace: metric(".workspace"),
      };
    });

    expect(layout.documentWidth, `${viewport.width}x${viewport.height} document width`).toBeLessThanOrEqual(viewport.width);
    expect(layout.documentHeight, `${viewport.width}x${viewport.height} document height`).toBeLessThanOrEqual(viewport.height);
    for (const [name, metric] of Object.entries({ root: layout.root, topbar: layout.topbar, main: layout.main, workspace: layout.workspace })) {
      expect(metric, `${name} exists at ${viewport.width}x${viewport.height}`).not.toBeNull();
      expect(metric!.right, `${name} right edge at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(viewport.width);
      expect(metric!.bottom, `${name} bottom edge at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(viewport.height);
      expect(metric!.scrollWidth, `${name} horizontal overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(metric!.clientWidth);
      expect(metric!.scrollHeight, `${name} vertical overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(metric!.clientHeight);
    }
  }
});

test("mobile uses a canvas-first shell with reachable drawers and project actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProductionLab(page);

  await expect(page.locator(".left-panel")).toBeHidden();
  await expect(page.locator(".right-panel")).toBeHidden();

  await page.getByRole("button", { name: "Open compositions and media" }).click();
  await expect(page.locator(".left-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "COMPS", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "MEDIA", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close compositions panel" }).click();
  await expect(page.locator(".left-panel")).toBeHidden();

  await page.getByRole("button", { name: "Open side panel" }).click();
  await expect(page.locator(".right-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "PROPS", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "CODE", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close side panel" }).click();

  await page.getByRole("button", { name: "Open project actions" }).click();
  const actions = page.getByRole("complementary", { name: "Project actions menu" });
  await expect(actions).toBeVisible();
  await expect(actions.getByRole("button", { name: "Agent API v1" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Cache" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Render MP4" })).toBeInViewport();
  await actions.getByRole("button", { name: "Cache" }).click();
  await expect(page.locator(".cache-drawer")).toBeVisible();
  await page.getByRole("button", { name: "Close cache" }).click();

  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    topbarWidth: document.querySelector<HTMLElement>(".topbar")?.scrollWidth ?? 0,
    workspaceWidth: document.querySelector<HTMLElement>(".workspace")?.scrollWidth ?? 0,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(390);
  expect(layout.topbarWidth).toBeLessThanOrEqual(390);
  expect(layout.workspaceWidth).toBeLessThanOrEqual(390);
});

test("the new-composition dialog is keyboard-dismissable and restores focus", async ({ page }) => {
  await openProductionLab(page);
  const trigger = page.getByRole("button", { name: "Create a new composition" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "New composition" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("the agent check reports warning state clearly and can capture the exact frame", async ({ page }) => {
  await page.goto("/?comp=studio-playground");
  await expect(page.locator(".top-status")).toHaveText("ready");
  await page.getByRole("button", { name: "AGENT API v1" }).click();
  await expect(page.locator(".agent-check-summary strong")).toHaveText("READY WITH WARNINGS");
  await expect(page.locator(".agent-check-summary span")).toContainText("warning");
  await page.getByRole("button", { name: "SNAPSHOT CURRENT FRAME" }).click();
  await expect(page.locator(".agent-frame-result img")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".agent-frame-result figcaption")).toContainText("studio-playground · 0f");
});
