import {
  LanguageModelV1,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from "ai";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { deepseek } from "@ai-sdk/deepseek";
import { openai } from "@ai-sdk/openai";

/**
 * AI 模型 Provider 抽象注册表（6.0，与支付/邮件 Provider 同构纪律）
 *
 * 新增模型供应商：写一个 adapter + registry 加一行。
 * 对内联 switch-case（旧 demo API）的替代。
 */
export interface AIModelProvider {
  id: string;
  hasValidCredentials(): boolean;
  createModel(model: string): LanguageModelV1;
  supportsStreaming(): boolean;
}

const openaiProvider: AIModelProvider = {
  id: "openai",
  hasValidCredentials() {
    return !!process.env.OPENAI_API_KEY;
  },
  createModel(model: string) {
    // ⚠️ 项目内 @ai-sdk/provider 存在双版本（ai 依赖 1.0.4 / 各 provider 依赖 1.0.12），
    // 类型不兼容但运行时一致，此处 cast 消化版本差异（见 DEVELOPMENT_PLAN 2.1 数据层说明）
    return openai(model) as unknown as LanguageModelV1;
  },
  supportsStreaming() {
    return true;
  },
};

const deepseekProvider: AIModelProvider = {
  id: "deepseek",
  hasValidCredentials() {
    return !!process.env.DEEPSEEK_API_KEY;
  },
  createModel(model: string) {
    return deepseek(model) as unknown as LanguageModelV1;
  },
  supportsStreaming() {
    return true;
  },
};

const openrouterProvider: AIModelProvider = {
  id: "openrouter",
  hasValidCredentials() {
    return !!process.env.OPENROUTER_API_KEY;
  },
  createModel(model: string) {
    const client = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    let textModel: LanguageModelV1 = client(model) as unknown as LanguageModelV1;

    // deepseek-r1 推理模型：提取 reasoning_content 为 reasoning 字段
    if (model === "deepseek/deepseek-r1") {
      textModel = wrapLanguageModel({
        model: textModel,
        middleware: extractReasoningMiddleware({
          tagName: "think",
        }),
      });
    }

    return textModel;
  },
  supportsStreaming() {
    return true;
  },
};

const siliconflowProvider: AIModelProvider = {
  id: "siliconflow",
  hasValidCredentials() {
    return !!process.env.SILICONFLOW_API_KEY && !!process.env.SILICONFLOW_BASE_URL;
  },
  createModel(model: string) {
    const client = createOpenAICompatible({
      name: "siliconflow",
      apiKey: process.env.SILICONFLOW_API_KEY,
      baseURL: process.env.SILICONFLOW_BASE_URL,
    });
    let textModel: LanguageModelV1 = client(model) as unknown as LanguageModelV1;

    if (model === "deepseek-ai/DeepSeek-R1") {
      textModel = wrapLanguageModel({
        model: textModel,
        middleware: extractReasoningMiddleware({
          tagName: "reasoning_content",
        }),
      });
    }

    return textModel;
  },
  supportsStreaming() {
    return true;
  },
};

const providers: Record<string, AIModelProvider> = {
  openai: openaiProvider,
  deepseek: deepseekProvider,
  openrouter: openrouterProvider,
  siliconflow: siliconflowProvider,
};

export function getModelProvider(
  providerId: string
): AIModelProvider | undefined {
  const p = providers[providerId];
  return p?.hasValidCredentials() ? p : undefined;
}
