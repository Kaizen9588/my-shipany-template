-- 0017_seed_blog_posts.sql
-- 新增两篇英文长尾关键词 blog（2026-08-17）
-- 对应后端已实现能力：匿名 AI 限次 + 飞书/企微告警机器人
-- 幂等：ON CONFLICT (uuid) DO NOTHING

INSERT INTO posts
  (uuid, slug, title, description, content, created_at, updated_at, status, author_name, cover_url, author_avatar_url, locale)
VALUES
(
  '83dd4c14-a929-44e7-a4d1-e487d92c8c85',
  'limit-anonymous-ai-usage-per-ip-nextjs',
  'How to Limit Anonymous AI Usage per IP in a Next.js App (Without Login)',
  'Give visitors a login-free AI demo without getting abused. Production patterns for per-IP daily limits: atomic Postgres counters, refund-on-error, server-side model guardrails, and rate limiting.',
  $post1$# How to Limit Anonymous AI Usage per IP in a Next.js App (Without Login)

The best conversion flow for an AI product is often the simplest one: let a visitor type a prompt, see a real answer, and then ask them to sign up. Requiring login before the first click adds friction and kills a surprising amount of signup volume.

The trade-off is abuse. If an anonymous AI endpoint is unlimited, the world can treat it as a free API. This guide shows the production patterns we use for a **login-free AI demo with a per-IP daily limit** in a Next.js app backed by PostgreSQL (Supabase), and the exact pitfalls you should avoid.

## Why allow anonymous AI use at all

An anonymous demo is not a workaround for "we have no auth." It is usually the top of a funnel:

1. The visitor evaluates the output quality before committing to an account.
2. You collect no PII at the top of the funnel, so signup friction is zero.
3. The demo experiences the real product path, so conversion is higher than a mock screenshot.
4. Each anonymous request costs you money, so you need hard controls.

The correct mental model is: **anonymous usage is a rate limit, and registered usage is a credit balance.** A free demo should be a safety valve, not a free tier competitor.

## The core problem: identity without a login

Without a user account, the only reasonable identity signals are:

- The IP address the request comes from.
- A client-supplied ID in a header or cookie.

Never trust a client-supplied ID as your **only** quota key. Headers such as `x-device-id` are trivially spoofed with a few lines of code. An attacker can rotate the value and get a fresh daily quota forever.

In practice we use the IP as the quota key and hash it before storing it:

```ts
const ip = await getClientIp();
const anonymousKey = hashString(ip); // sha256(ip) or similar
```

Two consequences you should accept consciously:

- **Shared/NAT IPs** (office, mobile carrier) share one daily quota. That is fine for a demo; it only encourages signing up.
- **Proxy pools** can still rotate IPs. If that becomes a real problem, add a rate-limiter per IP and device fingerprint, then escalate to login. No anonymous system is provably abuse-proof; you are raising the cost, not removing it.

## An atomic daily counter in PostgreSQL

The quota must be atomic. If two requests pass the check at the same moment and both see `count = 2` for a limit of `3`, you can over-serve by one or two calls. The classic fix is either a row lock with `SELECT ... FOR UPDATE` or a single PostgreSQL function that increment-and-checks in one statement.

The template uses a small table plus a function:

```sql
CREATE TABLE IF NOT EXISTS anonymous_usage (
    id BIGSERIAL PRIMARY KEY,
    anonymous_key VARCHAR(64) NOT NULL,
    usage_date DATE NOT NULL,
    count INT NOT NULL DEFAULT 0,
    UNIQUE (anonymous_key, usage_date)
);
```

The increment function does the check **and** the insert/update in one statement:

```sql
CREATE OR REPLACE FUNCTION increment_anonymous_usage(
    p_key VARCHAR,
    p_date DATE,
    p_limit INT
) RETURNS INT AS $$
DECLARE
    v_count INT;
BEGIN
    INSERT INTO anonymous_usage (anonymous_key, usage_date, count)
    VALUES (p_key, p_date, 1)
    ON CONFLICT (anonymous_key, usage_date)
    DO UPDATE SET count = anonymous_usage.count + 1
    WHERE anonymous_usage.count < p_limit
    RETURNING count INTO v_count;

    RETURN v_count; -- NULL when already at the limit
END;
$$ LANGUAGE plpgsql;
```

Then the API calls the function with RPC:

```ts
const { data: count, error } = await supabase.rpc(
  "increment_anonymous_usage",
  { p_key: anonymousKey, p_date: today, p_limit: dailyLimit }
);
if (error) {
  return jsonErr("demo failed", 500);
}
if (count === null || count > dailyLimit) {
  return jsonErr("今日免费次数已用完，登录送 10 积分", 429, { remaining: 0 });
}
```

### The off-by-one trap

A very common bug in this pattern is checking `count >= p_limit` after the increment:

- Limit is `3`.
- The first successful call increments `0 -> 1` and returns `1`. Fine.
- Call two returns `2`. Fine.
- Call three returns `3`. With `count >= 3` as the rejection check, call three is **rejected**, and the user only ever got two requests.

The fix is to treat the function's return value correctly. When the `UPDATE ... WHERE count < p_limit` row is not updated, PostgreSQL returns `NULL`. So reject whenever you did not actually get a new row: `if (count === null || count > dailyLimit)`. A `NULL` means "at the limit, nothing was charged."

## Refund used quota on failure

If the model provider errors after we already incremented the counter, the visitor should not lose a demo credit for a request that returned nothing. The symmetric function decrements the counter for that key and date:

```ts
try {
  const result = await generateText({ model: ..., prompt, maxTokens });
  return Response.json({ code: 0, data: { text: result.text, remaining } });
} catch (e) {
  await supabase.rpc("decrement_anonymous_usage", {
    p_key: anonymousKey,
    p_date: today,
  });
  return jsonErr("demo failed", 500);
}
```

This is the same philosophy as refunding credits when a paid AI call fails, but for a free quota. It keeps the product honest: users are only charged when they actually get a result.

## Keep model choice server-side

An anonymous endpoint should never accept a `model` field from the client. If it does, a scraper can freely use your most expensive model. The server decides the model and the token cap:

```ts
const demoModel = process.env.DEMO_MODEL || "deepseek-chat";
const pricing = getModelPricing(demoModel);
if (!pricing) return jsonErr("demo model not configured", 500);
const maxTokens = parseInt(process.env.DEMO_MAX_TOKENS || "1024", 10) || 1024;
```

Doing this server-side means:

- You can switch the demo model by changing an environment variable, not a deploy.
- You never leak your more expensive model IDs or their costs into the browser.
- You can constrain `maxTokens` with `DEMO_MAX_TOKENS`, so a cheap demo stays cheap even if prompt length grows.

## Add a rate limiter on top

The daily counter stops "one identity per day" abuse, but a single IP can still hammer the endpoint in a short burst, which wastes provider capacity and can trip provider errors. Add a short-window limiter as a first line of defense:

```ts
const rl = rateLimitByIp(ip, 60);
if (!rl.ok) {
  return jsonErr("too many requests", 429);
}
```

A 60-second limiter plus the daily Postgres counter is a cheap, robust combination for a demo endpoint.

## What the user sees when the limit is reached

When the daily quota is exhausted, return a deliberate, conversion-oriented response. A bare 429 is unhelpful; telling the visitor the next step converts better:

```json
{ "code": -429, "message": "今日免费次数已用完，登录送 10 积分", "data": { "remaining": 0 } }
```

On the front end, show a small panel: "You have used today's free tries — create an account to get 10 credits." This is where the demo funnel hands off to the registered product.

## Privacy and compliance

Because the quota is per identity, resist storing the raw IP. Store a one-way hash:

```ts
export function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
```

This keeps you from maintaining a long-lived table of un-hashed user IPs for no business reason, and it makes retention/deletion simpler. Document clearly that IP-derived keys may be shared behind NAT, and that rotating proxies remain a known edge case.

## When to switch from an anonymous demo to a real account

Anonymous monthly usage is a demo control, not a billing system. Once a visitor shows interest (multiple demo calls, a saved artifact, an email capture), move them into your registered flow, where real usage is metered with **credits**:

- Accounts get a signup credit balance (for example 10 credits).
- Each AI call deducts credits atomically with a ledger row.
- Failed provider calls refund the debited credits.
- Credits are topped up through Stripe, Creem, or another payment provider.

That split keeps the free path cheap to operate and the paid path auditable.

## Checklist for a secure anonymous AI demo

- Quota key is IP-based only; ignore client-supplied device IDs for limit decisions.
- Hash the key before storing.
- The increment-and-check is atomic in one database statement.
- `NULL` from the increment function means "already at the limit, don't charge."
- Refund/decrement when the provider call fails.
- The model and `maxTokens` are chosen server-side, never from the client.
- Add a short-window IP rate limiter in front of the daily counter.
- Return a clear 429 message that drives signup.
- Store hashes, not raw IPs.

Used correctly, an anonymous AI demo is one of the highest-converting free features you can ship — and with an atomic daily counter, it costs a predictable amount per visitor instead of becoming an open ended API bill.

_Want to see how the login path, credits, and Stripe/Creem payments fit together? Read our related guides: [How to Add Usage-Based Credits to a Next.js AI App](/en/posts/how-to-add-usage-based-credits-nextjs-ai-app) and [Next.js AI SaaS boilerplate with Stripe and Creem](/en/posts/nextjs-ai-saas-boilerplate-stripe-creem-payments)._
$post1$,
  '2026-08-17T08:00:00+00:00',
  '2026-08-17T08:00:00+00:00',
  'online',
  'ShipAny Team',
  NULL,
  NULL,
  'en'
),
(
  '8b791dfb-fccc-499b-8651-99fcab1e348e',
  'feishu-wecom-webhook-alerts-saas-payments',
  'Monitor AI SaaS Payments with Feishu (Lark) and WeCom Webhook Alerts',
  'Practical guide to alerting payment channel failures, amount mismatches and refunds to Feishu or WeCom bots: webhook setup, severity levels, event rules, signatures and troubleshooting.',
  $post2$# Monitor AI SaaS Payments with Feishu (Lark) and WeCom Webhook Alerts

If you operate an indie AI SaaS, your payment flow is the most important page on the site and also the most fragile. Webhooks can fail to arrive, signatures can mismatch, a payment provider can randomly reject a checkout, and an attacker can tamper with an order amount. Waiting for a user to write support to notice a payment issue is the expensive way to operate.

This guide shows how to wire **payment and system alerts into Feishu (Lark) and WeCom (企业微信) chat bots**, the exact event categories worth monitoring, the severity model that keeps alerts useful, and how to avoid the config mistakes that make webhook alerts unreliable.

## Why webhook alerts instead of email

Email is the right channel for digests and user-facing receipts. For operational incident handling, a chat bot wins on three axes:

- **Reachability**: the payment/ops group is already open and notifying on the phone.
- **Speed**: a pushing message reaches a human in seconds, not "as soon as they open email."
- **Traceability**: a group keeps a shared history of past incidents that the whole team can see.

For Chinese indie builders, WeCom and Feishu are the practical choice because both are free, support markdown messages, and their group webhooks are straightforward.

## The events worth alerting

Do not alert on everything. An alert channel that fires for every small log line gets ignored. We recommend a small, high-value event catalog. Here is the one used in the template:

| eventType | 说明 / description | default severity | status |
|---|---|---|---|
| `payment.provider_unhealthy` | 支付渠道自动摘除（连续 5 次失败，30 分钟自动切换路由） | critical | 已接入 |
| `payment.provider_failure` | 同一渠道 checkout 调用失败 | warn | 仅日志 |
| `payment.amount_mismatch` | 实付金额与本地订单不一致（疑似攻击或调价未同步） | critical | 已接入 |
| `payment.webhook_invalid_signature` | Webhook 签名校验失败 | critical | 预留 |
| `payment.refund_processed` | 退款成功并扣回积分 | warn | 已接入 |
| `payment.provider_recovered` | 渠道健康判定后恢复可用 | info | 已接入 |
| `system.env_or_migration_failed` | 启动或迁移失败 | critical | 预留 |
| `auth.login_failed_burst` | 短时间内多次登录失败（疑似撞库） | warn | 预留 |

The **status** column matters: `已接入` means the event is actually sent to the notifier today, `仅日志` means the code logs it but does not push yet, and `预留` means it is defined and can be wired later. When you plan your alert system, be honest per event about which ones already push; otherwise the "test message" button gives a false impression.

### The two events you must alert on first

1. **`payment.amount_mismatch`** — if the amount the provider charged does not equal what your server calculated, you are either being attacked or your pricing is out of sync. Send this immediately, regardless of channel status.
2. **`payment.provider_unhealthy`** — your payment route should automatically switch providers when one is down. The switch itself is a critical business event because it changes which checkout page users see and which settlement pipeline you are feeding.

## Setting up a Feishu (Lark) custom bot

1. Open a Feishu group → 「设置」→「群机器人」→「添加机器人」→「自定义机器人」.
2. Copy the webhook URL: `https://open.feishu.cn/open-apis/bot/v2/hook/<token>`.
3. Optional but recommended: enable **签名校验** in the bot settings. Save the secret.
4. Store both in server environment variables, not in the front-end bundle:
   - `FEISHU_WEBHOOK_URL`
   - `FEISHU_SECRET`

The Feishu signature algorithm uses a timestamp followed by a newline plus the secret:

```ts
const timestamp = Math.floor(Date.now() / 1000).toString();
const sign = createHmac("sha256", timestamp + "\n" + secret)
  .update("")
  .digest("base64");
```

Send `X-Lark-Request-Timestamp`, `X-Lark-Request-Signature`, and the same `timestamp` / `sign` fields in the body. If the group has signature verification enabled and you omit it, Feishu returns an error with `code !== 0`.

## Setting up a WeCom (企业微信) bot

1. Open a WeCom group →「添加群机器人」→ copy the webhook URL:
   `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<key>`.
2. Store `WECOM_WEBHOOK_URL` as a server-only environment variable. The `key` in the URL is effectively a secret — never put it in a public repo or a client bundle.
3. WeCom uses markdown messages, but Note: WeCom markdown does not support red titles; use `<font color="warning">` for critical alerts.

```ts
const color = message.severity === "critical" ? "warning" : "comment";
const content = `## <font color="${color}">${message.title}</font>\n${message.body}`;
await fetch(webhookUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ msgtype: "markdown", markdown: { content } }),
});
```

- WeCom limits markdown pushes to roughly **20 messages per minute** per bot. Implement at least one suppression rule so a burst of the same alert does not exceed that.
- A non-zero `errcode` in the JSON response means the message was rejected. Surface the `errmsg` to your logging so you can see typo/status mistakes.

## Severity levels and per-event rules

A flat "notify on everything" config is unmanageable. Use a two-layer filter:

- **Global minimum severity**: `info / warn / error / critical`. Setting it to `warn` means informational events never wake people up, but critical ones always do.
- **Per-event enable + minimum severity**: you can turn individual events off or tighten an event's threshold independently. If you only care about money issues, you can enable only `payment.*` critical events and leave auth bursts as log-only.

This filtering happens before the webhook request is sent, so a disabled event never consumes a Feishu/WeCom rate-limit budget.

## Suppression: don't spam the group

The first time a provider fails, a warning is useful. The 47th retry in an hour is noise. An alert pipeline should:

- Key by `eventType + subject + title`.
- Suppress duplicates for a window (30 minutes is a reasonable default).
- Still record every failure in application logs, so the audit trail is complete even when the chat is quiet.

```ts
const key = `${message.eventType || ""}:${message.subject || ""}:${message.title}`;
if (last && now - last < SUPPRESS_MS) return;
```

For a single server process, an in-memory Map is fine. If you run multiple instances, move suppression to Redis so instances share the same dedupe state.

## Payload examples

**Feishu interactive card:**

```json
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": { "tag": "plain_text", "content": "🔴 支付渠道已自动摘除" },
      "template": "red"
    },
    "elements": [
      { "tag": "div", "text": { "tag": "lark_md", "content": "provider: stripe\n连续 5 次 checkout 失败\n订单号: ord_123456" } }
    ]
  }
}
```

**WeCom markdown:**

```text
## <font color="warning">支付金额不匹配</font>
订单: ord_123456
本地金额: 19.90 CNY
实付金额: 1.00 CNY
请立即检查 stripe 产品配置与 webhook。
```

## Security checklist

A chat-bot webhook is itself a secret. Treat it as such:

- Store webhook URLs and keys in server environment variables; never inline them client-side.
- Never put a WeCom `key` or a full Feishu token in a repo, log, or error message.
- Redact secrets, full API keys, and customer PII from the alert body. Show the order number, the provider id, and the mismatch summary, not the customer's password hash or your Stripe secret.
- Enable Feishu signature verification and verify webhook signatures before processing payment events. A push notification is not a security control; the webhook **processing** still needs its own CSP-style signature check.
- Add suppression before hitting provider rate limits, and make the notification path **non-blocking** — a failure to push alerts must never break the payment flow.

## Testing in a real implementation

The test button must talk to the real pipeline, not a mock. The template's "发送测试消息" endpoint does exactly that:

- It loads the currently configured Webhooks.
- If none are configured, it returns an explicit error: **「请先配置至少一个机器人 Webhook（飞书或企业微信）再发送测试消息」**.
- If at least one is configured, it sends a real markdown message through Feishu and/or WeCom and reports per-channel failures.

A test button that "succeeds" without hitting the network is a demo, not an alert system. Because this pipeline uses the actual `send()` implementations and checks the real HTTP responses (`code` / `errcode`), you can trust the green check.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Feishu returns `code != 0` | Signature verification enabled but missing/invalid `sign` | Add `FEISHU_SECRET` and send correct HMAC |
| WeCom returns `errcode != 0` | Wrong key or message too large | Re-create the bot key, shrink body, check `errmsg` |
| No message after a critical payment event | Global severity or per-event rule disabled | Check `notifyMinSeverity` and event rule `enabled` |
| Same alert repeated every retry | No suppression configured | Add 30-min dedupe per `eventType+subject` |
| Test button fails while code seems fine | No webhook configured, or network blocked | Verify env vars and allowlist egress to `open.feishu.cn` / `qyapi.weixin.qq.com` |

## What to implement next

Chat-bot alerts solve the "we didn't notice" problem. After that, add:

- Provider-level health checks that mark a channel unhealthy and **switch routes automatically**.
- A payments dashboard that stores each channel's last health probe and a manual force-switch.
- A digest telemetry path (for example PostHog or OpenPanel) so ops data is correlated with user events.

An alert system is only as trustworthy as its most embarrassing flake. Build it on real HTTP responses, use severity + suppression, keep secrets server-side, and make the test button prove the whole path — then your payment incidents wake you up instead of catching you by surprise.

_Curious how the payment providers, switching and credits interact? Read [How to Add Usage-Based Credits to a Next.js AI App](/en/posts/how-to-add-usage-based-credits-nextjs-ai-app) and [Next.js AI SaaS Boilerplate with Stripe and Creem Payments](/en/posts/nextjs-ai-saas-boilerplate-stripe-creem-payments)._
$post2$,
  '2026-08-17T08:10:00+00:00',
  '2026-08-17T08:10:00+00:00',
  'online',
  'ShipAny Team',
  NULL,
  NULL,
  'en'
)
ON CONFLICT (uuid) DO NOTHING;
