import { afterEach, describe, expect, it } from "vitest";
import { getModelProvider } from "@/lib/ai/registry";

const ORIGINAL_ENV = process.env;

describe("lib/ai/registry（6.0 Provider 抽象）", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("未配置 key 时返回 undefined", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
    delete process.env.SILICONFLOW_BASE_URL;

    expect(getModelProvider("openai")).toBeUndefined();
    expect(getModelProvider("deepseek")).toBeUndefined();
    expect(getModelProvider("openrouter")).toBeUndefined();
    expect(getModelProvider("siliconflow")).toBeUndefined();
  });

  it("配置 openai key 后返回 provider", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const p = getModelProvider("openai");
    expect(p).toBeDefined();
    expect(p!.id).toBe("openai");
    expect(p!.supportsStreaming()).toBe(true);
  });

  it("siliconflow 需要两个变量", () => {
    process.env.SILICONFLOW_API_KEY = "sk";
    expect(getModelProvider("siliconflow")).toBeUndefined();
    process.env.SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";
    expect(getModelProvider("siliconflow")).toBeDefined();
  });
});
