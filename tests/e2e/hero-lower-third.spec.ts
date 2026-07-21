import { expect, test } from "@playwright/test";

test("the hero example opens its hero composition rather than Studio Playground", async ({ page }) => {
  await page.goto("http://127.0.0.1:4176/");

  await expect(page).toHaveTitle("FrameDiff — Hero Lower Third");
  await expect(page.locator(".top-status")).toHaveText("ready");
  await expect(page.locator(".breadcrumb button.active")).toHaveText("HeroWithLowerThird");
  await expect(page.locator('[data-fd-id="HeroWithLowerThird"]')).toHaveCount(1);
  await expect(page.locator(".composition-row").filter({ hasText: "StudioPlayground" })).toHaveCount(0);
});
