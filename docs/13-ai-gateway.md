# AI 网关闭环设计（AI Gateway）

> 版本：v1（✅ 已实现，见落地记录）
> 定位：AI SaaS 模板的**核心收费闭环**——把「认证 + 积分 + AI SDK」三块已存在的积木连接起来。
> 背景：现有 `app/api/demo/gen-text` 无认证无扣费，`app/api/ping` 只扣费不调 AI。AI 能力变现的主干链路缺失（架构审查第五轮发现 #1）。
> 日期：2025-08-14
>
> ✅ **v1 落地记录（2026-08）**：`/api/v1/ai/generate`（非流式：鉴权→限流→402→原子扣减→模型路由→生成→失败退款）、
> `data/model-pricing.ts` 模型白名单 + 预估一次扣清、`lib/ai/registry.ts` Provider 抽象、
> `lib/ratelimit.ts` 内存级限流、`ai_generate`/`ai_refund` 交易类型。v2（流式/图片/视频/Idempotency-Key）待落地。

---

## 一、现状与问题

| 积木 | 状态 | 位置 |
|------|------|------|
| 认证 + API Key | ✅ 双模式（session / sk-） | `services/user.ts` getUserUuid() |
| 积分系统 | ✅ 增/减/查齐全 | `services/credit.ts` |
| AI SDK | ✅ 多 provider 已接 | `aisdk/` + demo API 内联 switch-case |

**缺口**：没有统一端点把三者串成「鉴权 → 余额校验 → 原子扣减 → 模型路由 → 返回结果」的收费链路。积分扣减安全（P-1.2）、限流（6.18）、埋点（6.5）都围绕这个闭环展开，闭环缺失使这些修复项无处安放。

---

## 二、目标形态

```
POST /api/v1/ai/generate
  │
  1. 鉴权      getUserUuid()（session 或 sk-）
  │            └─ 未认证 → 401
  │
  2. 限流      IP 维度 + 用户维度双层（✅ 现状：lib/ratelimit.ts 内存实现，Upstash 待 6.18）
  │            └─ 超限 → 429
  │
  3. 余额检查  查积分余额 < 预估费用 → 402（余额不足）
  │
  4. 原子扣减  decreaseCredits（P-1.2：RPC + 行锁，杜绝并发透支）
  │
  5. 模型路由  lib/ai/registry.ts（与支付 Provider 同构）
  │            └─ openai / deepseek / openrouter / siliconflow / replicate / kling
  │
  6. 生成      非流式 generateText / 流式 streamText
  │            ├─ 成功 → 已完成计费（预估一次扣清，不退差额）
  │            └─ 失败 → 退款（负数记录回补）
  │
  7. 埋点      trackServer("ai.generated")（6.5，✅ 已接入，扣费后 fire-and-forget）
```

---

## 三、核心设计决策

### 决策 1：扣费粒度 —— 按 token，不按次

`ping` 的「1 次 = 1 积分」是示例，不能作为 AI 扣费模型。不同模型成本差几十倍（GPT-4o vs deepseek-chat），必须按 token 折算。

**模型定价表**（`data/model-pricing.ts` 常量，后续可入数据库）：

```typescript
// 每 1K tokens 消耗的积分数
export const MODEL_PRICING = {
  "gpt-4o":            { provider: "openai",      credits_per_1k_tokens: 2.5, max_output_tokens: 4096 },
  "gpt-4o-mini":       { provider: "openai",      credits_per_1k_tokens: 0.15, max_output_tokens: 4096 },
  "deepseek-chat":     { provider: "deepseek",    credits_per_1k_tokens: 0.14, max_output_tokens: 4096 },
  "deepseek/deepseek-r1": { provider: "openrouter", credits_per_1k_tokens: 0.55, max_output_tokens: 8192 },
  // ... 按需登记
} as const;

export type ModelId = keyof typeof MODEL_PRICING;
```

**关键安全点**：模型 ID 必须**服务端白名单**。客户端不可传任意 model 字符串（否则可绕开定价），只能传 `MODEL_PRICING` 中登记的 model id。

### 决策 2：预估一次扣清（无结算、无差额调整）

**扣费模型**：请求时按「输入长度 + 输出上限」预估费用，**一次扣清**。成功不退差额，失败全额退款。

```
1. 预估：预估积分 = ceil((估算输入 token + max_output_tokens) × credits_per_1k / 1000)
   估算输入 token ≈ prompt.length / 4（v1 粗估，够用）
   ✅ 2.9 已修复：messages 按 JSON 序列化长度计入输入估算（与 prompt 同口径），
   传 messages 不再免费

2. 原子扣减：decreaseCredits（P-1.2 RPC + 行锁），trans_type = "ai_generate"
   └─ 余额不足 → 402

3. 生成：
   ├─ 成功 → 完成（不退差额，用户付的是「本次调用上限」的钱）
   └─ 失败 → 全额退款（insertCredit 正数，trans_type = "ai_refund"）
```

**为什么不用「预扣 + 结算 + 多退少补」**（第六轮审查否决）：
- 一次调用产生 3 条流水，用户对账困难
- 追加扣减时余额可能已不足 → 透支，违反 P-1.2
- 流式断连时 usage 不可靠，结算无解

**权衡**：短输出用户付满额（可能略亏），换来流水干净（成功只有 1 条扣费记录）、无透支、无断连结算难题。对 MVP 模板是正确取舍，精确按 token 结算留到「有可靠 usage 回传 + 用户投诉扣费不公」时再演进。

**失败退款的边界**：仅「服务端异常 / 模型报错」退款（用户付了钱没拿到服务）。用户主动断连（流式 v2）不退款——已返回的部分是消耗了服务的。

### 决策 3：模型路由 Provider 抽象（与支付/邮件同构）

demo API 里的内联 switch-case 抽成注册表：

```typescript
// lib/ai/registry.ts
import { LanguageModelV1 } from "ai";

export interface AIModelProvider {
  id: string;                                    // "openai" | "deepseek" | ...
  hasValidCredentials(): boolean;
  createModel(model: string): LanguageModelV1;   // 内部消化 reasoning 提取等适配
  supportsStreaming(): boolean;
}

const providers: Record<string, AIModelProvider> = {
  openai: openaiProvider,
  deepseek: deepseekProvider,
  openrouter: openrouterProvider,
  siliconflow: siliconflowProvider,
  // replicate / kling（图片/视频走独立端点，见决策 5）
};

export function getModelProvider(providerId: string): AIModelProvider | undefined {
  const p = providers[providerId];
  return p?.hasValidCredentials() ? p : undefined;
}
```

**收益**：新增模型供应商只加一个文件 + registry 加一行，与「新增支付渠道」同一纪律。

### 决策 4：对外 API 用 /api/v1 前缀 + 真实 HTTP 状态码

| 规则 | 说明 |
|------|------|
| 路径 | 对外 AI API 统一 `/api/v1/ai/*`（版本前缀，第三方用户一有就无法后补） |
| 状态码 | 对外 API 返回真实语义：200 成功 / 401 未认证 / 402 余额不足 / 429 限流 / 500 服务错误 |
| 响应体 | 保留 `{code, message, data}` 结构，但 code 与 HTTP 状态一致 |
| 内部 API | `/api/checkout`、`/api/get-user-info` 等保持现状（HTTP 200 + body code），不做破坏性变更 |

### 决策 5：端点划分（文本 vs 图片/视频）

| 端点 | 扣费粒度 | 说明 |
|------|----------|------|
| `/api/v1/ai/generate` | 按 token | 文本生成（流式 + 非流式），核心闭环 |
| `/api/v1/ai/image` | 按次（每张图 N 积分） | 图片生成成本按张计算，无 token 概念 |
| `/api/v1/ai/video` | 按次 | 视频生成（Kling），单次成本高，预留 |

> v1 只实现文本 `generate`（最高频 + 能验证完整闭环）；图片/视频端点在 v2 按同样模式扩展。

### 决策 5.1：图片/视频按次扣费模型（v2 实现，模型现在定义）

按次计费与文本的 token 计费不同，需独立定价结构：

```typescript
// data/model-pricing.ts 扩展
export const IMAGE_MODEL_PRICING = {
  "dall-e-3":            { provider: "openai",    credits_per_image: 5 },
  "stability-ai/sdxl":   { provider: "replicate", credits_per_image: 3 },
  "kling-image":         { provider: "kling",     credits_per_image: 8 },
} as const;

export const VIDEO_MODEL_PRICING = {
  "kling-v1":            { provider: "kling",     credits_per_video: 50 },  // 单次成本高
} as const;
```

**扣费规则**（与文本一致的「一次扣清」哲学）：
- 请求时按 `credits_per_image × 张数`（或 `credits_per_video`）一次扣清
- 余额不足 → 402
- 生成失败 → `ai_refund` 全额退款
- 用户中断 → 不退款

**风险**：视频单次 50 积分，可能超过部分用户余额——这是正常的「余额门槛」，提示用户充值。无需特殊处理。

**S3 存储成本**：图片/视频生成后上传 S3 有存储费用，不计入积分（v1 由平台承担），v3 若需转嫁再评估。

---

## 四、积分交易类型扩展

```typescript
// services/credit.ts CreditsTransType 增加
export enum CreditsTransType {
  NewUser = "new_user",
  OrderPay = "order_pay",
  SystemAdd = "system_add",
  Ping = "ping",              // 现有示例
  AiGenerate = "ai_generate", // AI 调用扣费（负数，一次扣清）
  AiRefund = "ai_refund",     // AI 失败退款（正数回补，仅服务端异常时）
}
```

**幂等**：`Idempotency-Key` 请求头为**规划能力，v1 代码未实现**（generate 路由无任何幂等处理，重复请求会重复扣费）。接入第三方 API 前必须先落地，否则网络重试即重复计费。

---

## 五、与既有架构的连接

| 依赖 | 关系 |
|------|------|
| P-1.2 原子扣减 | **前置依赖**：「余额检查 + 扣减」必须原子化，否则并发透支 |
| 6.18 限流 | 网关第 2 步。✅ v1 已自带内存级限流（IP 层 `rateLimit` + 用户层 `rateLimitUser`，lib/ratelimit.ts）；Upstash 落地后替换。已知边界：内存限流多实例不共享，重启清零 |
| 6.5 埋点 | ✅ 已接入：`trackServer(AiGenerated)` 在扣费后调用，吞错不阻塞 |
| P-1.4 Demo API 修复 | demo API 修复后可作为网关的「免费演示模式」（登录即可试一次） |
| 6.2 邮件 | 积分耗尽时触发 `credit_exhausted` 邮件 |

---

## 六、请求/响应契约

```typescript
// POST /api/v1/ai/generate
{
  model: "deepseek-chat",     // 必须是 MODEL_PRICING 白名单内的 id
  prompt: string,             // 或 messages: [{role, content}]
  max_tokens?: number,        // 可选，默认取定价表 max_output_tokens
  stream?: boolean            // 默认 false
}
// 请求头：Idempotency-Key（强烈推荐，防重复扣费）

// 非流式响应 200
{ code: 0, data: { text: string, reasoning?: string, usage: { prompt_tokens, completion_tokens }, credits_charged: number } }

// 流式响应 200（AI SDK Data Stream 协议）
// 402 余额不足（code = -HTTP 状态码，见决策 4）
{ code: -402, message: "insufficient credits", data: { required: number, balance: number } }
```

> `credits_charged` 返回预估扣费（即本次上限），让第三方用户可对账。HTTP 状态码与 code 的映射见决策 4。

---

## 七、实施分期

| 阶段 | 内容 |
|------|------|
| v1 | `/api/v1/ai/generate` 非流式（预估一次扣清 + 失败退款）+ 模型白名单 + MODEL_PRICING 常量 + 402/429/401 状态码 + 简易限流 |
| v2 | 流式 streamText + Idempotency-Key + 图片/视频端点 |
| v3 | 模型定价入数据库（后台可调价）+ 用量统计页（6.13）联动 + 精确按 token 结算（如需要） |

---

## 八、风险与简化

| 风险 | 应对 |
|------|------|
| 预估高于实际用量（短输出付满额） | 接受：换取流水干净、无结算复杂度；精确结算留 v3 |
| 流式中途断连（v2） | 一次性扣清不退还——用户主动断连已消耗服务；仅服务端异常才退款 |
| 模型白名单维护成本 | v1 用常量表，改动即发版；v3 才入数据库 |
| 「积分 vs 金额」汇率漂移 | 积分是抽象单位，运营方自行定义积分与模型的换算，网关不感知 |
| 网关先于 6.18 限流落地 | ✅ v1 已自带内存级双层限流（IP + 用户），Upstash 到 P3 再替换；多实例部署下限流不共享为已知边界 |

---

## 九、对抗式自检

| 检查点 | 结论 |
|--------|------|
| 是否过度设计？ | v1 只做非流式文本 + 一次扣清，图片/视频/流式/精确结算/动态定价全部推迟，未过度 |
| 是否与 Provider 同构纪律一致？ | ✅ 模型路由 registry 与支付/邮件/埋点同构 |
| 是否依赖未落地的前置项？ | 依赖 P-1.2（原子扣减），已标注为前置；限流用自带简易版规避 P3 依赖 |
| 是否解决第五轮「变现闭环缺失」？ | ✅ 是核心目的 |
| 是否引入新的安全风险？ | 模型白名单服务端强制，客户端不可传任意 model；Idempotency-Key 防重复扣费 |
