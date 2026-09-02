import { describe, expect, it } from "vitest";
import {
  MODEL_PRICING,
  estimateCredits,
  estimateTextTokens,
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

  it("中文 prompt 不再按 /4 低估：CJK 1 token/字，同字符数下中文扣费高于英文", () => {
    const pricing = getModelPricing("gpt-4o")!; // 2.5 积分/1k，粗估差异可传导到积分差
    // 同一输出上限下，1000 个汉字的输入 token 粗估应 ≥ 1000（1 token/字），
    // 而旧口径 1000/4=250 会把 1000 字中文按 250 token 收费
    const cjkTokens = estimateTextTokens("测".repeat(1000));
    expect(cjkTokens).toBeGreaterThanOrEqual(1000);
    const latinTokens = estimateTextTokens("a".repeat(1000));
    expect(latinTokens).toBe(250); // 1000/4
    // 扣费差异传导：中文预估积分高于等长英文
    expect(estimateCredits(pricing, "测".repeat(1000), 100)).toBeGreaterThan(
      estimateCredits(pricing, "a".repeat(1000), 100)
    );
    // 混合文本：JSON 序列化里的标点/引号按拉丁口径
    const mixed = estimateTextTokens('{"role":"user","content":"你好"}');
    expect(mixed).toBeGreaterThan(0);
    expect(mixed).toBeLessThan(
      estimateTextTokens("你好".repeat(5)) // 纯中文相同汉字数
    );
  });
});
