# 支付渠道切换 SOP（Runbook）

> 版本：v1（2026-08-27 成文）
> 依据：[provider-abstraction.md §十](./provider-abstraction.md) 的无缝切换评估；
> 本 SOP 是「后台点按钮换渠道」的操作手册，覆盖计划内切换、紧急降级与回滚。
> **前提**：本模板三渠道（Stripe / Creem / Waffo-Pancake）适配器均已并入，
> 渠道启停由 `payment_settings` 表热切换，前端只见支付方式不见渠道名。

---

## 一、适用场景

| 场景 | 触发 | 走哪节 |
|------|------|--------|
| 计划内切换 | 主渠道 → 备用/更优渠道（如降成本切 Stripe） | §三 |
| 紧急切换 | 某渠道被风控限流/停用/持续失败 | §四 |
| 回滚 | 切换后新渠道异常，切回原渠道 | §五 |

不变的铁律：**只对「新订单」生效**。`orders.payment_provider` 下单即冻结，
切换瞬间之前创建的订单永远归属原渠道，其 webhook、退款、查询都走原渠道端点。

## 二、SOP-0 常备就绪项（每个渠道入驻时一次做完，不是切换当天做）

备用渠道的价值 = 平时就绪度。以下任一项缺失，紧急切换就是空谈：

- [ ] 渠道账号 KYB 通过、凭据齐全且已注入生产环境变量
      （Waffo：`WAFFO_MERCHANT_ID` + `WAFFO_PRIVATE_KEY[_BASE64]`，见 [waffo-operations-guide §三](./waffo-operations-guide.md)）
- [ ] 生产环境每个售卖产品已完成渠道侧建品并回填映射：
      Creem → `payment_products.creem_product_id`；Waffo(Pancake) → `waffo_product_id`（需 `.publish()`）
      Stripe 动态金额无需预建。后台入口：`/admin/pricing`
- [ ] 生产 webhook 端点在渠道侧注册并通过探测：
      `/api/stripe-notify` · `/api/creem-notify` · `/api/waffo-notify`（Pancake 需 testMode:false 一条 + 可选 test 一条）
- [ ] `payment_settings` 有该渠道的行（enabled 可为 false，行必须存在才能被后台开关）
- [ ] 沙箱最小闭环跑通并存档记录（下单 → 支付 → 订单 paid + 积分到账 + 无 mismatch 告警；
      Waffo 用例见 [waffo-operations-guide §七](./waffo-operations-guide.md)）
- [ ] 渠道能力差异已知悉：**Creem 与 Waffo(Pancake) 无商户退款 API**——若其为当时主渠道，
      退款流程是「渠道 Dashboard 手动操作 + refund webhook 同步扣回积分」；Stripe 才有一键 API 退款

## 三、计划内切换流程

> 例：日常以 Waffo 收款（priority 最小者），美国公司下来后切 Stripe。

1. **目标渠道验收**：核对 §二 就绪项全绿；用真实支付方式在生产做一笔最小金额实付冒烟
   （选最低价 SKU），确认订单 paid、积分到账、`op_events` 无 `payment.amount_mismatch`、成功邮件/通知到达。
2. **选择窗口**：避开营销/大促时段；切换本身秒级生效，但建议在工作日上午执行便于观察一天。
3. **执行切换**（后台 `/admin/payment`，或 SQL 等价操作）：

   ```sql
   -- 把目标渠道设为唯一启用，其余全部停用（推荐：同时只有一个 enabled=true，语义最清晰）
   UPDATE payment_settings SET enabled = false, updated_at = now() WHERE provider <> 'stripe';
   UPDATE payment_settings SET enabled = true,  updated_at = now() WHERE provider = 'stripe';
   ```

   灰度说明（如实声明）：当前路由逻辑是「优先级最小的启用渠道独占承接」，**没有比例分流能力**；
   想"试运行"就用时间窗灰度——高峰前不切、低峰切，观察 24-48h 再决定去留。

4. **切换后 5 分钟验证清单**：
   - [ ] `GET /api/payment-methods` 返回与预期一致（方式集合 = 新渠道 supported_methods 的聚合；
         例如只剩 Stripe 时 alipay 应仍可用，只剩 Waffo 时 alipay 应消失）
   - [ ] 新下一笔测试单：`orders.payment_provider` = 目标渠道；收银页域名/品牌正常
   - [ ] webhook 到达且落账正确（金额比对通过）
   - [ ] 告警通道安静：无 `payment.amount_mismatch` / `payment.webhook_invalid_signature`

5. **旧渠道处置**：
   - enabled=false 即可，**绝不注销账号、绝不删 webhook 端点**
   - 在途订单（已创建未支付 ≤ 各渠道 session 时效）：完成支付仍走旧渠道 webhook 落账 —— 三端点并存因此必要
   - 观察期 ≥ 7 天：期间旧渠道仍可能来支付/退款事件；**保持其 webhook 存活直至余额提现结算完毕**
   - 若它是 MoR 渠道（Creem/Waffo），未提现余额记得人工发起提现

## 四、紧急切换（某渠道暴雷）

1. 多数情况**不用动手**：health.ts 连续 5 次失败/10 分钟会把渠道标记 unhealthy 摘除 30 分钟，
   流量自动落到下一优先级渠道；critical 告警会推给管理员。
2. 需要人工介入时（连续摘除反复发生 / 渠道公告停服 / 账号被封）：
   后台把故障渠道 enabled=false（同 §三第 3 步），其他步骤相同。
3. 追加动作：封禁型事件发 `op_events` 工单留档；检查该渠道是否存在未结算余额与未完结退款/争议，
   列入人工跟踪直至清零。

## 五、回滚

- 操作上等于再做一次 §三（方向相反）；任何时刻只保留一个 enabled=true 语义最不易错。
- 回滚不影响已在新渠道创建的订单：它们继续走新渠道 webhook 与退款路径。
- 回滚常见原因清单（供复盘）：amount_mismatch 连发（税费口径没同步改！见 §六）、webhook 验签批量失败、
  收银页支付方式与销售地区不符。

## 六、税费口径特别检查（MoR ↔ PSP 切换必做）

MoR（Creem / Waffo-Pancake）是**价内税**：标价即用户实付；Stripe 是 PSP 价外税：
多数地区实付 = 标价 + 税。迁移 0010 的金额精确比对按本地 `orders.amount` 校验——
口径不改就稳定 mismatch 不充值（fail-safe 方向正确，但业务中断）。

切换涉及此维度时必须同步：

- [ ] 定价页文案（"$9.99 含税" vs "$9.99 + tax"）
- [ ] 结账参数与产品目录价格的含税配置（Waffo 建品 taxIncluded 口径）
- [ ] 抽一笔真实卡支付验证比对通过后才算完成切换

## 七、切换台账（每次切换追加一行）

| 日期 | 方向（A→B） | 原因 | 执行人 | 验证结果 | 观察 48h 结论 | 台账附注 |
|------|------------|------|--------|----------|--------------|----------|
| | | | | | | |
