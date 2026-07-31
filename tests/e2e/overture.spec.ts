import { expect, test } from "@playwright/test";

/**
 * The first-run overture is deliberately suppressed under automation — it is a curtain, and a
 * curtain that a script has to know how to dismiss would break the e2e suite and, more
 * importantly, the agent surface this product exposes on `window.__framediffAgent`.
 *
 * `?overture=1` forces it back on so the thing itself stays covered rather than becoming the one
 * piece of first-run UX no test ever looks at.
 */
test.describe("the first-run overture", () => {
  test("stays out of the way of automation by default", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".top-status")).toHaveText("ready");
    await expect(page.locator(".studio-overture")).toHaveCount(0);
    // The Studio is immediately usable — nothing to dismiss first.
    await expect(page.locator(".composition-row").first()).toBeVisible();
  });

  test("greets a first-time user, and any key dismisses it for good", async ({ page }) => {
    await page.goto("/?overture=1");
    const overture = page.locator(".studio-overture");
    await expect(overture).toBeVisible();

    // The three things a newcomer most needs, and an honest count of what loaded.
    await expect(overture.getByText("Press Space")).toBeVisible();
    await expect(overture.getByText("Click the canvas")).toBeVisible();
    await expect(overture.getByText("Hit Render")).toBeVisible();
    // An honest count of what actually loaded, not a generic welcome. (Rendered uppercase by
    // CSS, so the assertion matches the underlying text.)
    await expect(overture.locator(".overture-facts")).toContainText(/\d+ composition/);

    await page.keyboard.press("Escape");
    await expect(overture).toHaveCount(0);

    // Dismissal is remembered, so the greeting never becomes a recurring toll.
    await page.goto("/");
    await expect(page.locator(".top-status")).toHaveText("ready");
    await expect(page.locator(".studio-overture")).toHaveCount(0);
  });

  test("hands the walkthrough over when asked", async ({ page }) => {
    await page.goto("/?overture=1");
    const overture = page.locator(".studio-overture");
    await expect(overture).toBeVisible();

    await overture.getByRole("button", { name: /walkthrough/i }).click();
    await expect(overture).toHaveCount(0);
    // The guide panel is open and showing this project's walkthrough, not a generic help screen.
    await expect(page.locator(".studio-guide")).toBeVisible();
  });
});
