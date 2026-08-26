# 邮件系统设计

> 版本：v1（✅ 已实现，见落地记录；配合一次性积分包阶段，预留订阅续费提醒能力）
> 目标：事务性邮件可扩展、模板可维护、失败可追踪；营销类与事务类严格分离（合规边界）
> 更新：2026-08（第八轮审查后补充生产边界说明）
>
> ✅ **v1 落地记录（2026-08）**：`lib/email/*`（Provider 抽象 + Resend 适配器 + fire-and-forget + shouldSendToday 节流）、
> `emails/`（React Email 布局 + welcome/payment_success/credit_low/credit_exhausted/verification_code 模板）、
> 触发点接入（saveUser 欢迎 / handleOrderSession 支付成功 / decreaseCredits 余额提醒 / send-verification 验证码）。
> v2（email_logs + webhook 追踪 + 退订页 + 营销邮件）待落地。

---

## 一、邮件类型与合规边界

### 1.1 两类邮件必须物理分离

| 类型 | 可否退订 | 法律约束 | 示例 |
|------|----------|----------|------|
| **事务性 Transactional** | ❌ 不可退订 | 必须送达（否则用户因未收到续费通知而投诉/退款） | 支付成功、续费提醒、积分变动、密码重置 |
| **营销性 Marketing** | ✅ 必须可退订 | CAN-SPAM / GDPR，需 unsubscribe 链接 + 退订即时生效 | 产品更新、促销 |

**数据库字段**（users 表加，⚠️ **未落地**：v1 无营销邮件，该字段当前不存在于 schema）：

```sql
-- 仅在做营销邮件（v2）时添加
ALTER TABLE users ADD COLUMN email_marketing_opt_in BOOLEAN NOT NULL DEFAULT true;
```

事务性邮件**不检查**此字段，营销性邮件**必须检查**（届时才需要该字段）。

### 1.2 续费提醒的合规要求（虽然 v1 不做订阅，设计必须预留）

你提到的"续费前几天必须通知"不仅是体验问题，多地是**法律要求**：

| 地区 | 法规 | 要求 |
|------|------|------|
| 美国联邦 | ROSCA | 明确披露自动续费条款 + 用户明确同意 + 易于取消 |
| 加州 | ARL | 免费试用转付费前必须通知；部分场景续费前通知 |
| 欧盟 | Consumer Rights Directive | 缔约前信息 + 14 天撤销权 |

**设计约束**：订阅模块必须内置「续费前 N 天提醒」的调度钩子（见 §4 触发点表），不能等到做订阅时才补。

---

## 二、发送抽象层（与支付 Provider 同构）

### 2.1 接口定义

```typescript
// lib/email/types.ts

export type EmailTemplate =
  | "welcome"
  | "verification_code"               // ✅ 已落地：邮箱验证码
  | "payment_success"
  | "credit_low"
  | "credit_exhausted"
  | "subscription_renewal_reminder"   // 预留：订阅续费提醒
  | "subscription_canceled"
  | "password_reset";

export interface EmailMessage {
  to: string;              // 收件人
  template: EmailTemplate;
  variables: Record<string, string | number>;  // 模板变量
  category: "transactional" | "marketing";
}

export interface EmailResult {
  id: string;              // provider 返回的 message id
  status: "sent" | "failed";
  error?: string;
}

export interface EmailProvider {
  id: string;              // "resend"
  hasValidCredentials(): boolean;
  send(message: EmailMessage): Promise<EmailResult>;
}
```

### 2.2 Provider 实现（Resend）

```typescript
// lib/email/providers/resend.ts
import { Resend } from "resend";

export const resendProvider: EmailProvider = {
  id: "resend",
  hasValidCredentials() {
    return Boolean(process.env.RESEND_API_KEY);
  },
  async send(message) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "onboarding@resend.dev",
      to: [message.to],
      subject: getSubject(message.template),
      react: renderTemplate(message),  // React Email 渲染
    });
    return error
      ? { id: "", status: "failed", error: error.message }
      : { id: data?.id || "", status: "sent" };
  },
};
```

> 与支付一样：换邮件服务商（AWS SES / Postmark）只改这一个文件。

### 2.3 统一入口

```typescript
// lib/email/index.ts

// 业务代码只调这个，不感知 provider
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const provider = getEnabledProvider();  // 当前只有 resend
  if (!provider || !provider.hasValidCredentials()) {
    console.error("email provider not configured, skip:", message.template);
    return { id: "", status: "failed", error: "no provider" };
  }
  return provider.send(message);
}
```

> ⚠️ **降级策略**：邮件发送失败**不阻塞主流程**（如支付处理）。支付成功但邮件失败 → 订单照常有效，邮件重试靠 Resend 自身机制 + 日志追踪。

---

## 三、模板管理（React Email）

### 3.1 目录结构

```
emails/
├── templates/
│   ├── welcome.tsx
│   ├── verification-code.tsx          # ✅ 邮箱验证码
│   ├── payment-success.tsx
│   ├── credit-low.tsx
│   ├── credit-exhausted.tsx
│   ├── subscription-renewal-reminder.tsx   # 预留
│   ├── subscription-canceled.tsx
│   └── password-reset.tsx
├── index.ts          # template -> subject + component 映射
└── layout.tsx        # 统一邮件布局（品牌、footer、退订链接）
```

### 3.2 模板注册表

```typescript
// emails/index.ts
import { WelcomeEmail } from "./templates/welcome";
// ...

export const templates = {
  welcome: { subject: "Welcome to {project}", component: WelcomeEmail },
  payment_success: { subject: "Payment received", component: PaymentSuccessEmail },
  credit_low: { subject: "Your credits are running low", component: CreditLowEmail },
  // ...
} as const;

export function renderTemplate(message: EmailMessage) {
  const t = templates[message.template];
  return <t.component {...message.variables} />;
}
```

### 3.3 模板要求

- 每个模板 footer 统一放：品牌名 + 产品 URL + 「这是事务性邮件，无法退订」或营销类的退订链接
- 变量缺失时模板必须能渲染出占位符而非抛错（发错比不发好）

---

## 四、触发点映射表

| 触发场景 | 邮件模板 | 类别 | 触发位置 | 阶段 |
|----------|----------|------|----------|------|
| 新用户注册（OAuth 首次登录） | welcome | transactional | `services/user.ts` saveUser 后 | v1 |
| 邮箱验证码 | verification_code | transactional | `/api/user/send-verification`（仅存 hash + 原子消费） | v1 |
| 支付成功（积分充值） | payment_success | transactional | `services/order.ts` handleOrderPayment 后 | v1 |
| 积分低于阈值（如 <10） | credit_low | transactional | `services/credit.ts` decreaseCredits 后检查 | v1 |
| 积分耗尽 | credit_exhausted | transactional | 同上（余额 == 0） | v1 |
| **订阅续费前 3/7 天** | subscription_renewal_reminder | transactional | 订阅模块调度（Vercel Cron） | 预留 |
| 订阅取消确认 | subscription_canceled | transactional | 订阅 webhook | 预留 |
| 密码重置 | password_reset | transactional | auth 模块 | 预留 |
| 产品更新/促销 | marketing_* | **marketing** | 后台手动/自动 | 预留 |

### 4.1 积分低余额检查的实现点

```typescript
// services/credit.ts decreaseCredits 末尾追加
// 注意：fire-and-forget，不 await（避免拖慢 API 响应）；错误在 sendEmail 内部消化
const left = await getUserCredits(user_uuid);
if (left.left_credits === 0) {
  void sendEmail({ to: userEmail, template: "credit_exhausted", ... });
} else if (left.left_credits < CREDIT_LOW_THRESHOLD) {
  void sendEmail({ to: userEmail, template: "credit_low", ... });
}
```

> 注意节流：同一天内不重复发 credit_low（避免每次扣费都发）。可用 `lib/cache.ts` 或数据库标记上次发送时间。

---

## 五、退订与偏好管理

| 场景 | 实现 |
|------|------|
| 营销邮件退订 | **v2 规划，未实现**：footer 放 unsubscribe 链接 -> `GET /api/unsubscribe?token=xxx` -> 置 `email_marketing_opt_in=false`（该路由与字段当前均不存在） |
| 事务性邮件 | 无退订入口，footer 说明「此邮件为账户通知」（v1 现状，全部 5 个模板均为事务性） |
| 退订 token | **v2 规划**：HMAC 签名 email + 过期时间，避免明文 email 可被遍历 |

---

## 六、失败重试与状态追踪

| 层 | 机制 |
|----|------|
| 发送失败 | Resend 自带重试（bounce 不会重试） |
| 业务降级 | 邮件失败不阻塞支付/积分主流程，`console.error` 记录 |
| 状态追踪 | v1 只记日志；v2 建 `email_logs` 表追踪 sent/bounced/complained |

> ⚠️ **生产边界（P2）**：当前 fire-and-forget + console.error 意味着：
> - 验证码邮件、支付成功邮件等关键通知可能静默丢失，用户无感知；
> - 无送达率、退信率、投诉率监控，可能影响发件人信誉；
> - 退信投诉无自动处理，长期可能被邮件服务商封禁。
> v2 的 `email_logs` + Resend webhook 是生产稳定运行的必要条件。

> Resend 的 webhook（bounced / complained / delivered）可在 v2 接入 `email_logs` 表，v1 先不做。

---

## 七、环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `RESEND_API_KEY` | ❌（配置后启用邮件） | Resend API Key |
| `EMAIL_FROM` | ❌ | 发件人地址，如 "MySaaS <noreply@example.com>" |
| `CREDIT_LOW_THRESHOLD` | ❌（默认 10） | 积分低余额提醒阈值 |

---

## 八、实施分期

| 阶段 | 内容 |
|------|------|
| v1（现在） | Provider 抽象 + Resend + welcome/verification_code/payment_success/credit_low/credit_exhausted 五个模板 + 触发点接入 |
| v2 | email_logs 表 + Resend webhook 追踪 + 退订页 + 营销邮件 |
| 预留 | subscription_renewal_reminder（合规必须，做订阅时同步实现） + password_reset |

---

## 九、与支付架构的一致性（对抗式自检）

| 设计点 | 支付 | 邮件 | 是否一致 |
|--------|------|------|----------|
| Provider 接口抽象 | ✅ | ✅ | 一致 |
| 凭据走环境变量 + hasValidCredentials | ✅ | ✅ | 一致 |
| 失败降级不阻塞主流程 | webhook 幂等重试 | 不阻塞支付 | 一致 |
| 合规边界 | MoR 税务 | 事务/营销分离 + 续费通知 | 一致 |
| 数据不绑定渠道 | order.payment_provider 冻结 | template 与 provider 解耦 | 一致 |

**遗留点**：邮件没有像支付那样的"热切换"诉求（换 Resend 到 SES 极少发生），因此不做 `email_settings` 表，Provider 靠环境变量即可。若未来要多 provider 并存（如国内用户走国内邮件服务），再补表。
