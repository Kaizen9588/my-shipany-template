# 可观测性与告警设计（Observability & Alerting）

> 版本：v1 设计稿（6.23，待落地）
> 三个诉求一张图：① 日志采集 -> 自有图表，用户动向/支付情况自己掌控；② 支付渠道可扩展 + 异常实时告警 + 自动切换；③ 飞书/企微机器人实时推送异常。
> 前置事实：项目已有多渠道支付抽象（`lib/payment/*`，三渠道适配器 + `payment_settings` 热切换 +
> `health.ts` 失败计数自动降级）、统一日志封装（`lib/logger.ts`）、服务端埋点（`lib/telemetry/*`）、
> 后台看板（`/admin` + `/api/admin/stats`）。本方案在此基础上补「自有日志底座 + 即时告警通道」。

---

## 一、现状盘点（哪些已经有了，别重复建设）

| 能力 | 现状 | 位置 | 缺口 |
|------|------|------|------|
| 支付渠道路由 | ✅ 前端只传 method，服务端按 payment_settings + priority 路由 | `lib/payment/registry.ts` | - |
| 渠道健康检测 | ✅ 连续 5 次失败/10 分钟 -> unhealthy 30 分钟，路由自动跳过 | `lib/payment/health.ts` | 仅内存（单实例）；无外发告警 |
| 渠道热切换 | ✅ 改 `payment_settings` 即生效，无需重部署 | `models/payment.ts` | **无后台 UI**（现在只能改数据库） |
| Webhook 金额比对 | ✅ 不匹配置 mismatch，不充值 | 迁移 0010 | mismatch 只有 console.error + PostHog 埋点 |
| 退款原子化 | ✅ process_order_refund | 迁移 0011 | - |
| 业务图表 | ✅ 用户/收入/积分 30 天趋势 | `admin/page.tsx` | 聚合逻辑在 JS，数据量大后要下沉 SQL |
| 行为分析 | ✅ PostHog（客户端 + 服务端埋点） | `lib/telemetry/*` | 数据在第三方，不可控 |
| 日志 | ⚠️ logger 封装了 console，无持久化 | `lib/logger.ts` | **无采集、无检索** |

**结论**：支付架构的「自动切换」骨架已经存在（这是之前几轮架构设计的重点），真正缺的是
**① 日志落库 ② 告警外发通道 ③ 后台支付渠道管理页**。以下按此补齐。

---

## 二、总体架构

```
                         ┌─────────────────────────────────────────────┐
                         │                告警判定（内存/后续 Redis）      │
   业务代码               │  eventBus: subscribe(type, handler)          │
   logger.warn/error ───> │  告警规则：5min 同类事件 >= N -> 升级通知      │
   payment health     ──> │  抑制：同 key 30min 只发一次（防轰炸）         │
   webhook mismatch   ──> └──────┬──────────────────┬───────────────────┘
                                  │                  │
                    ┌─────────────▼───┐   ┌──────────▼──────────┐
                    │  op_events 表    │   │  通知渠道 Notifier    │
                    │  （日志底座）     │   │  - 飞书机器人 ✅ v1   │
                    │  检索/图表/审计   │   │  - 企微机器人 ✅ v1   │
                    └─────────────────┘   │  - 邮件（已有）        │
                                          └─────────────────────┘
```

两条链路职责分离：

- **op_events（落库链路）**：结构化运营事件，**全量记录**，供检索、图表、审计。慢一点没关系，但不能丢。
- **Notifier（推送链路）**：只推「需要人知道」的事件，**fire-and-forget + 失败静默**，绝不阻塞业务主流程（与 telemetry 同一纪律）。

---

## 三、日志采集与图表（诉求 1）

### 3.1 设计决策：数据库表 vs 外部日志服务

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| op_events 表（Supabase） | 零新依赖；SQL 检索/聚合；后台页直接复用 | 写入走业务库 | ✅ v1 采用（独立表 + 可定期归档） |
| Axiom/LogTail 等日志服务 | 专业检索 | 又一个第三方、数据外流 | ❌ 与「自己掌控数据」诉求矛盾 |
| Vercel 日志 | 现成 | 只留 1h/1d，无法做图表 | 仅兜底排查用 |

个人产品量级（日事件 < 50w），Postgres 单表 + 索引完全够用；真到量级瓶颈时这张表
天然适合按月分区/迁移 ClickHouse，迁移面只有写入点一处。

### 3.2 op_events 表（迁移 0012）

```sql
CREATE TABLE IF NOT EXISTS op_events (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,   -- 命名空间.事件（payment.checkout_failed / auth.login_failed）
    severity VARCHAR(20) NOT NULL DEFAULT 'info',  -- info / warn / error / critical
    source VARCHAR(50) NOT NULL DEFAULT 'app',     -- app / webhook / cron / migration
    subject_uuid VARCHAR(255) NOT NULL DEFAULT '', -- 关联主体（order_no / user_uuid / provider id）
    detail JSONB NOT NULL DEFAULT '{}',            -- 结构化上下文（金额、渠道、错误栈摘要）
    ip VARCHAR(255),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_op_events_type_time ON op_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_op_events_severity_time ON op_events(severity, created_at DESC);
-- 可选归档策略：created_at < now() - interval '90 days' 的 info 级删除（cron/daily 顺带做）
```

### 3.3 写入接口（`lib/oplog.ts`）

```typescript
// 与 logger/telemetry 同款纪律：fire-and-forget、吞错、不阻塞
export async function recordOpEvent(input: {
  event_type: string;
  severity?: 'info' | 'warn' | 'error' | 'critical';
  source?: string;
  subject_uuid?: string;
  detail?: Record<string, unknown>;
}): Promise<void>;

// 关键事件三连（业务代码一处调用，三个消费者各自消化）：
// recordOpEvent + trackServer + notifyIfCritical
export function trackCriticalEvent(...)
```

**接入点清单**（v1 只接资金与安全相关的 8 类，不贪多）：

| 事件 | severity | 触发点 |
|------|----------|--------|
| payment.checkout_failed | warn/error | checkout route catch |
| payment.provider_unhealthy | critical | health.ts 标记 unhealthy 时 |
| payment.provider_recovered | info | health TTL 到期恢复时 |
| payment.amount_mismatch | critical | handlePaymentEvent data==='mismatch' |
| payment.refund_processed | warn | processRefund 成功后 |
| payment.webhook_invalid_signature | critical | 三渠道验签失败 |
| auth.login_failed_burst | warn | 登录 guard 连续失败 |
| system.env_or_migration_failed | critical | instrumentation register catch |

### 3.4 图表与检索（后台 `/admin/logs` + `/admin/events`）

- **列表页**：按 event_type/severity/时间/subject_uuid 筛选，分页（复用现有 DataTable 模式）
- **图表**：`/api/admin/stats` 扩展两个序列——`events_daily`（按 severity 堆叠柱状）、
  `payment_funnel`（checkout.started -> succeeded 转化，数据来自 orders + op_events）
- **支付专项视图**：按 `payment_provider` 分组的成功率/失败原因分布
  （`detail->>'provider_error'` 聚合），渠道被封前通常表现为某类错误码占比陡增

---

## 四、支付模块可扩展性与自动切换（诉求 2，重点）

### 4.1 架构现状（已落地的部分，此前的设计重点）

```
前端（只传支付方式）            服务端                         数据库
  │  POST /api/checkout        │                             │
  │  {method: 'card'}          │ routePaymentProvider(method) │
  │───────────────────────────>│  1. getEnabledProviders()   │
  │                            │     - payment_settings 启用? │
  │                            │     - 凭据有效?              │
  │                            │     - isProviderHealthy?    │ ← health.ts（内存）
  │                            │  2. 按 priority 排序取首个    │
  │                            │  3. createCheckout 失败 ->   │
  │                            │     recordProviderFailure    │
  │                            │     -> 重试下一渠道（同 method）│
  │                            │  4. order.payment_provider   │
  │                            │     写入即冻结               │
```

三层防线已就位：
1. **凭据层**：`hasValidCredentials()`——没配密钥的渠道不会被路由
2. **配置层**：`payment_settings.enabled/priority`——数据库热切换，不重部署
3. **健康层**：`health.ts` 失败计数——连续 5 次失败自动摘除 30 分钟

### 4.2 本次补齐：告警闭环 + 后台管理页

**a) 告警闭环**（当前断点：health.ts 标记 unhealthy 只有 console.warn）

```
recordProviderFailure 达阈值
  -> recordOpEvent(payment.provider_unhealthy, critical)
  -> notifyChannel(
       `🚨 支付渠道 [${provider_id}] 已自动摘除 30 分钟（10 分钟内连续 5 次失败）
        最近错误: ${top_error}
        剩余可用渠道: ${healthy_ids}
        处置: 确认渠道后台是否风控/封禁；若短期无法恢复，建议后台将 ${provider_id} enabled=false`
     )
```

人工决策链路（半自动）：**自动摘除是激进的**（可能是自己代码 bug 导致渠道报错），
所以 v1 只自动摘除 + 告警人工确认，不自动改 `payment_settings.enabled`。
「自动切换」= 路由层自动绕开（已实现），「永久禁用」= 人工决定（告警消息里给出现成操作指引）。

**b) 后台支付渠道管理页**（`/admin/payment`，现缺口）

| 元素 | 说明 |
|------|------|
| 渠道卡片 x3 | 启用开关（写 payment_settings）、priority 编辑、当前健康状态（unhealthy 剩余时间）、最近 24h 成功/失败计数（op_events 聚合） |
| 产品映射表 | payment_products 编辑（金额/积分/creem_product_id/stripe_price_id 回填） |
| 操作审计 | 开关/改价全部走 `fireAndForgetAudit`（已有机制） |

**c) 渠道被封的完整处置 SOP**（沉淀为文档，配合告警消息引用）

```
1. 收到 provider_unhealthy 告警（飞书/企微）
2. 打开渠道 Dashboard 确认状态（风控/封禁/技术故障）
3a. 技术故障 -> 等待恢复，health TTL 到期自动回归（收到 provider_recovered 通知）
3b. 风控/封禁 -> 后台 /admin/payment 关闭该渠道 enabled=false
4. 若为唯一渠道 -> 提前在代码里注册备用渠道（写 adapter + registry 一行）
5. 事后：/admin/logs 拉该渠道失败明细，按错误码归类
```

### 4.3 「支付可扩展性」的验证结论（已发生的事实）

加一个渠道的实际工作量（Stripe 并入时验证）：写 1 个适配器文件（实现 8 个接口方法）
+ registry 注册一行 + 环境变量 + `payment_settings` 插一行。checkout/webhook/退款/前端
零改动。**新增渠道不动核心代码**这个目标已被三渠道并存验证。

---

## 五、飞书/企微机器人通知（诉求 3）

### 5.1 Notifier 抽象（`lib/notify/`）

```typescript
// lib/notify/types.ts
export interface Notifier {
  id: 'feishu' | 'wecom' | 'email';
  isConfigured(): boolean;              // webhook URL 未配置 -> false，静默跳过
  send(message: NotifyMessage): Promise<void>;
}

export interface NotifyMessage {
  title: string;                        // 短标题（群列表预览可见）
  body: string;                         // markdown（飞书/企微都支持）
  severity: 'info' | 'warn' | 'error' | 'critical';
  subject_uuid?: string;                // 订单号/渠道 id，用于去重抑制
}

// lib/notify/index.ts
export async function notifyChannel(message: NotifyMessage): Promise<void>;
// 内部：severity 过滤（env NOTIFY_MIN_SEVERITY，默认 warn）+ 抑制（同 subject+type 30min 一次，
// 内存 Map，多实例升级 Redis）+ 遍历已配置的 notifier 并行 send，单个失败不影响其他
```

### 5.2 两个机器人实现（都是「POST JSON 到 webhook URL」，无 SDK 依赖）

**飞书自定义机器人**（`lib/notify/feishu.ts`）：

```typescript
// POST https://open.feishu.cn/open-apis/bot/v2/hook/{token}
{
  "msg_type": "interactive",
  "card": {
    "header": { "title": { "tag": "plain_text", "content": title },
                "template": severity === 'critical' ? 'red' : 'orange' },
    "elements": [{ "tag": "div", "text": { "tag": "lark_md", "content": body } }]
  }
}
// 可选签名：env FEISHU_SECRET 配置后按官方 HMAC-SHA256 签名规则加 timestamp/sign 字段
```

**企业微信机器人**（`lib/notify/wecom.ts`）：

```typescript
// POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key={key}
{
  "msgtype": "markdown",
  "markdown": { "content": `## ${title}\n${body}` }   // 注意企微 markdown 不支持红色标题，用 <font color="warning">
}
```

### 5.3 环境变量（新增 4 个，全可选）

| 变量 | 说明 | 缺省 |
|------|------|------|
| FEISHU_WEBHOOK_URL | 飞书机器人 webhook（含 token） | 未配置则该渠道静默禁用 |
| FEISHU_SECRET | 飞书签名校验（群设置开启「签名校验」时必填） | - |
| WECOM_WEBHOOK_URL | 企微机器人 webhook（含 key） | 未配置则该渠道静默禁用 |
| NOTIFY_MIN_SEVERITY | 最低通知级别 info/warn/error/critical | warn |

### 5.4 触发点（v1 = critical/error 级支付与安全事件）

| 事件 | severity | 消息要点 |
|------|----------|----------|
| payment.provider_unhealthy | critical | 渠道摘除 + 剩余渠道 + 处置指引（§4.2a） |
| payment.amount_mismatch | critical | 订单号 + 期望/实付金额 --**疑似攻击或调价未同步，需人工核查** |
| payment.webhook_invalid_signature | critical | **疑攻击**：有人伪造 webhook |
| payment.refund_processed | warn | 订单号 + 扣回积分（退款是资金流出，管理员须知） |
| system.env_or_migration_failed | critical | 启动失败原因（服务可能没起来） |
| auth.login_failed_burst | warn | 疑似撞库 |

> PostHog 埋点继续保留（漏斗分析用），Notifier 是即时通道，两者互补不互替。

---

## 六、实施清单（6.23，按依赖排序）

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | 迁移 0012：op_events 表 | - |
| 2 | `lib/oplog.ts`（recordOpEvent + trackCriticalEvent） | 1 |
| 3 | `lib/notify/`（types + feishu + wecom + index，含抑制） | - |
| 4 | 8 个接入点埋事件（§3.3 清单，其中 3 个同时接 notify） | 2, 3 |
| 5 | `/admin/payment` 渠道管理页 + `/api/admin/payment-settings` | - |
| 6 | `/admin/logs` 事件检索页 + stats 图表扩展 | 2 |
| 7 | health.ts 标记/恢复时发告警（替换 console.warn） | 3 |
| 8 | 文档回写：本文件标记落地 + docs/08 环境变量 + .env.example | 4-7 |

**明确不做**（防过度设计）：
- 不做通用 event bus 框架——直接函数调用（recordOpEvent / notifyChannel），够用且可追踪
- 不做多实例 Redis 抑制——v1 内存 Map，注释标明升级路径（与 ratelimit/health 同一模式）
- 不做 Slack/Telegram——飞书/企微满足诉求，Notifier 接口留着扩展位
- 不做日志全文检索（ELK 式）——op_events 是结构化运营事件，不是应用日志；应用日志仍看 Vercel
