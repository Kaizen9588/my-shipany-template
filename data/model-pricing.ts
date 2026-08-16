/**
 * 模型定价表（AI 网关闭环 6.0）
 *
 * 服务端白名单 + 定价单一真相源：客户端只能传这里登记的 model id，
 * 不能传任意模型字符串（否则可绕开定价）。v1 用常量表，v3 再入数据库。
 *
 * credits_per_1k_tokens：每 1K tokens 消耗的积分数（小数）
 * max_output_tokens：输出上限，作为预估扣费的上限依据
 */
export const MODEL_PRICING = {
  "gpt-4o": {
    provider: "openai",
    credits_per_1k_tokens: 2.5,
    max_output_tokens: 4096,
  },
  "gpt-4o-mini": {
    provider: "openai",
    credits_per_1k_tokens: 0.15,
    max_output_tokens: 4096,
  },
  "deepseek-chat": {
    provider: "deepseek",
    credits_per_1k_tokens: 0.14,
    max_output_tokens: 4096,
  },
  "deepseek/deepseek-r1": {
    provider: "openrouter",
    credits_per_1k_tokens: 0.55,
    max_output_tokens: 8192,
  },
  "deepseek-ai/DeepSeek-R1": {
    provider: "siliconflow",
    credits_per_1k_tokens: 0.55,
    max_output_tokens: 8192,
  },
} as const;

export type ModelId = keyof typeof MODEL_PRICING;

export interface ModelPricing {
  provider: string;
  credits_per_1k_tokens: number;
  max_output_tokens: number;
}

export function getModelPricing(model: string): ModelPricing | undefined {
  return MODEL_PRICING[model as ModelId];
}

/**
 * 预估一次扣清的积分：ceil((估算输入 token + 输出上限) × credits_per_1k / 1000)
 * 输入 token 粗估 ≈ 输入文本长度 / 4
 *
 * 2.9 修复：messages 数组按 JSON 序列化长度计入输入（此前传 messages 时
 * prompt 为空串，全部上下文 0 计费而调用优先使用 messages，平台白担成本）。
 * 粗估口径与 prompt 一致，不追求精确 token 数（多估一点点优于漏估）。
 */
export function estimateCredits(
  pricing: ModelPricing,
  prompt: string,
  maxTokens?: number,
  messages?: unknown
): number {
  const promptLength = prompt.length + estimateMessagesLength(messages);
  const inputTokens = Math.ceil(promptLength / 4);
  const outputTokens = maxTokens || pricing.max_output_tokens;
  const estimated =
    ((inputTokens + outputTokens) * pricing.credits_per_1k_tokens) / 1000;

  return Math.max(1, Math.ceil(estimated));
}

/** messages 序列化长度估算：非法类型按 0 计（generate 路由会另行校验） */
function estimateMessagesLength(messages: unknown): number {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 0;
  }
  try {
    return JSON.stringify(messages).length;
  } catch {
    return 0;
  }
}

// 图片/视频按次扣费（决策 5.1，v2 实现，模型先定义）
export const IMAGE_MODEL_PRICING = {
  "dall-e-3": { provider: "openai", credits_per_image: 5 },
  "stability-ai/sdxl": { provider: "replicate", credits_per_image: 3 },
  "kling-image": { provider: "kling", credits_per_image: 8 },
} as const;

export const VIDEO_MODEL_PRICING = {
  "kling-v1": { provider: "kling", credits_per_video: 50 },
} as const;
