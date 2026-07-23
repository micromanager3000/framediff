import { expect, type Page } from "@playwright/test";

function attributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export async function openComposition(page: Page, compositionKey: string, url = "/"): Promise<void> {
  await page.goto(url);
  await expect(page.locator(".top-status")).toHaveText("ready");
  const selector = `.composition-row[data-composition-key="${attributeValue(compositionKey)}"]`;
  const rows = page.locator(selector);
  expect(await rows.count()).toBeGreaterThan(0);
  const row = rows.first();
  await row.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(row).toHaveClass(/active/);
  await expect(page).not.toHaveURL(/[?&]comp=/);
}
