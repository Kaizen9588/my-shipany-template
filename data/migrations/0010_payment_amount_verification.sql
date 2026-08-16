-- R1 资金安全：Webhook 支付金额/币种比对（2026-08 架构审查）
--
-- 修复「全链路零金额校验」：
-- 此前 handle_order_payment 只收 order_no，渠道实付金额从不与本地订单比对。
-- 对 Creem（价格由渠道侧预建产品决定）而言，本地调价后渠道未同步即发生
-- 「低价付款、足额充值」，系统零检测；Stripe 促销码造成的实付差额同样无感知。
--
-- 本版本：
-- 1. 新增 p_amount_cents / p_currency 参数（适配器从渠道 webhook 原始事件提取）
-- 2. 金额或币种与本地订单不一致 → 订单置 status='mismatch'（不充值、不发联盟奖励、
--    不抛错——抛错会引发渠道无限重试且重试不可能修复），写明 expected/received，
--    返回 'mismatch' 由应用层告警，人工核查后可改回 'created' 重新处理
-- 3. 'mismatch' 状态不会被 expire 订单的定时任务触碰（该任务只扫 status='created'）
--
-- 关联决策：Stripe allow_promotion_codes 已同步禁用（打折后实付 < 订单额，
-- 与「精确金额比对」互斥；优惠码待订单模型支持折扣金额后再恢复）。

CREATE OR REPLACE FUNCTION handle_order_payment(
  p_order_no TEXT,
  p_paid_at timestamptz,
  p_paid_email TEXT,
  p_paid_detail TEXT,
  p_amount_cents INT DEFAULT NULL,
  p_currency TEXT DEFAULT NULL,
  p_reward_percent INT DEFAULT 20,
  p_max_reward INT DEFAULT 5000
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_invited_by TEXT := '';
BEGIN
  -- 锁定订单行，串行化同一订单的并发回调
  SELECT * INTO v_order FROM orders WHERE order_no = p_order_no FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_no;
  END IF;

  -- 幂等：已 paid 直接返回，不重复处理
  IF v_order.status = 'paid' THEN
    RETURN v_order.status;
  END IF;

  IF v_order.status <> 'created' THEN
    RAISE EXCEPTION 'invalid order status: %', v_order.status;
  END IF;

  -- 金额/币种比对（渠道实付 vs 本地订单，精确匹配）
  IF (p_amount_cents IS NOT NULL AND p_amount_cents <> v_order.amount)
     OR (p_currency IS NOT NULL AND p_currency <> ''
         AND LOWER(p_currency) <> LOWER(v_order.currency)) THEN
    UPDATE orders
    SET status = 'mismatch',
        order_detail = json_build_object(
          'mismatch', true,
          'expected_cents', v_order.amount,
          'received_cents', p_amount_cents,
          'expected_currency', v_order.currency,
          'received_currency', p_currency,
          'at', now()
        )::text
    WHERE order_no = p_order_no;
    RETURN 'mismatch';
  END IF;

  -- 1. 更新订单为 paid
  UPDATE orders
  SET status = 'paid',
      paid_at = p_paid_at,
      paid_email = p_paid_email,
      paid_detail = p_paid_detail
  WHERE order_no = p_order_no;

  -- 2. 充值积分（幂等：同 order_no 只充一次）
  IF v_order.credits > 0 AND v_order.user_uuid <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM credits WHERE order_no = v_order.order_no) THEN
      INSERT INTO credits (trans_no, created_at, user_uuid, trans_type, credits, order_no, expired_at)
      VALUES (gen_random_uuid()::text, now(), v_order.user_uuid, 'order_pay',
              v_order.credits, v_order.order_no, v_order.expired_at);
    END IF;
  END IF;

  -- 3. 记录联盟奖励（幂等：同 paid_order_no 只记一次）
  IF v_order.user_uuid <> '' THEN
    SELECT invited_by INTO v_invited_by
    FROM users WHERE uuid = v_order.user_uuid;

    IF v_invited_by IS NOT NULL AND v_invited_by <> '' AND v_invited_by <> v_order.user_uuid THEN
      IF NOT EXISTS (SELECT 1 FROM affiliates WHERE paid_order_no = v_order.order_no) THEN
        INSERT INTO affiliates (user_uuid, invited_by, created_at, status, paid_order_no,
                                paid_amount, reward_percent, reward_amount)
        VALUES (v_order.user_uuid, v_invited_by, now(), 'completed', v_order.order_no,
                v_order.amount, p_reward_percent,
                LEAST(v_order.amount * p_reward_percent / 100, p_max_reward));
      END IF;
    END IF;
  END IF;

  RETURN v_order.status;
END;
$$;
