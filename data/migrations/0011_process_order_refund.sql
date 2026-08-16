-- R3 资金安全：process_order_refund 存储过程（2026-08 架构审查）
--
-- 修复退款并发双扣积分竞态：
-- 此前 services/refund.ts 先读 status='paid' 检查、扣积分、再 update status='refunded'，
-- update 无 status CAS 条件。processRefund 有两个天然并发的调用方
-- （admin 退款 API 与渠道退款 webhook），两者同时读到 'paid' 会各自扣一次积分。
--
-- 本函数把「状态检查 + 扣积分 + 标记 refunded」放进单事务：
-- - 订单行 FOR UPDATE 串行化（与 handle_order_payment 相同锁序：orders → credits）
-- - 已 refunded 直接返回 0（幂等，双调用方重试安全）
-- - 扣减口径不变：min(订单积分, 当前有效余额)，余额不足扣 0 但仍标记 refunded
--   （近似口径，docs/12 §三.2）
-- - 负数扣减记录 expired_at = NULL（与 decrease_credits 语义一致）

CREATE OR REPLACE FUNCTION process_order_refund(
  p_order_no TEXT,
  p_refund_note TEXT DEFAULT ''
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_balance INT := 0;
  v_deduct INT := 0;
BEGIN
  SELECT * INTO v_order FROM orders WHERE order_no = p_order_no FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_no;
  END IF;

  -- 幂等：已 refunded 直接返回（webhook 重试 / admin 重试安全）
  IF v_order.status = 'refunded' THEN
    RETURN 0;
  END IF;

  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'order is not paid: %', v_order.status;
  END IF;

  -- 锁定该用户积分行（与 decrease_credits 互补，锁序 orders → credits 防死锁）
  PERFORM id FROM credits WHERE user_uuid = v_order.user_uuid FOR UPDATE;

  SELECT COALESCE(SUM(credits), 0) INTO v_balance
  FROM credits
  WHERE user_uuid = v_order.user_uuid
    AND (
      (credits > 0 AND (expired_at IS NULL OR expired_at >= now()))
      OR credits <= 0
    );

  v_deduct := LEAST(COALESCE(v_order.credits, 0), GREATEST(v_balance, 0));

  IF v_deduct > 0 THEN
    INSERT INTO credits (trans_no, created_at, user_uuid, trans_type, credits, order_no, expired_at)
    VALUES (gen_random_uuid()::text, now(), v_order.user_uuid, 'order_refund',
            -v_deduct, v_order.order_no, NULL);
  END IF;

  UPDATE orders
  SET status = 'refunded',
      order_detail = CASE
        WHEN p_refund_note IS NULL OR p_refund_note = '' THEN v_order.order_detail
        ELSE p_refund_note
      END
  WHERE order_no = p_order_no;

  RETURN v_deduct;
END;
$$;
