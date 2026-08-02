import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import { StudioChromeViewModel } from "./StudioChrome.ViewModel";

describe("StudioChromeViewModel", () => {
  it("opens explicitly requested compact panels and can dismiss the overlay", () => {
    const chrome = new StudioChromeViewModel();
    expect(get(chrome.store)).toMatchObject({ leftOpen: false, right: "inspector", rightOpen: false });

    chrome.openLeft();
    expect(get(chrome.store)).toMatchObject({ leftOpen: true, rightOpen: false });

    chrome.showLeft("media");
    expect(get(chrome.store)).toMatchObject({ left: "media", leftOpen: true, rightOpen: false });

    chrome.selectRight("code");
    expect(get(chrome.store)).toMatchObject({ right: "code", rightOpen: false });

    chrome.showRight("code");
    expect(get(chrome.store)).toMatchObject({ leftOpen: false, right: "code", rightOpen: true });

    chrome.closeRight();
    expect(get(chrome.store).rightOpen).toBe(false);
    chrome.openRight();
    expect(get(chrome.store).rightOpen).toBe(true);

    chrome.openLeft();
    chrome.closePanels();
    expect(get(chrome.store)).toMatchObject({ leftOpen: false, rightOpen: false });

    chrome.setCacheOpen(true);
    expect(get(chrome.store)).toMatchObject({ cacheOpen: true, servicesOpen: false });
    chrome.setServicesOpen(true);
    expect(get(chrome.store)).toMatchObject({ cacheOpen: false, servicesOpen: true });
  });

  it("expands the guide independently of the side panels", () => {
    const chrome = new StudioChromeViewModel();
    expect(get(chrome.store).guideExpanded).toBe(false);

    chrome.toggleGuide();
    expect(get(chrome.store).guideExpanded).toBe(true);

    // The guide spans the app, so opening a side panel must not fold it away.
    chrome.showRight("inspector");
    expect(get(chrome.store)).toMatchObject({ guideExpanded: true, right: "inspector", rightOpen: true });

    chrome.setGuideExpanded(false);
    expect(get(chrome.store).guideExpanded).toBe(false);
  });
});
