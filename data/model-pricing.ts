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

/**
 * 多供应商数据边界声明（docs/13 决策 3.1，2026-09-01）
 *
 * 声明而非技术拦截：告诉模板运营方「输入会被转发到哪家、该家如何处理」，不在此做 PII 脱敏。
 * 纪律：新增 provider 时本表必填（缺声明不合并）；非 "unknown" 值需有供应商官方出处，
 * 年度复核（docs/15）；trainsOnInputs 未核实前一律 "unknown"，禁止乐观默认 false。
 */
export interface ProviderDataBoundary {
  /** 输入/输出在供应商侧的保留期 */
  dataRetention: string;
  /** 是否把 API 输入用于训练；未核实写 "unknown" */
  trainsOnInputs: boolean | "unknown";
  /** 数据处理区域 */
  region: string;
  /** 面向模板运营方的脱敏建议 */
  piiAdvice: string;
  /** 供应商安全事件联系渠道 */
  incidentContact: string;
}

export const PROVIDER_DATA_BOUNDARY: Record<string, ProviderDataBoundary> = {
  openai: {
    dataRetention:
      "API 输入/输出默认保留 30 天（滥用监测），可申请零保留；已删除数据不会用于训练",
    trainsOnInputs: false,
    region: "美国（OpenAI API 默认）",
    piiAdvice:
      "营销文案类内容可透传；客服记录/用户上传文档等含 PII 场景建议先脱敏再转发",
    incidentContact: "https://trust.openai.com/（安全事件公告与联系）",
  },
  deepseek: {
    dataRetention: "未在公开文档中承诺具体保留期",
    trainsOnInputs: "unknown",
    region: "中国（供应商默认，未声明区域隔离）",
    piiAdvice:
      "留存/训练口径不明，含 PII 或商业敏感内容建议先脱敏，或仅用于非敏感生成场景",
    incidentContact: "service@deepseek.com（官方客服/安全联系入口）",
  },
  openrouter: {
    dataRetention:
      "OpenRouter 自身日志有限保留，但请求会转发到底层模型供应商，边界由底层供应商决定",
    trainsOnInputs: "unknown",
    region: "取决于所选底层模型供应商，转发链不确定",
    piiAdvice:
      "转发链不可控，敏感内容建议固定走单供应商直连（openai/deepseek 直连项），不要经 openrouter",
    incidentContact: "https://openrouter.ai/docs（支持与安全入口）",
  },
  siliconflow: {
    dataRetention: "未在公开文档中承诺具体保留期",
    trainsOnInputs: "unknown",
    region: "中国大陆",
    piiAdvice:
      "留存/训练口径不明，且区域在中国大陆，面向欧盟用户的合规场景慎用；含 PII 建议先脱敏",
    incidentContact: "https://siliconflow.cn（官网支持入口）",
  },
} as const;
