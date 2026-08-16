import { describe, expect, it } from "vitest";
import {
  IMAGE_MODEL_PRICING,
  VIDEO_MODEL_PRICING,
} from "@/data/model-pricing";

describe("data/model-pricing 图片/视频定价", () => {
  it("图片模型定价字段齐全且大于 0", () => {
    for (const [id, p] of Object.entries(IMAGE_MODEL_PRICING)) {
      expect(p.provider).toBeTruthy();
      expect(p.credits_per_image).toBeGreaterThan(0);
      expect(id).toBeTruthy();
    }
  });

  it("视频模型定价字段齐全且大于 0", () => {
    for (const [id, p] of Object.entries(VIDEO_MODEL_PRICING)) {
      expect(p.provider).toBeTruthy();
      expect(p.credits_per_video).toBeGreaterThan(0);
      expect(id).toBeTruthy();
    }
  });
});
