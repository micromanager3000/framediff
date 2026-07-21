import { describe, expect, it } from "vitest";
import { AE_BUMPER, AE_EDL, AE_GRID, AE_KEYNOTE, AE_PLANE_CAMERA_MOVES, AE_SPLIT, AE_TEXTS } from "./heroAep.gen";
import {
  AE_VISIBLE_FRAME_OFFSET,
  BUMPER,
  CARD_ALLYOU,
  CARD_CLOSING,
  HERO_GRID,
  HERO_KEYNOTE,
  HERO_SHOTS,
  HERO_SPLIT,
  HERO_TEXTS,
  aeVisibleFrom,
} from "./heroEdl";

const byName = <T extends { name: string }>(rows: T[], name: string) => {
  const row = rows.find((r) => r.name === name);
  if (!row) throw new Error(`missing row ${name}`);
  return row;
};

describe("hero raw EDL target timing", () => {
  it("keeps frame zero fixed and shifts AE layer entries onto the target-visible frame", () => {
    expect(AE_VISIBLE_FRAME_OFFSET).toBe(1);
    expect(aeVisibleFrom(0)).toBe(0);
    expect(aeVisibleFrom(44)).toBe(45);

    expect(byName(HERO_SHOTS, "phone").from).toBe(byName(AE_EDL, "phone").from + 1);
    expect(byName(HERO_SHOTS, "news_a").from).toBe(byName(AE_EDL, "news_a").from + 1);
    expect(byName(HERO_SHOTS, "uizoom").from).toBe(byName(AE_EDL, "uizoom").from + 1);
    expect(byName(HERO_SHOTS, "june3d").from).toBe(byName(AE_EDL, "june3d").from + 1);
  });

  it("extends the first shot so shifting the second shot does not reveal the backdrop", () => {
    const open = byName(HERO_SHOTS, "open");
    const phone = byName(HERO_SHOTS, "phone");
    expect(open.from).toBe(0);
    expect(open.durationInFrames).toBe(phone.from - open.from);
  });

  it("applies the same visible-frame rule to panes, cards, and the bumper", () => {
    expect(HERO_GRID[0].from).toBe(AE_GRID[0].from + 1);
    expect(HERO_GRID[1].from).toBe(AE_GRID[1].from + 1);
    expect(HERO_SPLIT[0].from).toBe(AE_SPLIT[0].from + 1);
    expect(HERO_KEYNOTE[0].from).toBe(AE_KEYNOTE[0].from + 8);
    expect(HERO_KEYNOTE[1].from).toBe(AE_KEYNOTE[1].from + 6);
    expect(HERO_KEYNOTE[2].from).toBe(AE_KEYNOTE[2].from + 1);

    expect(byName(HERO_TEXTS, "caption_show").from).toBe(byName(AE_TEXTS, "caption_show").from + 1);
    expect(CARD_ALLYOU.from).toBe(byName(AE_TEXTS, "card_allyou").from + 1);
    expect(CARD_CLOSING.from).toBe(byName(AE_TEXTS, "card_closing").from + 1);
    expect(BUMPER.from).toBe(AE_BUMPER.from + 1);
  });

  it("holds cam4 until the measured keynote reveal", () => {
    const cam4 = byName(HERO_SHOTS, "cam4");
    expect(cam4.from + cam4.durationInFrames).toBe(HERO_KEYNOTE[0].from);
  });

  it("ends the all-you card before the following shot becomes visible", () => {
    const hfTalk = byName(HERO_SHOTS, "hf_talk");
    expect(CARD_ALLYOU.from + CARD_ALLYOU.durationInFrames).toBe(hfTalk.from);
  });

  it("keeps each 3D shot's camera and finishing controls in one editable row", () => {
    expect(AE_PLANE_CAMERA_MOVES).toHaveLength(4);
    for (const move of AE_PLANE_CAMERA_MOVES) {
      expect(move.startFocusDistance).toBeGreaterThan(0);
      expect(move.endFocusDistance).toBeGreaterThan(0);
      expect(move.maxBlur).toBeGreaterThan(0);
      expect(move.shutterAngle).toBe(90);
      expect(move.motionBlurSamples).toBe(9);
    }
    expect(byName(AE_PLANE_CAMERA_MOVES, "uizoom").maxBlur).toBe(0.05);
  });
});
