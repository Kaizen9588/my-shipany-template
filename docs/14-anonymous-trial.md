# 免费试用额度设计（Anonymous Trial & Free Credits）

> 版本：v1（✅ 已实现，见落地记录）
> 背景：用户提出「未登录免费用多少积分尝试功能，登录后再送免费积分，用完提示充值」。核心难点：未登录无 user_id，匿名额度如何防刷。
> 日期：2025-08-14
>
> ✅ **v1 落地记录（2026-08）**：迁移 `0005_anonymous_usage.sql`（表 + 原子递增/递减 RPC）、
> `/api/v1/ai/demo`（IP + 设备指纹双维度限次，用完 429 提示登录送 10 积分，失败退还次数）、
> `lib/browser.ts`（FingerprintJS 开源版设备指纹）、环境变量 `ANONYMOUS_DAILY_LIMIT`/`DEMO_MODEL`/`DEMO_MAX_TOKENS`/`ANONYMOUS_FINGERPRINT_ENABLED`。

---

## 一、核心原则：匿名额度 ≠ 积分，匿名 = 限流

**这是本设计的基石，也是对你问题的直接回应。**

你担心的「未登录用 10 积分、关掉客户端再进又刷新」本质上是**积分账户**的思路——但匿名用户没有身份，任何「匿名积分账户」都能被清除（清 cookie、隐私模式、换浏览器）而重置。

正确的建模是：

| | 匿名用户（未登录） | 注册用户（登录） |
|---|---|---|
| 本质 | **限流问题**（服务端计数，不看客户端状态） | **积分账户**（有 uuid，可持久追踪） |
| 数据存哪 | 服务端（IP+指纹维度） | credits 表 |
| 清 cookie 能刷吗 | ❌ 不能（服务端按 IP 计数） | 不适用 |
| 换 IP 能刷吗 | 能（但成本高于收益，见 §5） | 不适用 |

**结论**：未登录用户不该有「积分」，只该有「每日免费演示次数」。把匿名额度做成限流，你的「关掉再进刷新积分」问题自动消失——因为额度根本不存客户端。

---

## 二、未登录演示模式

### 2.1 额度规则

| 项 | 默认值 | 说明 |
|----|--------|------|
| 每日免费次数 | 3 次/天（可配） | 每个匿名用户每天 3 次 AI 调用 |
| 模型限制 | 只用便宜模型 | 演示走 `deepseek-chat` 或 `gpt-4o-mini`，不开放昂贵模型 |
| 输出上限 | 低（如 1024 tokens） | 防止白嫖长输出 |
| 重置时间 | 每日 0 点（UTC） | 与 usage_date 对齐 |

### 2.2 匿名用户识别：设备指纹 + IP 双维度

**设备指纹选型**：

| 方案 | 精度 | 费用 | 数据流向 | 结论 |
|------|------|------|----------|------|
| FingerprintJS 开源版（`@fingerprintjs/fingerprintjs`） | ~65% 唯一 | 免费 | 自托管，不出服务器 | ✅ **选它** |
| FingerprintJS Pro | 99.5% | 付费 SaaS | 过第三方 | ❌ 模板不必要 |
| 自建 Canvas/WebGL 指纹 | 低 | 自研 | 自托管 | ❌ 维护成本高 |

**识别键生成**（服务端）：

```
device_id = 客户端 FingerprintJS 生成的 visitorId（约 64 字符 hex）
anonymous_key = sha256(ip + device_id)
```

```typescript
// 客户端：首次加载时生成 device_id，后续请求带 X-Device-Id header
import FingerprintJS from "@fingerprintjs/fingerprintjs";
const fp = await FingerprintJS.load();
const result = await fp.get();
const deviceId = result.visitorId;

// 服务端：读取 header，缺失时降级
const deviceId = req.headers.get("x-device-id") || "";
const key = sha256(ip + deviceId);  // deviceId 为空时退化为纯 IP 维度
```

**维度组合效果**：

| 攻击方式 | 结果 |
|----------|------|
| 清 cookie / 隐私模式 | ❌ 无效——device_id 基于浏览器/硬件特征，与 cookie 无关 |
| 换 IP（同设备） | ❌ 无效——device_id 不变，key 里 ip 变化但 device_id 锚定 |
| 换浏览器/换设备 | ⚠️ device_id 变（正常用户换设备本应算新用户） |
| 伪造随机 device_id | ⚠️ 部分绕过——但每次伪造都等价于换设备，仍有 IP 维度兜底（见 §5） |

**降级策略**：FingerprintJS 脚本异步加载，首次演示时若指纹未就绪（`device_id` 为空），自动降级为纯 IP 维度限次；指纹就绪后的后续请求自动升级为双维度。用户体验不阻塞。

### 2.3 数据模型

```sql
CREATE TABLE anonymous_usage (
    id SERIAL PRIMARY KEY,
    anonymous_key VARCHAR(64) NOT NULL,   -- sha256(ip + device_id)，指纹缺失时 sha256(ip)
    usage_date DATE NOT NULL,              -- 当日
    count INT NOT NULL DEFAULT 0,
    updated_at timestamptz,
    UNIQUE (anonymous_key, usage_date)
);
```

> ⚠️ 隐私合规：只存 hash，不存明文 IP 或设备指纹原始值。FingerprintJS 开源版自托管，指纹数据不出服务器。

**扣减逻辑**（PostgreSQL RPC，单语句原子）：

```sql
-- 关键：WHERE count < p_limit 保证达到上限后不再递增（否则 count 无限增长）
-- ON CONFLICT + RETURNING 单语句原子，无并发窗口
CREATE OR REPLACE FUNCTION increment_anonymous_usage(
    p_key TEXT, p_date DATE, p_limit INT
) RETURNS INT AS $$
DECLARE v_count INT;
BEGIN
    INSERT INTO anonymous_usage (anonymous_key, usage_date, count)
    VALUES (p_key, p_date, 1)
    ON CONFLICT (anonymous_key, usage_date)
    DO UPDATE SET count = anonymous_usage.count + 1,
                  updated_at = now()
    WHERE anonymous_usage.count < p_limit
    RETURNING count INTO v_count;

    RETURN COALESCE(v_count, p_limit);  -- 达到上限时返回 p_limit（拒绝）
END $$ LANGUAGE plpgsql;
```

```typescript
// 服务端调用
const deviceId = req.headers.get("x-device-id") || "";
const key = sha256(ip + deviceId);
const today = new Date().toISOString().slice(0, 10);
const count = await rpc("increment_anonymous_usage", { p_key: key, p_date: today, p_limit: 3 });
if (count >= 3) return respErr(429, "今日免费次数已用完");
```

> ⚠️ 与 P-1.2 积分扣减同一纪律：原子化是硬要求。`WHERE count < p_limit` 是防止 count 无限增长的关键细节，缺失会导致记录膨胀且语义错误。

### 2.4 演示端点

```
POST /api/v1/ai/demo
  （无需登录，服务端按 anonymous_key 限次）
  ├─ 匿名配额用完 → 429 + 提示「今日免费次数已用完，登录送 10 积分」
  └─ 成功 → 返回结果 + 剩余次数
```

与正式网关 `/api/v1/ai/generate`（需登录 + 扣积分）分离，演示不碰积分系统。

### 2.5 失败是否消耗次数

| 情形 | 是否消耗 | 理由 |
|------|----------|------|
| 生成成功 | ✅ 消耗 | 服务已提供 |
| 服务端异常/模型报错 | ❌ 退还 | 用户未获得服务（对应正式网关的 ai_refund） |
| 用户主动中断 | ✅ 消耗 | 已消耗模型算力 |

> 退还实现：失败时对 `anonymous_usage.count` 减 1（需保证不出现负数，RPC 内 `GREATEST(count-1, 0)`）。

### 2.6 数据清理（防表膨胀）

`anonymous_usage` 每 IP+UA 每天一行，需定期清理：

```sql
-- 定时任务（与 6.16 数据备份同一 Cron）：删除 30 天前记录
DELETE FROM anonymous_usage WHERE usage_date < CURRENT_DATE - INTERVAL '30 days';
```

### 2.7 与旧 demo API 的关系（协调 P-1.4）

现有 `/api/demo/gen-text` 等端点与匿名演示功能重叠。P-1.4 的「Demo AI 无认证」修复与匿名演示设计需协调，最终归宿：

| 端点 | 归宿 |
|------|------|
| `/api/demo/*`（旧） | **废弃**，前端改调 `/api/v1/ai/demo` |
| `/api/v1/ai/demo`（新） | 匿名演示：无需登录，设备指纹+IP 限次 |
| `/api/v1/ai/generate`（新） | 正式：需登录 + 积分扣减 |

> 即 P-1.4 问题 2 的修复方式是「重构为匿名演示端点」，而非「给旧 demo 加登录」。否则与「未登录可试用」的需求矛盾。

---

## 三、登录免费积分

### 3.1 沿用现有 new_user 逻辑

| 项 | 现状 | 说明 |
|----|------|------|
| 赠送数量 | 10 积分 | `CreditsAmount.NewUserGet = 10`，已实现 |
| 有效期 | 1 年 | `getOneYearLaterTimestr()`，已实现 |
| 触发 | 首次 OAuth 登录 | `saveUser()` 内 `increaseCredits`，已实现 |

**无需新开发**，现有逻辑即满足「登录送免费积分」。

### 3.2 用量感知（新增）

| 场景 | 提示 |
|------|------|
| 余额 < 10（低阈值） | 邮件 `credit_low`（docs/10 已设计） |
| 余额 == 0 | 邮件 `credit_exhausted` + 前端弹窗「积分已用完，点击充值」 |
| 余额不足本次调用 | 402 + `{required, balance}`（ai-gateway 已设计） |

---

## 四、完整转化漏斗

```
未登录用户
  │ 每天 3 次演示（IP+指纹限次）
  │ 用完 → 429「登录送 10 积分」
  ▼
注册/登录
  │ 送 10 积分（1 年有效，现有逻辑）
  │
  ├─ 用完 → 402/弹窗「积分已用完」
  ▼
购买积分包（payment_products）
  │ 充值积分（order_pay）
  ▼
正式调用 /api/v1/ai/generate（按 token 预估扣费）
```

**关键转化点**：演示用完 → 登录（低门槛，OAuth 一键）；积分用完 → 充值（支付链路）。

---

## 五、防刷边界（诚实声明）

| 攻击 | 能否防 | 手段 |
|------|--------|------|
| 清 cookie / 隐私模式 | ✅ 防 | device_id 与 cookie 无关 |
| 换 IP（同设备） | ✅ 防 | device_id 锚定，key 里 ip 变化无效 |
| 换浏览器/换设备 | ⚠️ 部分防 | device_id 变，等价于新用户（正常用户换设备本应算新用户） |
| 伪造随机 device_id | ⚠️ 部分防 | 每次伪造=换设备，仍有 IP 维度兜底（同 IP 伪造多次会被 IP 维度拦住） |
| 换 IP + 伪造指纹（代理池） | ❌ 不防 | 需 Pro 级指纹 + 行为分析 + 验证码，**模板阶段不做** |

**决策**：设备指纹（开源版）把防刷从「清 cookie 即可刷」提升到「需换 IP 且伪造指纹才能刷」。对抗代理池/黑产不是模板职责，留给真实产品的风控层。这与「一次性付款优先」「订阅后续再说」的 v1 简化哲学一致。

**fingerprint 升级路径**：开源版（~65%）→ Pro 版（99.5%，按次付费）→ 行为分析/验证码。模板只做第一档，后续按数据表现升级。

---

## 六、与既有架构的整合

| 依赖 | 关系 |
|------|------|
| ai-gateway（docs/13） | 演示模式是网关的匿名入口，正式生成是登录入口，两者分离 |
| P-1.4 Demo API 修复 | **修正**：旧 `/api/demo/*` 废弃，重构为 `/api/v1/ai/demo` 匿名演示端点（见 §2.7） |
| P-1.2 原子扣减 | 匿名配额「检查+递增」与积分「检查+扣减」同一 RPC 纪律 |
| 6.18 限流（P3） | 匿名演示的 IP 限次是 6.18 的前置简化版，Upstash 落地后可替换 anonymous_usage 表 |
| 6.2 邮件 | credit_low / credit_exhausted 复用 |
| 埋点（docs/11） | 埋 `trial.exhausted` / `trial.signup_prompted` 测转化率 |
| 6.16 数据备份 | anonymous_usage 的 30 天清理任务与备份 Cron 共用调度 |

---

## 七、环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `ANONYMOUS_DAILY_LIMIT` | ❌（默认 3） | 未登录用户每日免费演示次数 |
| `DEMO_MODEL` | ❌（默认 deepseek-chat） | 演示使用的模型 |
| `DEMO_MAX_TOKENS` | ❌（默认 1024） | 演示输出上限 |
| `ANONYMOUS_FINGERPRINT_ENABLED` | ❌（默认 true） | 是否启用设备指纹（关闭则退化为纯 IP 维度） |

> 依赖：`@fingerprintjs/fingerprintjs`（开源版，自托管，无 API key 需求）。
> 需同步登记到 docs/08-config-env.md（单一真相源）。

---

## 八、实施分期

| 阶段 | 内容 |
|------|------|
| v1 | anonymous_usage 表 + RPC 原子递增 + `/api/v1/ai/demo` 演示端点 + FingerprintJS 设备指纹 + 前端「用完提示登录」弹窗 |
| v2 | 演示用模型/次数后台可配 + 埋点转化漏斗 |
| v3 | Upstash 限流替换 anonymous_usage 表（与 6.18 合并）；指纹按数据表现考虑升级 Pro |

---

## 九、对抗式自检

| 检查点 | 结论 |
|--------|------|
| 是否解决「关掉客户端再进刷新积分」？ | ✅ 根本解决——匿名额度是服务端 IP+设备指纹计数，与客户端状态无关 |
| 是否过度设计？ | 无——设备指纹用开源版（免费自托管），未做 Pro 级指纹/验证码/代理池风控 |
| 是否与现有「登录送 10 积分」重复？ | 不重复——匿名是限次演示，登录是积分账户，两个独立机制 |
| 是否引入新安全风险？ | anonymous_usage 表存 hash 不存明文；FingerprintJS 开源版自托管数据不出服务器，GDPR 风险可控 |
| 客户端指纹可被伪造？ | 是，但有 IP 维度兜底（同 IP 伪造多次被 IP 维度拦），且防刷目标是挡普通用户而非黑产 |
| 演示和正式是否混淆？ | 已分离：演示不碰积分系统，正式才扣积分 |
