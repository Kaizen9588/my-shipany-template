# 埋点与监控方案（Telemetry & Analytics）

> 版本：v1（✅ 已实现，见落地记录）
> 背景：GA4 数据延迟（报表 24-72h，免费版无实时）、无会话回放、无法关联错误与用户路径。需要一套能「还原用户操作路径 + 复现 bug」的方案。
> 现状：`components/analytics/` 已有 GA4（页面浏览）+ OpenPanel（页面/属性/外链），两者均无回放能力。
>
> ✅ **v1 落地记录（2026-08）**：`lib/telemetry/*`（客户端 track / 服务端 trackServer + 事件常量）、
> PostHog 适配器（posthog-js 客户端 + posthog-node 服务端）、`components/analytics/posthog.tsx`（初始化 + identify + 输入遮盖）、
> 漏斗埋点（pricing.viewed → plan_selected → checkout.started(t1) → checkout.url_redirected(t2) → payment.succeeded(t3 服务端)）。
> v2（会话回放全量 + 错误追踪 + bug 复现链路）待落地。

---

## 一、先拆解：你说的「埋点」其实是三件事

很多人把三件事混为一谈，它们的数据模型、工具、用途完全不同：

| 层 | 回答的问题 | 数据形态 | 代表工具 | 现状 |
|----|-----------|----------|----------|------|
| **产品分析 Analytics** | 多少人点了 Buy？转化率多少？ | 结构化事件流（定量） | GA4 / PostHog / Mixpanel / OpenPanel | ✅ 有（GA4+OpenPanel） |
| **会话回放 Replay** | 用户到底怎么操作的？哪里卡住了？ | DOM 快照视频流（定性） | PostHog / OpenReplay / Sentry Replay / LogRocket | ❌ 无 |
| **错误监控 Error** | 哪里崩了？崩溃前的操作链？ | 异常 + breadcrumb | Sentry / PostHog / GlitchTip | ❌ 无（P3 规划 Sentry） |

**你要的「还原路径 + 复现 bug」= Replay + Error 的交叉**：错误发生时，能点开这个用户当时的操作录像，看到崩前点了什么、输入了什么。

---

## 二、GA4 为什么不够

| 痛点 | 原因 |
|------|------|
| 数据延迟 | 报表 24-72h，实时报告仅限部分事件且粒度粗 |
| 采样 | 免费版高流量下数据被采样，转化率算不准 |
| 无回放 | GA4 只有聚合数据，没有个体用户操作录像 |
| 事件定义散 | 自定义事件靠 gtag，与业务代码耦合，换工具难 |
| 隐私重 | 默认采集大量数据，GDPR 合规成本高 |

结论：GA4 可以留（SEO/广告归因），但**用户路径还原必须另找工具**。

---

## 三、核心洞察：托管支付页是个「盲区」

这跟你之前问的「点支付后不能干预」是同一件事的延伸：

```
你的网站                    Stripe/Creem/Waffo 托管页
  │ 用户点 Buy (t1)          │
  │ POST /api/checkout       │
  │ 返回 checkout_url (t2)   │
  │ ─── 跳转 ───────────────>│ 用户在第三方页输卡、犹豫、放弃
  │                          │ ← 这一段你完全看不到
  │ 支付成功 webhook (t3)     │
```

**支付页停留时长无法直接埋点**（那是第三方的页面），但可以间接算出：

| 指标 | 算法 | 含义 |
|------|------|------|
| 支付总耗时 | t3 - t1 | 从点击 Buy 到支付成功 |
| 支付决策时长 | t3 - t2 | 在托管页停留/犹豫多久 |
| 支付页流失 | 只有 t1/t2 无 t3 | 跳转后没回来 = 放弃支付 |

**实现**：t1/t2 由客户端 `track()` 记录，t3 由 webhook 服务端 `track()` 记录，三者用 `order_no` 关联。这就是「漏斗 + 停留时长」的正确埋法，不需要碰第三方页面。

---

## 四、架构：追踪抽象层（与支付/邮件同构）

### 4.1 核心原则

1. **业务代码只调 `track()`，不 import 任何工具 SDK**。换 PostHog→别的，只改适配器。
2. **事件双写**：客户端发交互事件（点击/浏览），服务端发业务事实（支付成功/退款）——服务端事件是**真相源**，客户端事件不可信（可被拦截/伪造）。
3. **身份缝合**：匿名 ID → 登录后绑定 user_uuid，同一个人的浏览和支付才能串起来。
4. **隐私内置**：敏感字段不入埋点（卡号永远不会出现在你页面），输入框内容默认不采集，GDPR 同意后再开回放。

### 4.2 接口定义

```typescript
// lib/telemetry/types.ts

export type TelemetryEvent = {
  name: string;                     // 规范命名，见 §5
  properties?: Record<string, string | number | boolean>;
  // 自动附加：timestamp, session_id, anonymous_id, user_uuid(登录后), url, user_agent
};

export interface TelemetryProvider {
  id: string;                       // "posthog" | "ga4" | ...
  hasValidCredentials(): boolean;
  captureClient(event: TelemetryEvent): void;     // 浏览器端
  captureServer(event: TelemetryEvent): void;     // 服务端（含 webhook）
  identify(userId: string, props?: Record<string, unknown>): void;
}
```

### 4.3 统一入口

```typescript
// lib/telemetry/index.ts
export function track(event: TelemetryEvent) {
  providers.forEach(p => p.captureClient(event));
}

// lib/telemetry/server.ts（服务端专用，webhook/API 调用）
export function trackServer(event: TelemetryEvent) {
  providers.forEach(p => p.captureServer(event));
}
```

> 客户端 SDK 初始化放 `components/analytics/`（复用现有结构），服务端初始化放 `lib/telemetry/`。

---

## 五、事件命名规范

采用「对象_动作」动词后置，可分组可聚合：

```
pricing.viewed          # 进入定价区
pricing.plan_selected   # 选中某套餐
checkout.started        # 点击 Buy（t1）
checkout.url_redirected # 拿到托管页 URL 准备跳转（t2）
payment.succeeded       # webhook 确认支付成功（t3，服务端）
payment.failed          # 支付失败
signup.started          # 点登录按钮
signup.completed        # 登录成功
credits.purchased       # 积分充值成功（= payment.succeeded 的业务别名）
credits.exhausted       # 积分耗尽
api_key.created         # 创建 API Key
ai.generated            # AI 生成成功（✅ 服务端 trackServer，含 model/credits_charged/tokens）
```

**规范**：
- 全小写 + 点号分层，第一段是对象，第二段是动作
- 不写 `click_button_1` 这种无意义名字
- 属性里放套餐名、金额、渠道等维度，不放 userId 明文（用 user_uuid 由 SDK 自动附上）

---

## 六、SaaS 核心漏斗（埋点要服务的最终目标）

```
landing.visited
  → signup.started → signup.completed
    → pricing.viewed → pricing.plan_selected
      → checkout.started → checkout.url_redirected
        → payment.succeeded (服务端)
```

每个环节的流失率 + 支付页停留时长，就是独立站增长的全部问题。埋点设计反过来由这个漏斗驱动，**只埋漏斗上的点，不埋无意义的点**。

---

## 七、工具选型

| 方案 | 组合 | 优点 | 缺点 |
|------|------|------|------|
| **A（推荐）** | **PostHog 单工具** | 分析+回放+错误+feature flag 一体化，一个 SDK；近实时；免费 100 万事件/月；可自托管 | 免费版回放保留 30 天 |
| B | Sentry(错误+回放) + GA4(分析) | Sentry 错误监控最成熟；GA4 免费且广告归因强 | 两套系统割裂，路径还原要手动关联 |
| C | OpenReplay(自托管回放) + Plausible(隐私分析) | 完全自托管，数据自己手里，隐私友好 | 运维成本高，无聚合分析能力 |

**推荐 A 的理由**（针对个人独立站）：

1. **一个 SDK 同时拿到**：事件流、漏斗、会话回放、错误 + 崩溃前录像、feature flag——你列的「点击/停留/路径还原/bug 复现」四个诉求全包
2. **免费额度够用**：100 万事件/月，独立站早期远远用不完
3. **自托管兜底**：Hobby 版可 Docker 自托管，不担心厂商涨价/关停（延续你对支付渠道「不锁定」的执念）
4. **与 Sentry 二选一**：PostHog 有错误追踪，P3 规划的 Sentry 可以**取消**，减少一个系统

**现有 OpenPanel 怎么处理**：它只做页面/属性统计，与 PostHog 功能重叠。接入 PostHog 后可移除 OpenPanel，减少一个 SDK。GA4 保留（Google Ads/SEO 归因需要），但退居「广告归因」角色，不做产品分析。

---

## 八、bug 复现链路（你关心的核心）

```
用户遇到 bug
  │
  ├─ 前端报错 → PostHog Error Tracking 捕获（含 stack + breadcrumb）
  │
  ├─ 自动关联该用户的 Session Replay
  │     └─ 打开录像：看到用户点了哪个按钮 → 触发了什么 → 崩在哪一步
  │
  └─ 附加 breadcrumb：崩前 30 秒的点击、请求、路由跳转
```

**实操要点**：
- 错误上报自动附 `session_id`，回放按 session 检索
- 关键交互打 breadcrumb（不截图，只记文字），降低回放存储成本
- 敏感输入默认遮盖（PostHog 支持 mask input / mask CSS class）

---

## 九、隐私与合规

| 项 | 处理 |
|----|------|
| Cookie 同意 | ✅ 已落地：PostHog / GA4 / OpenPanel 均在 consent 接受后才初始化（`components/analytics/*` + `components/cookie-consent`），同意前不采集；回放同样仅同意后开启 |
| 回放遮盖 | ✅ 已落地：`session_recording.maskAllInputs: true`（posthog.tsx） |
| 数据保留 | 回放 30 天，事件 13 个月（PostHog 免费版默认），文档写明 |
| 欧盟用户 | 优先用 PostHog 欧盟节点（`api.eu.posthog.com`） |
| 与 GDPR 方案整合 | 用户删除账号时同步删 PostHog 个人数据（`posthog.deleteUser`） |

---

## 十、成本控制

| 手段 | 说明 |
|------|------|
| 采样 | 回放 100% 但事件可采样（如匿名用户 100%、登录用户 100%，流量大了再调） |
| 只埋漏斗点 | 见 §6，不做无意义埋点 |
| 服务端事件计数 | webhook 事件 + API 调用都算事件，注意 burst |
| 告警 | 事件量超预算 80% 时告警 |

---

## 十一、实施分期

| 阶段 | 内容 |
|------|------|
| v1（✅ 已落地） | `lib/telemetry/` 抽象层 + PostHog Provider + 身份缝合（匿名→user_uuid）+ §6 漏斗埋点 + 支付停留时长（t1/t2/t3）+ 会话录制默认开启（maskAllInputs）+ 三 SDK consent 门控 + `ai.generated` 服务端埋点 |
| v2 | 错误追踪 + bug 复现链路（PostHog Error Tracking / Sentry 评估） |
| v3 | feature flag（灰度/开关）+ 移除 OpenPanel 评估 + GDPR 删除联动 |

---

## 十二、环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `NEXT_PUBLIC_POSTHOG_KEY` | ❌（配置后启用） | PostHog Project API Key |
| `NEXT_PUBLIC_POSTHOG_HOST` | ❌（默认 US） | 自托管/EU 节点地址 |

> ⚠️ 本文档早期版本列过 `NEXT_PUBLIC_TELEMETRY_ENABLED` 全局开关，代码中从未读取，已移除；
> 实际开关由各 SDK 的 key 是否配置 + consent 门控决定。

---

## 十三、与既有架构的一致性（自检）

| 设计点 | 支付 | 邮件 | 埋点 |
|--------|------|------|------|
| Provider 抽象 | ✅ | ✅ | ✅ |
| 凭据环境变量 + hasValidCredentials | ✅ | ✅ | ✅ |
| 不阻塞主流程 | webhook 重试 | 失败降级 | 埋点失败静默 |
| 不锁定厂商 | registry | 单文件换 provider | track() 抽象 |
| 真相源 | webhook 服务端 | - | **服务端事件为真相源** |
