# AI 网关闭环设计（AI Gateway）

> 版本：v1（✅ 已实现，见落地记录）
> 定位：AI SaaS 模板的**核心收费闭环**——把「认证 + 积分 + AI SDK」三块已存在的积木连接起来。
> 背景：现有 `app/api/demo/gen-text` 无认证无扣费，`app/api/ping` 只扣费不调 AI。AI 能力变现的主干链路缺失（架构审查第五轮发现 #1）。
> 日期：2025-08-14
>
> ✅ **v1 落地记录（2026-08）**：`/api/v1/ai/generate`（非流式：鉴权→限流→402→原子扣减→模型路由→生成→失败退款）、
> `data/model-pricing.ts` 模型白名单 + 预估一次扣清、`lib/ai/registry.ts` Provider 抽象、
> `lib/ratelimit.ts` 内存级限流、`ai_generate`/`ai_refund` 交易类型。v1.5 幂等/状态机/崩溃补偿已落地（迁移 0032，2026-09-01）；v2（流式/图片/视频）待落地。
>
> ⚠️ **生产就绪状态（2026-08 第八轮审查结论）**：v1 闭环可跑通，
> 但**缺少幂等键、崩溃补偿和可恢复状态机**，真实收费（尤其高成本模型）下会造成重复扣费、
> 扣费后崩溃永久损失、用户重试重复计费等问题。详见本文 §八（风险）与 §九（自检）。
>
> ⚠️ **P3-1（第九轮，2026-08-26）——「幂等键 / 状态机 / 崩溃补偿」的整改设计正文从未写过**：文首原写「详见本文第 10 节」，
> 但全文只到 §九；`docs/README` 指向的 `#九v15-目标设计幂等--状态机--补偿` 锚点实际不存在。目前只有 §八 风险表里一行方向性描述，
> 三大件的落地设计需在本文件补成独立小节。

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
     └─ ⚠️ P0-2（第九轮）：「行锁串行化」论证不成立，见 docs/03 §3 / docs/05 §2.4；需 advisory lock 或 credit_lots UPDATE 原子扣减
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

> ⚠️ **P3-6（第十轮，2026-08-26）——中文输入 token 预估系统性低估**：`prompt.length / 4` 是英文语料的粗估系数；
> 中文约 0.6–1 token/字符，同一公式对中文输入低估 2–4 倍——而模板目标市场含 zh locale 与支付宝/微信渠道。
> 低估方向对平台不利：「一次扣清 + 成功不补收」模型下，真实输入成本高于预扣的部分由平台承担。
> 修法：按内容做简单 CJK 字符占比判断（CJK 区间按 length×~0.9 折算、其余 /4），或直接上调安全系数并记录在定价表里。

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

**幂等**：✅ 已实现（2026-09-01，迁移 0032 + lib/ai-request.ts）——`Idempotency-Key` 头按 `(user_uuid, request_id)` 幂等，同键同体在途/已成功 409、同键异体 422、终态可重跑；详见 §七 v1.5 落地注记。

> ✅ **P1-5（第九轮，2026-08-26）——已关闭（2026-09-01，迁移 0032）**：`ai_requests` 落地为 `UNIQUE(user_uuid, request_id)` 按用户隔离、键必填校验（`isValidRequestId`，1~128 位 URL 安全字符）、请求体指纹 `sha256(model+prompt|messages+max_tokens)` 同键异体返 422、`created_at/updated_at/completed_at` 落地 24h TTL 清理（`cleanupCompletedAiRequests`）。以下为历史设计正文：`ai_requests.request_id` 若做成全局 `UNIQUE`
> 是「全局唯一 + 客户端可控」的公共键空间，批量抢注 `"1"`、`"test"`、常见客户端库默认键会使受害者被永久拒服或读到别人结果。
> **修法**：`UNIQUE(user_uuid, request_id)`（匿名端点用 `anonymous_key` 作租户维度）+ 补齐键的必填性/字符集/长度
> + 存请求体指纹 `hash(model+prompt+max_tokens)`、同键不同体返 422 + 用 `created_at` 落地 24h 口径与清理任务（详见 docs/03 §规划中 / v1 收费前必须完成）。

---

## 五、与既有架构的连接

| 依赖 | 关系 |
|------|------|
| P-1.2 原子扣减 | **前置依赖**：「余额检查 + 扣减」必须原子化，否则并发透支 |
| 6.18 限流 | 网关第 2 步。✅ v1 已自带内存级限流（IP 层 `rateLimit` + 用户层 `rateLimitUser`，lib/ratelimit.ts）；Upstash 落地后替换。已知边界：内存限流多实例不共享，重启清零 |
| 6.5 埋点 | ✅ 已接入：`trackServer(AiGenerated)` 在扣费后调用，吞错不阻塞 |
| P-1.4 Demo API 修复 | demo API 修复后可作为网关的「免费演示模式」（登录即可试一次） |
| 6.2 邮件 | 积分耗尽时触发 `credit_exhausted` 邮件 |

> ⚠️ **跨实例限流的落地路径（第九轮整块缺失）**：当前限流是内存级、多实例不共享、重启清零（§五 6.18 已自认），
> `boundary-spec` 把 fail-open 挂账（N-5），但没有给设计。生产方案：Upstash/Redis 分布式限流；
> 高成本端点（AI 生成）在无分布式限流时应 **fail-closed**，不能静默放行。匿名演示端点的失败退还语义与输入限制见 docs/14（P0-4）。

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

> ⚠️ **幂等键生命周期与输入限制（第九轮整块缺失）**：
> 1. `Idempotency-Key` 需要 TTL、清理任务、请求体指纹、同键异体的返回码——`docs/02` 只有一句「有效期 24 小时」没有落点；应存 `hash(model+prompt+max_tokens)`，同键不同体返 422。
> 2. `prompt`/`messages` 需要 schema、字节上限（如 8KB）、消息条数上限、字段白名单；超限直接 413（对照 §八「输入无大小限制」）。

---

## 七、实施分期

| 阶段 | 内容 | 生产就绪度 |
|------|------|------------|
| v1 | `/api/v1/ai/generate` 非流式（预估一次扣清 + 失败退款）+ 模型白名单 + MODEL_PRICING 常量 + 402/409/422/429/401 状态码 + 内存级限流 | ✅ 已完成（2026-09-01，第十七批） |
| v1.5（真实收费前必须） | **Idempotency-Key + ai_requests 状态机 + 崩溃补偿 Cron**（迁移 0032 已落地）+ 输入大小限制 + 请求记录持久化 | ✅ 已完成（2026-09-01，见下方 v1.5 落地注记） |
| v2 | 流式 streamText + 图片/视频端点 + 流式中断结算 | ⬜ 规划中 |
| v3 | 模型定价入数据库（后台可调价）+ 用量统计页联动 + 精确按 token 结算 + 多供应商路由策略 | ⬜ 规划中 |

> ✅ **v1.5 已落地（2026-09-01，迁移 0032 + lib/ai-request.ts，handoff §1.25）**：
> 1. **幂等**：`Idempotency-Key` 头（可选，1~128 位 URL 安全字符，非法 400）；未提供则服务端生成
>    `srv-*` 键（不可重试）。按 `(user_uuid, request_id)` 隔离；同键同体在途/已成功返 409
>    （带已有记录摘要，另有 `GET ?request_id=` 查询端点），同键异体返 422，failed/refunded
>    终态可同键重跑（条件重占 running，与崩溃补偿互斥）。幂等判定发生在扣费之后，409/422
>    路径一律先退本次扣费（不能吞用户的钱）。
> 2. **状态机**：行存在即代表已扣费（扣费成功后才建 running 行）；running→succeeded/failed
>    条件流转；failed 退款失败落 refund_pending（refund_attempts+1）。
> 3. **崩溃补偿**：cron `/api/cron/daily` 扫 running 超 30 分钟（扣费后进程崩溃）与
>    refund_pending 超 10 分钟（退款重试），条件更新互斥防双退，退款成功置 refunded。
> 4. **TTL**：completed 超 24h 的终态行每日清理（幂等键有效期口径）。
> 5. **输入硬限制**（2026-09-01 补齐，generate 路由 3.1 节，与 demo 路由同规）：
>    messages 逐项白名单 `{role: system|user|assistant, content: string}`（违规 400）、
>    prompt/messages 字节上限 `AI_MAX_PROMPT_BYTES`（默认 32768，超限 413）、
>    消息条数上限 `AI_MAX_MESSAGES`（默认 50，超限 413）。校验在鉴权/限流之后、
>    扣费之前——413 不会成为计费绕过或免费重试通道。

---

## 八、风险与简化

| 风险 | 等级 | 当前应对 | 生产必须方案 |
|------|------|----------|--------------|
| 预估高于实际用量（短输出付满额） | P2 | 接受：换取流水干净、无结算复杂度 | v3 精确结算；或超量不追加、少用不退还的简单规则 |
| 流式中途断连 | P2 | v1 非流式，无此问题 | v2 流式需定义：服务端观测到 provider usage 后结算；用户中断 vs 网络异常需区分 |
| **重复扣费（超时重试）** | **P0** | ✅ 已关闭（2026-09-01）：Idempotency-Key 幂等 + ai_requests 状态机，同键在途/已成功 409 | `Idempotency-Key` + `ai_requests` 状态机，同键只扣一次 |
| **扣费后崩溃永久损失** | **P0** | ✅ 已关闭（2026-09-01）：ai_requests 持久化 + cron 补偿（running 超 30 分钟退款、refund_pending 超 10 分钟重试，条件更新互斥防双退） | `ai_requests` 持久化 + 补偿 Cron 扫描 `refund_pending` 指数退避 |
| **输入无大小限制** | **P1** | ✅ 已关闭（2026-09-01）：messages 逐项白名单（role 枚举 + content 字符串，违规 400）+ 字节上限 `AI_MAX_PROMPT_BYTES`（默认 32KB）+ 条数上限 `AI_MAX_MESSAGES`（默认 50），超限 413；校验在扣费之前 | 字段白名单 + 字节/条数上限；超大请求直接 413（已落地） |
| 模型白名单维护成本 | P2 | v1 用常量表，改动即发版 | v3 入数据库，后台可调 |
| 「积分 vs 金额」汇率漂移 | P2 | 积分是抽象单位，运营方自行定义换算 | 积分价格版本化，每次扣费写入当时的模型价格版本 |
| 限流多实例不共享 | P1 | v1 内存级限流 | 生产部署 Upstash/Redis 分布式限流；高成本端点缺限流时应 fail-closed |
| **多供应商数据边界不清** | P1 | ❌ 只做功能路由，不考虑数据保留/区域/训练用途 | 每个模型维护价格版本、数据处理声明、区域、PII 脱敏策略、重试降级规则 |

> **P0 项为真实收费 No-Go**，必须在 v1.5 阶段关闭。

> ⚠️ **P0-4（第九轮，2026-08-26）**：§八「输入无大小限制 | P1」与匿名演示端点的「失败退还次数」组合后升级为 P0——
> 无认证的 `/api/v1/ai/demo` 可让 100% 调用失败并退还次数，单 IP 绕过每日 3 次。完整分析与修法见 docs/14 §2.5 / §五。

---

## 九、对抗式自检

| 检查点 | 结论 |
|--------|------|
| 是否过度设计？ | v1 只做非流式文本 + 一次扣清，图片/视频/流式/精确结算/动态定价全部推迟，未过度 |
| 是否与 Provider 同构纪律一致？ | ✅ 模型路由 registry 与支付/邮件/埋点同构 |
| 是否依赖未落地的前置项？ | 依赖 P-1.2（原子扣减），已标注为前置；限流用自带简易版规避 P3 依赖 |
| 是否解决第五轮「变现闭环缺失」？ | ✅ 是核心目的 |
| 是否引入新的安全风险？ | 模型白名单服务端强制，客户端不可传任意 model；Idempotency-Key 防重复扣费 |
