import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import { StudioChromeViewModel } from "./StudioChrome.ViewModel";

describe("StudioChromeViewModel", () => {
  it("opens explicitly requested compact panels and can dismiss the overlay", () => {
    const chrome = new StudioChromeViewModel();
    expect(get(chrome.store)).toMatchObject({ right: "inspector", rightOpen: false });

    chrome.selectRight("guide");
    expect(get(chrome.store)).toMatchObject({ right: "guide", rightOpen: false });

    chrome.showRight("code");
    expect(get(chrome.store)).toMatchObject({ right: "code", rightOpen: true });

    chrome.closeRight();
    expect(get(chrome.store).rightOpen).toBe(false);
    chrome.openRight();
    expect(get(chrome.store).rightOpen).toBe(true);
  });
});
