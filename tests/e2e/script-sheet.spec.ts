import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { openComposition } from "./helpers";

const scriptFile = "examples/previz-to-gen/src/compositions/Script.html";

test("script rows edit as one document-shaped, reversible timing surface", async ({ page }) => {
  const original = await readFile(scriptFile, "utf8");
  try {
    await openComposition(page, "script", "http://127.0.0.1:4175/");

    await expect(page.getByRole("region", { name: "Script sheet" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Script scenes" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Timeline" })).toHaveCount(0);
    await expect(page.getByLabel("Script notes")).toHaveValue(/Rows share timing with Main/);
    await expect(page.getByLabel("Source for 3 · From the lamp")).toHaveValue("harbor-previz");

    const duration = page.getByLabel("Duration for 1 · Open-water approach in seconds");
    await expect(duration).toHaveValue("3.0");
    await duration.fill("3.5");
    await duration.press("Enter");
    await expect.poll(async () => readFile(scriptFile, "utf8")).toContain(
      'data-fd-id="scene-chase" data-fd-name="2 · Boat chase" data-fd-from="105"',
    );
    await expect.poll(async () => readFile(scriptFile, "utf8")).toContain(
      'data-fd-id="scene-chase-ref" data-fd-name="chase · pinned take" data-fd-from="105" data-fd-duration="80"',
    );
    await expect.poll(async () => readFile(scriptFile, "utf8")).toContain(
      'data-fd-id="Script" data-fd-name="Harbor short — run of show" data-fd-width="1280" data-fd-height="720" data-fd-fps="30" data-fd-duration="255"',
    );

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => readFile(scriptFile, "utf8")).toBe(original);
    await expect(duration).toHaveValue("3.0");
  } finally {
    await writeFile(scriptFile, original);
  }
});

test("script preview mounts the row source with prose overlays", async ({ page }) => {
  await openComposition(page, "script", "http://127.0.0.1:4175/");

  await page.getByRole("button", { name: "PREVIEW", exact: true }).click();
  await expect(page.locator(".script-monitor")).toBeVisible();
  await expect(page.locator(".script-source-runtime video")).toBeVisible();
  await expect(page.locator(".script-preview-caption")).toHaveText("“Any light will do, when it’s the only one.”");
  await expect(page.locator(".script-preview-slate")).toContainText("Low over the swell toward the harbor mouth");
  await expect(page.locator(".script-preview-slate")).toContainText("swell, distant bell buoy");
});
