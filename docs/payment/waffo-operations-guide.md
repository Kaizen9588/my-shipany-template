# Waffo 操作指南（Waffo Pancake）

> **来源**：官方文档 https://docs.waffo.ai/zh（产品）、https://docs.waffo.ai/zh/integrate/skill（集成指南）、
> https://docs.waffo.ai/zh/api-reference/introduction（API 参考）。整编日期：2026-08-26。
> **定位**：Waffo 渠道唯一的现行操作入口（开通 → 密钥 → 建品 → checkout → webhook → 沙箱 → 上线）。
> [waffo-integration.md](./waffo-integration.md) 描述的上一代 API 仅作历史存档。
>
> ✅ **迁移执行记录（2026-08-27，路线 B 落地）**：
> `lib/payment/providers/waffo.ts` 已整体重写为 `@waffo/pancake-ts@0.19.1`（以安装包 d.ts 逐字段核对，
> 与本文件示意代码的细微出入以代码为准）；`app/api/waffo-notify` 改验 `x-waffo-signature`、成功回纯文本 `"OK"`；
> 新增迁移 `0018_waffo_pancake.sql`（`payment_products.waffo_product_id` + `waffo_orders.session_id/checkout_expires_at`）；
> 凭据收敛为 `WAFFO_MERCHANT_ID` + `WAFFO_PRIVATE_KEY[_BASE64]`，`WAFFO_API_KEY`/`WAFFO_PUBLIC_KEY` 已从代码与 `.env.example` 移除；
> `@waffo/waffo-node` 依赖卸载。**两个能力面变化**：①Pancake 无商户退款 API → `capabilities.refund_api=false`，
> 后台退款走手动指引（同 Creem），积分扣回靠 `refund.succeeded` webhook；②收银台方法集为 card/applepay/googlepay/wechat，
> **alipay 不再由本渠道承接**。三个沙箱用例见 §七 在真实凭据到位后仍须跑通才算验收完成。

---

## 一、结论速览（先读这节）

1. **本仓库三渠道均已落地**（Stripe / Creem / Waffo 各有适配器与 notify 路由），其中 Waffo 现有实现
   （`lib/payment/providers/waffo.ts`，`@waffo/waffo-node@3.0.1`）基于**上一代 API**——
   该代 API 已不出现在官方现行文档中（旧入口 waffo.com/docs 已不存在）。
2. **官方当前的唯一公开 API 是「Waffo Pancake」**，与本仓现有实现的对接模型差别很大：

| 维度 | 上一代（现行代码 waffo-node） | 官方现行（Waffo Pancake / pancake-ts） |
|------|------------------------------|----------------------------------------|
| SDK | `@waffo/waffo-node` | `@waffo/pancake-ts` |
| 凭据 | 4 个：API_KEY + PRIVATE_KEY + PUBLIC_KEY + MERCHANT_ID | 2 个：MERCHANT_ID + PRIVATE_KEY（PEM）；webhook 验签公钥由 SDK 内置 |
| 端点形态 | REST `POST /api/v1/order/create` 等 | REST 全 POST `https://api.waffo.ai/v1/actions/*` + GraphQL 只读 `/v1/graphql` |
| 金额格式 | 字符串 "99.00" | 显示金额（如 `9.90`，非分）+ 独立税费对象 `{taxAmount, taxIncluded}` |
| Webhook 签名头 | `X-SIGNATURE`（RSA） | `x-waffo-signature`（`t=<ts>,v1=<sig>` RSA-SHA256；SDK 内置公钥验证，时间戳防重放默认容忍 45 分钟——d.ts 注明该默认值专为覆盖完整重试日程而设，可用 `toleranceMs` 调整，置 0 关闭校验） |
| Webhook 响应体 | 必须 `{"message":"success"}` 否则重试（最多 8 次） | HTTP 200 + `"OK"` 即视为成功 |
| 事件名 | `PAYMENT_NOTIFICATION` / `REFUND_NOTIFICATION` / `SUBSCRIPTION_*` | `order.completed` / `refund.succeeded` / `refund.failed` / `subscription.*` 小写点分 |
| 产品模型 | 无产品概念，动态传金额 | Store（STO_）/ onetimeProducts / subscriptionProducts（PROD_/SUB_），支持 `.publish()` 发布生产 |

3. ~~未决事项：建议尽快完成路线 B 迁移~~ → ✅ **已于 2026-08-27 执行完毕**（见文首执行记录）；
   本文档此后作为 Waffo 渠道的对照手册与上线 checklist 使用，§七沙箱用例待真实凭据到位后跑通验收。

---

## 二、账号开通与 KYB

1. 注册商户后台：https://pancake.waffo.ai/merchant/auth/signin ，完成 KYB。
2. KYB 通过前，任何指向生产的调用都会得到 `403 {"prodEnabled": false}`（SDK 抛出业务错误，
   信息里明确提示完成账户设置）。这是最常见的首连报错，不要当成签名/网络问题排查。
3. 商户后台顶栏可切换 **TEST / PROD** 环境；产品默认建在 test 环境，
   写操作落到环境的哪一侧完全取决于后台当前所在的环境标签。

> 费率参考：官方费用页现标注 **Beta 价 3.9% + $0.50/笔**（旧版对接文档写的是 MoR 4.5%，以官网实时页面为准）。

## 三、获取密钥（只需两项）

位置：商户后台 → 顶栏选择目标环境 → **集成（Integration）→ API & Development**。在 **API Keys → Generate** 生成密钥对：
公钥上传到 Waffo 服务器，**私钥只展示一次**、当场下载保存（PEM/base64/raw 三种格式 SDK 均自动归一化），
建议起个环境名做昵称（test 与 prod 各生成一套，严禁混用）。

| 凭据 | 说明 |
|------|------|
| Merchant ID | 商户唯一标识，仅用于被识别，非机密，可直接复制；对应环境变量 `WAFFO_MERCHANT_ID` |
| Private Key（私钥） | RSA PEM，用于给每次请求计算 HMAC/RSA 签名；官方以 `.pem`（或 `.txt` 存纯文本）发放 |

**私钥注入方式**（官方推荐 C 供 CI 使用；`WAFFO_PRIVATE_KEY` 与 `WAFFO_PRIVATE_KEY_BASE64` 任一存在即生效，BASE64 优先）：

```bash
# 方式 A：直接复制 PEM 到 .env（\n 为字面换行转义）
export WAFFO_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBg...
-----END PRIVATE KEY-----"

# 方式 B：bash 单行转换（把 PEM 压成 \n 转义的一行）
export WAFFO_PRIVATE_KEY=$(sed ':a;N;$!ba;s/\n/\\n/g' ~/Downloads/private_key.pem)

# 方式 C：BASE64（CI/容器场景最省心，没有换行转义问题）
base64 -i private_key.pem | pbcopy          # macOS
export WAFFO_PRIVATE_KEY_BASE64="<粘贴>"
```

**本项目环境变量映射（✅ 2026-08-27 已按 Pancake 收敛）**：

| 变量 | 状态 |
|------|------|
| `WAFFO_MERCHANT_ID` | ✅ 需要（`MER_` 前缀商户标识） |
| `WAFFO_PRIVATE_KEY` | ✅ 需要（PEM；与 BASE64 变体任一存在即可） |
| `WAFFO_PRIVATE_KEY_BASE64` | 可选，CI/Docker 推荐（优先级高于 PEM 变量） |
| `WAFFO_API_KEY` | ❌ 已废弃：d.ts 全文无引用，代码与 `.env.example` 已移除 |
| `WAFFO_PUBLIC_KEY` | ❌ 已废弃：验签公钥内置于 SDK（可用 `webhookPublicKey` 配置覆盖，本项目不覆盖） |

> 登记台账已回写 `docs/08-config-env.md` §5.8。

## 四、建店与产品（Payment Wizard，约 15 分钟）

1. 左侧 **Products → Add Product**（或在 Business Model 向导中选择一次性/订阅模式）创建产品：
   名称、展示图、**价格（显示金额数字，非分）**、币种（一次性产品只能绑一个币种，多币种=多产品）、
   `taxCategory`（税务合规分类，SaaS 属软件类目）、可选服务条款/隐私政策链接。
2. 在向导页勾选已建产品，加入默认 **Store（STO_）**；也可在自选区新建 store 并指定国家/币种。
   Store 的作用是在结账时按用户地区和币种做 best-fit 匹配；未匹配到合格 store 时回落到费率最低的。
3. 结账配置（可选）：品牌色/logo、支付失败邮件抄送等。
4. **发布到生产**：向导最后一步 **go live（`.publish()`）**。
   所有新建资源默认只存在于 test 环境；publish 会把 test + prod 两份副本同时铺好，测试数据保留供复测。
   后续对产品的任何修改也要再次 publish 才对生产生效。

**Store 选择策略**：默认 "Best Match" 每笔交易实时重算（费率最低的合格 store 胜出）；要锁定指定 store 则在
下单参数里显式传。v1 直接用 Best Match，观察一段时间 Payout/后台 Store 表现后再考虑固定。

**与本模板定价的对接规则（硬约束）**：
- `starter / standard / premium` 各建一个 **onetimeProducts**，且**严格按目录原价创建、不配任何折扣**
  ——webhook 金额精确比对（迁移 0010）会把「实付 ≠ 订单额」的合法折扣支付置 `mismatch` 不充值
  （同 Stripe `allow_promotion_codes=false` 的既定决策，见 docs/05 §1.4 与 creem 文档 P3-3）。
- **税收口径必须在建品时钉死**：Pancake 返回 `taxes: {taxAmount, taxIncluded}`；MoR 含税模式下建议
  配置为「标价即实付」（taxIncluded=true），并保证它与 `payment_products.amount`（分）一致。
  若税外置（taxIncluded=false），实付 = 标价 + 税 > 订单额，会稳定触发 mismatch——这是切换时最容易踩的资金链路坑。
- 动态改价能力（priceSnapshot / display.amount 覆盖目录价）v1 不使用，减少一个 mismatch 变量；
  未来要用需同步设计「订单冻结快照价」。

## 五、Checkout 会话（代码侧的核心改造点）

```typescript
import { WaffoPancake } from "@waffo/pancake-ts";   // 真实导出名（npm：@waffo/pancake-ts）

const client = new WaffoPancake({
  merchantId: process.env.WAFFO_MERCHANT_ID!,
  privateKey: process.env.WAFFO_PRIVATE_KEY!,       // PEM / base64 / raw 自动归一化
  // baseUrl: 测试环境 API 基址（默认生产）
});

const result = await client.checkout.authenticated.create({
  productId: "PROD_xxx",              // 一次性/订阅产品同一参数
  currency: "USD",
  buyerIdentity: user_uuid,           // ✅ 绑定我方账户 id：防试用滥用/订单串号，登录态必须传
  buyerEmail: user_email,             // 预填结账页邮箱（MoR 合规反欺诈）
  // priceSnapshot: { amount, taxCategory },   // 动态改价 —— v1 禁用（理由见 §四）
  successUrl: `${WEB_URL}/pay-success`,
});
// result.checkoutUrl → 前端跳转（见下方硬规则）
```

> 无账号场景另有 `client.checkout.anonymous.create()`（空表单，适合模板店/分享链接）；本模板登录用户一律走 authenticated。
> ✅ 本节参数名已按 `@waffo/pancake-ts@0.19.1` 的 d.ts 校准并与适配器实现一致。

| 参数（d.ts 字段名） | 必填 | 要点 |
|--------|------|------|
| `productId` | ✅ | 目录产品 ID（`PROD_`/`SUB_`），需已 `.publish()`；**金额真相在渠道目录，本地下单不传金额** |
| `currency` | ✅ | ISO 4217；一次性产品只支持其建品币种 |
| `buyerIdentity` | ✅（authenticated） | 我方账户标识（传 user_uuid），编码进会话 JWT——防串号/滥用 |
| `buyerEmail` | 建议 | 仅预填收银台邮箱输入框，与 buyerIdentity 相互独立 |
| `orderMerchantExternalId` | ✅（本模板约定） | ≤128 字符业务锚点，本模板传 order_no，webhook 原样回传用于回查 |
| `metadata` | ✅（本模板约定） | `{order_no, user_uuid, credits}`，随 webhook `orderMetadata` 回传 |
| `successUrl` | ✅ | 支付成功跳转（注意：无 cancelUrl 参数，取消在收银台内完成） |
| `expiresInSeconds` | ❌ | 默认 2700 秒（45 分钟），到期 checkout URL 失效 |
| `priceSnapshot` | 禁用 | 会话级改价（API Key 认证可用）——v1 不用，理由见 §四 |
| `includePaymentMethods` / `excludePaymentMethods` | ❌ | 收银台支付方式白/黑名单（可选值 card/applepay/googlepay/wechat，二选一互斥） |
| `darkMode` / `language` | ❌ | 主题覆盖 / 收银台默认语言（BCP 47，用户可切换） |

**三条实施硬规则（官方 + 本项目交叉得出）**：
1. **必须新标签页打开 checkout（`target="_blank"`）**——官方明确提示：Safari ITP 对第三方 Cookie 的限制会让
   当前页跳转导致的成功回调丢会话状态。
2. **`expiresInSeconds` 默认只有 2700 秒（45 分钟）**：本仓支付时效设计（docs/05 §7.1 第九轮 P2-1 修法）
   原假设「渠道 session 窗口 24h」来自 Stripe/Creem；Waffo Pancake 是 45 分钟。因此
   `checkout_expires_at` 若做**必须按渠道分别配置或取各渠道最小值**；也顺手解释了为什么下单后让用户
   悬着再去付款在本渠道更容易超时。
3. **取消页 ≠ 成功页**：cancel_url 与 success_url 相同会被拒绝。

## 六、Webhook 接入

**注册（推荐代码方式，敏感信息不进后台）**：

```typescript
const wh = client.webhooks.add({
  channel: "http",
  url: `${WEB_URL}/api/waffo-notify`,
  verifyRawBody: true,
  events: ["order.completed", "refund.succeeded"],   // v1 白名单，见下表
  testMode: true,                                    // false = 生产通道；test/prod 各注册一条
});
```

小团队也可走 Dashboard → Developer Settings → Webhook Management UI 手工注册。

**接收侧四条铁律**（改造 `app/api/waffo-notify/route.ts` 时落实）：

1. **原始报文验签**：`const raw = await request.text()` 原文交给 SDK `client.webhooks.verify(raw, signature)`。
   不能 JSON.parse 后再验；SDK 内置官方测试/生产公钥，**不需要也不能再自备 PUBLIC_KEY**；
   时间戳防重放默认容忍窗 `toleranceMs=2700000`（45 分钟，d.ts 默认值；设 0 关闭校验）。
   ⚠️ 张力点：官方 Integrations 页的重试间隔（5min/30min/2h/24h）远超 45 分钟，若「迟到重试」复用首次签名
   时间戳将会验签失败——SDK 注释声称该默认值覆盖完整日程、二者口径未完全对齐。实测时观察是否出现
   stale-timestamp 拒收：如有，调大 `toleranceMs` 至 ≥ 重试总时长。
2. **幂等去重靠 `event.id`**：同一事件可能投递多次，按 `(provider='waffo', event.id)` 唯一约束入 inbox
   ——正对应本仓 No-Go 清单的 webhook inbox（payment_events 表）设计。
3. **先快速回 `200 + "OK"`，再做异步落账**：非 2xx 会被判定投递失败触发重试——官方已量化：**最多重试 5 次，间隔递增（5 分钟 / 30 分钟 / 2 小时 / 24 小时）**。
   ⚠️ 上一代的「必须 `{"message":"success"}`、最多重试 8 次」是旧协议，新适配器已按新协议实现。
   ⚠️ ~~事件 payload 的 amount 是整数分~~ **修正（2026-08-27 以 d.ts 核实）**：webhook 里 `amount / taxAmount / total / subtotal`
   全部是**显示金额字符串**（如 `"29.00"`，JPY 风格无小数则 `"1000"`），仅产品侧展示价如此——
   适配器内以 `Math.round(parseFloat(s) × 100)` 换算成整数分后再喂给迁移 0010 精确比对，
   含税总额取 `total ?? amount`（taxIncluded 口径下等于标价 = 本地订单额）。
4. **本地开发用 Cloudflare Tunnel 或 ngrok 转发**（官方点名 localtunnel 会剥离签名所需的请求头导致必失败）。

**事件白名单 → `PaymentEventType` 映射**（v1 只启用前两行；第八轮 P2-2 的落地依据）：

| Pancake 事件 | 语义 | 本模板归一化 | v1 处理 |
|--------------|------|--------------|---------|
| `order.completed` | 支付成功 | `payment_succeeded` | `handle_order_payment` RPC（0010 金额比对 + 0017 联盟奖励） |
| `refund.succeeded` | 退款成功 | `refund_succeeded` | `process_order_refund` RPC（0011 原子扣积分） |
| `refund.failed` | 退款失败 | ❌ 枚举暂无 | 至少 `recordOpEvent("payment.refund_failed", warn)`；枚举扩展挂 No-Go 尾巴 |
| `subscription.activated / payment_succeeded / canceling / uncanceled / updated / canceled / past_due` | 订阅生命周期 | — | v1 不启用（docs/05 §1.6），接入时再白名单 |
| （争议/拒付） | — | — | ⚠️ **Pancake 文档未列出争议事件**——第九轮 P2-2 的「MoR 渠道内置 chargeback 防御」假设要收紧：
  事件可能永远不到达，上线 SOP 里必须有「运营定期巡检 Dashboard 争议页」的人工兜底项 |

安全要点：验签失败的请求返回 400 + `payment.webhook_invalid_signature`（critical 告警，已有发射点）；
价格永不信任事件体里的展示值，一切以本地 `orders.amount` 比对为准（0010 既定设计，保持）。

## 七、沙箱测试

test 环境与生产完全隔离（地址不混淆，SDK 请求带环境指纹）。测试卡任意**未来有效期/CVC**均可：

| 卡号 | 结果 |
|------|------|
| `4576 7500 0000 0110`（Visa） | ✅ 支付成功 |
| `2226 9000 0000 0110`（Mastercard） | ✅ 支付成功 |
| `4576 7500 0000 0220`（Visa） | ❌ declined（用于测失败分支 / refund.failed） |

**最小闭环用例**：
1. 以 §四 流程建一个便宜的 onetime product（如 Starter $9.90，taxIncluded=true）；
2. `pnpm dev` 起本地服务，ngrok/Tunnel 暴露 → 后台/SDK 注册 testMode webhook；
3. 走一遍「下单 → checkout → 测试卡支付」，核对：本地 `orders` 置 paid、credits 有 `order_pay` 流水、
   webhook 命中 `handle_order_payment` 且 metadata.order_no 反查成功、`op_events` 无 mismatch；
4. Dashboard 发起退款 → 核对 `refund.succeeded` 到达、`process_order_refund` 扣积分、订单置 refunded；
5. 故意构造坏签名 curl 打 notify 路由 → 应得 400 + invalid_signature 告警，而不是 500。

## 八、生产切换 Checklist

- [ ] KYB 完成（`403 {"prodEnabled":false}` 消失）
- [ ] 所有要售卖的产品 `.publish()` 到 prod（test 数据不会被带走）
- [ ] prod webhook（testMode:false）注册成功并通过官方探测
- [ ] 税收口径确认：「标价 = 实付」或显式决定 tax 外置并调整金额比对策略
- [ ] `payment_settings` 中 waffo 的 enabled/priority 就位；与 Stripe/Creem 做 failover 演练（health.ts）
- [ ] webhook inbox（payment_events 表）与每日对账可承接 waffo 事件（No-Go 项就绪度评估）
- [ ] 上线 SOP 补充：定期人工巡检 Dashboard 争议页（官方未提供 dispute 事件）
- [ ] 资金告警联动 `op_events` → 飞书/企微（docs/16 链路打通验收）

## 九、迁移决策（✅ 路线 B 已执行）

> ✅ **2026-08-27 执行记录（路线 B）**：
> ① `lib/payment/providers/waffo.ts` 整体重写（pancake-ts，authenticated checkout + orderMerchantExternalId 幂等锚点 +
> 目录原价不传金额）；② `app/api/waffo-notify` 新签名头/"OK" 响应体/显示串→分换算；③ 迁移 `0018_waffo_pancake.sql`
> 加 `waffo_product_id` 与 session 列；④ 凭据收敛为 2 个并移除旧变量与旧依赖；⑤ 能力矩阵更新：
> `refund_api=false`（后台手动指引）、`supported_methods` 收敛 card/wechat_pay（alipay 移出本渠道）；
> ⑥ 注册表测试按新契约更新，`tsc/test/lint` 全绿。**剩余动作只有 §七沙箱用例待真实凭据跑通 + §八上线 checklist。**

官方现行文档已完全不包含现有代码所用的上一代 API，属于「无官方背书运行」。三条路线：

| 路线 | 做法 | 评价 |
|------|------|------|
| **B（推荐）** | 适配器整体替换为 `@waffo/pancake-ts`：`createCheckout` 改走 checkout.createSession、notify 改验 `x-waffo-signature` + `event.id` 幂等、事件名重映射；产品预建 + publish，`payment_products.waffo_product_id` 加列 | 改动集中在一个 provider + 一个 route + 环境变量收缩为 2 个；顺带把 45 分钟 session、税收口径两处设计修正落掉 |
| A（保守并行） | 新旧两个 provider 并存 + payment_settings 切流 | 双倍维护面，且旧通道本身就是风险源，不建议长期 |
| C（观望） | 不动代码，仅按本文 §二~§四把账号/密钥备好，先用 Stripe/Creem 收款 | 最省事，但等于放弃渠道冗余；官方一旦停服旧 API 就是被动救火 |

无论选哪条，§四 的「原价建品 + 税收口径」与 §五 的「45 分钟 session」两条都是**与渠道无关的资金正确性问题**，即使暂不写代码也应记入 docs/05 的已知边界。

## 十、遗留不确定项（诚实声明）

- ~~上一代 API 是否仍在服务端继续受理~~ 对本仓已不构成风险：旧 SDK 已卸载，代码不再发出旧代调用；
  官方是否仍受理与本模板无关；
- ~~`WAFFO_API_KEY` / `WAFFO_PUBLIC_KEY` 彻底废弃还是兼容~~ 已解决（d.ts 全文零引用）：判定彻底废弃，
  代码与 `.env.example` 均已移除，仅在本表留档；
- ~~webhook 失败后的重试节奏~~ 已解决：最多 5 次，间隔 5min/30min/2h/24h；响应体 `"OK"` + 401 无效签名，均出自官方 Integrations 页；
  **新增未决**：重试总时长与默认防重放容忍窗（45 分钟）的口径张力见 §六铁律 1——沙箱实测时确认迟到重试是否验签失败；
- GraphQL 端点的鉴权方式（同一 Private Key 签名还是另发令牌）：API 参考各分页待逐一核对后补入本文。

## 十一、参考链接

- 产品介绍：https://docs.waffo.ai/zh
- 集成指南（Skill 版全文）：https://docs.waffo.ai/zh/integrate/skill
- API 参考：https://docs.waffo.ai/zh/api-reference/introduction
- LLM 友好索引：https://docs.waffo.ai/llms.txt 、https://docs.waffo.ai/llms-full.txt
- TypeScript SDK：https://www.npmjs.com/package/@waffo/pancake-ts
- 商户后台：https://pancake.waffo.ai/merchant/auth/signin
