import { expect, test } from "@playwright/test";
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
