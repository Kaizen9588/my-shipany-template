-- P2（handoff §4）：orders.expired_at 从支付时刻计算，而不是下单时刻冻结
--
-- 问题：checkout 在下单时把 expired_at = now() + valid_months 冻结进订单行，
-- handle_order_payment 充值积分时直接复制 orders.expired_at。用户下单后隔天
-- （甚至逾期订单被迟到回调恢复）才支付，积分有效期被白白吃掉间隔天数。
--
-- 修法：支付落账时以 p_paid_at 为基准重算：
--   v_expired_at := COALESCE(v_order.valid_months, 0) > 0
--     ? p_paid_at + make_interval(months => v_order.valid_months)
--     : v_order.expired_at（保留 NULL = 永不过期 或历史值）
-- 同时把重算值写回 orders.expired_at，订单行与积分行口径一致（admin 订单页可见）。
--
-- 只改 private 权威版（0023）函数体；public 残留副本直接 DROP（收紧 N-2 暴露面）。
-- CREATE OR REPLACE 幂等，可安全重放；迁移器按版本号跳过已应用版本时，
-- 本文件仍需 psql -f 手动重放一次（函数体修复不改变 schema_migrations 语义）。

-- ============ 1. public.handle_order_payment（早期版退役） ============
-- 0013/0017 曾把 handle_order_payment 建在 public（Data API 可见），0023 引入
-- private 权威版后 public 残留成为僵尸入口。本迁移顺带 DROP 收紧 N-2 暴露面；
-- 运行时唯一调用点 serverClient().schema("private").rpc("handle_order_payment")。
DROP FUNCTION IF EXISTS public.handle_order_payment(
  p_order_no TEXT, p_paid_at timestamptz, p_paid_email TEXT, p_paid_detail TEXT,
  p_reward_percent INT, p_max_reward INT
);

-- ============ 2. private.handle_order_payment（0023 权威版同步） ============
CREATE OR REPLACE FUNCTION private.handle_order_payment(
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
SET search_path = private, public, extensions
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_invited_by TEXT := '';
  v_recovered BOOLEAN := false;
  v_expired_at timestamptz;
BEGIN
  SELECT * INTO v_order FROM orders WHERE order_no = p_order_no FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_no;
  END IF;

  IF v_order.status = 'paid' THEN
    RETURN v_order.status;
  END IF;

  IF v_order.status = 'expired' THEN
    v_recovered := true;
  ELSIF v_order.status <> 'created' THEN
    RAISE EXCEPTION 'invalid order status: %', v_order.status;
  END IF;

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

  -- P2：积分有效期以支付时刻为基准重算（迟到支付/expired 恢复不再被吃掉间隔天数）
  v_expired_at := CASE
    WHEN COALESCE(v_order.valid_months, 0) > 0
      THEN p_paid_at + make_interval(months => v_order.valid_months)
    ELSE v_order.expired_at
  END;

  UPDATE orders
  SET status = 'paid',
      paid_at = p_paid_at,
      paid_email = p_paid_email,
      paid_detail = p_paid_detail,
      expired_at = v_expired_at,
      order_detail = CASE
        WHEN v_recovered THEN json_build_object(
          'recovered_from_expired', true,
          'recovered_at', now()
        )::text
        ELSE order_detail
      END
  WHERE order_no = p_order_no;

  IF v_order.credits > 0 AND v_order.user_uuid <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM credits WHERE order_no = v_order.order_no) THEN
      INSERT INTO credits (trans_no, created_at, user_uuid, trans_type, credits, order_no, expired_at)
      VALUES (gen_random_uuid()::text, now(), v_order.user_uuid, 'order_pay',
              v_order.credits, v_order.order_no, v_expired_at);
    END IF;
  END IF;

  IF v_order.user_uuid <> '' THEN
    SELECT invited_by INTO v_invited_by
    FROM users WHERE uuid = v_order.user_uuid;

    IF v_invited_by IS NOT NULL AND v_invited_by <> '' AND v_invited_by <> v_order.user_uuid THEN
      IF NOT EXISTS (SELECT 1 FROM affiliates WHERE paid_order_no = v_order.order_no)
         AND NOT EXISTS (SELECT 1 FROM affiliates
                         WHERE user_uuid = v_order.user_uuid AND status = 'completed') THEN
        INSERT INTO affiliates (user_uuid, invited_by, created_at, status, paid_order_no,
                                paid_amount, reward_percent, reward_amount)
        VALUES (v_order.user_uuid, v_invited_by, now(), 'completed', v_order.order_no,
                v_order.amount, p_reward_percent,
                LEAST(v_order.amount * p_reward_percent / 100, p_max_reward))
        ON CONFLICT (user_uuid) WHERE status = 'completed' DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN 'paid';
END;
$$;
