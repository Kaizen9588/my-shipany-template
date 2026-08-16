import { describe, expect, it } from "vitest";
import {
  MODEL_PRICING,
  estimateCredits,
  getModelPricing,
} from "@/data/model-pricing";

describe("data/model-pricing（6.0 AI 网关闭环）", () => {
  it("白名单包含常用模型", () => {
    expect(getModelPricing("deepseek-chat")).toBeDefined();
    expect(getModelPricing("gpt-4o-mini")).toBeDefined();
    expect(getModelPricing("gpt-4o")).toBeDefined();
  });

  it("白名单外模型返回 undefined（客户端不可绕开定价）", () => {
    expect(getModelPricing("gpt-4-ultra-hacker")).toBeUndefined();
    expect(getModelPricing("")).toBeUndefined();
  });

  it("定价字段齐全", () => {
    for (const [id, p] of Object.entries(MODEL_PRICING)) {
      expect(p.provider).toBeTruthy();
      expect(p.credits_per_1k_tokens).toBeGreaterThan(0);
      expect(p.max_output_tokens).toBeGreaterThan(0);
      expect(id).toBeTruthy();
    }
  });

  it("预估一次扣清：至少 1 积分且随输出上限增长", () => {
    const pricing = getModelPricing("deepseek-chat")!;
    const small = estimateCredits(pricing, "short prompt");
    const large = estimateCredits(pricing, "short prompt", 4096);
    expect(small).toBeGreaterThanOrEqual(1);
    expect(large).toBeGreaterThanOrEqual(small);
  });

  it("长提示词预估积分更高（按 token 折算）", () => {
    const pricing = getModelPricing("gpt-4o")!;
    const short = estimateCredits(pricing, "hi");
    const long = estimateCredits(pricing, "x".repeat(4000));
    expect(long).toBeGreaterThan(short);
  });
});
