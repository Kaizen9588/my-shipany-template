-- P-1.3 支付处理事务化：handle_order_payment 存储过程
--
-- 将 Webhook 处理的「更新订单 + 充值积分 + 记录联盟」三步包在一个事务中，
-- 任一步失败整体回滚，避免数据不一致。
--
-- 额外修复：
-- 1. 幂等：订单已为 paid 直接返回，不覆盖 paid_at/paid_detail（Stripe Webhook 重试安全）
-- 2. 积分充值幂等：同 order_no 已充值过则跳过
-- 3. 联盟奖励幂等：同 paid_order_no 已记录则跳过
-- 4. 联盟奖励金额按比例计算：reward_amount = min(amount * reward_percent / 100, max_reward)
--    （修复原固定 $50 的错误逻辑，P-1.8 问题 4）

CREATE OR REPLACE FUNCTION handle_order_payment(
  p_order_no TEXT,
  p_paid_at timestamptz,
  p_paid_email TEXT,
  p_paid_detail TEXT,
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
