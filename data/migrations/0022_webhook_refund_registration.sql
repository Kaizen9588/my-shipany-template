-- P0-1 剩余：webhook 退款只登记中间态，终态由人工/回收流程闭合（2026-08-30）
--
-- 此前 refund_succeeded webhook 直接调 process_order_refund 终态化（refunded），
-- webhook 一到就无条件终态化，没有需要人工决策的中间态（docs/05 §4.3 P0-1）。
-- 本迁移把「登记」与「回收」拆开：
-- - webhook（渠道已退钱，事实不可逆）→ register_order_refund_request：
--   记 refunds 退款单 + 订单置 refund_requested（中间态）。**登记阶段不做债务化**：
--   尚未尝试回收，无法判定缺口；若在登记时按 0 扣回计全额欠款，会把「余额足以
--   全额扣回」的诚实场景也打成 refund_blocked + restricted，且 process_order_refund
--   不接受 refund_blocked，订单将永远无法闭合终态（第八批审查修复）。
--   债务化/准入校验由闭合方 processRefund（debt_regulate_order_refund）按实际扣回量执行。
-- - 后台管理员退款（Stripe 有退款 API）→ 保持 processRefund 直接回收 + 终态，
--   因管理员已知晓并决策了这笔退款；process_order_refund 扩展接受 refund_requested
--   状态（webhook 先登记、管理员随后在后台闭合终态的顺序也成立）。
--
-- 依赖 0021（credit_debts / refunds / debt_regulate_order_refund / 状态扩展）。

-- 幂等登记退款请求：refunds 退款单（provider_refund_id 或 order_no 幂等）+
-- 订单置 refund_requested + 债务化准入。返回登记的退款单 refund_no（已登记则返回已有单号）。
CREATE OR REPLACE FUNCTION register_order_refund_request(
  p_order_no TEXT,
  p_user_uuid TEXT,
  p_provider TEXT,
  p_provider_refund_id TEXT DEFAULT '',
  p_amount_cents INT DEFAULT 0,
  p_currency TEXT DEFAULT 'USD',
  p_reason TEXT DEFAULT '',
  p_initiated_by TEXT DEFAULT 'customer'
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_existing TEXT;
  v_refund_no TEXT;
BEGIN
  SELECT * INTO v_order FROM orders WHERE order_no = p_order_no FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_no;
  END IF;

  -- 幂等：同一渠道退款 ID 或同订单 pending/已登记请求直接返回（webhook 重试安全）
  IF COALESCE(p_provider_refund_id, '') <> '' THEN
    SELECT refund_no INTO v_existing FROM refunds
      WHERE provider = p_provider AND provider_refund_id = p_provider_refund_id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;
  SELECT refund_no INTO v_existing FROM refunds
    WHERE order_no = p_order_no AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- 已终态（refunded / refund_blocked / charged_back）：登记退款单但不再动订单状态
  IF v_order.status IN ('refunded', 'refund_blocked', 'charged_back') THEN
    v_refund_no := 'ref-' || gen_random_uuid()::text;
    INSERT INTO refunds (refund_no, order_no, user_uuid, provider, provider_refund_id,
                         amount_cents, currency, status, reason, initiated_by)
    VALUES (v_refund_no, p_order_no, p_user_uuid, p_provider, p_provider_refund_id,
            p_amount_cents, p_currency, 'succeeded', p_reason, p_initiated_by);
    RETURN v_refund_no;
  END IF;

  -- 中间态登记：退款单 + 订单 refund_requested
  v_refund_no := 'ref-' || gen_random_uuid()::text;
  INSERT INTO refunds (refund_no, order_no, user_uuid, provider, provider_refund_id,
                       amount_cents, currency, status, reason, initiated_by)
  VALUES (v_refund_no, p_order_no, p_user_uuid, p_provider, p_provider_refund_id,
          p_amount_cents, p_currency, 'pending', p_reason, p_initiated_by);

  IF v_order.status NOT IN ('refund_requested', 'disputed') THEN
    UPDATE orders SET status = 'refund_requested' WHERE order_no = p_order_no;
  END IF;

  -- 注意：登记阶段不做债务化（debt_regulate_order_refund）——尚未回收，无法判定缺口；
  -- 由闭合方 processRefund 按实际扣回量触发（见迁移头注释）。

  RETURN v_refund_no;
END;
$$;

-- process_order_refund 接受 refund_requested（webhook 先登记、后台/回收流程随后闭合）：
-- 其余状态契约不变。
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

  IF v_order.status NOT IN ('paid', 'refund_requested') THEN
    RAISE EXCEPTION 'order is not refundable: %', v_order.status;
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

  -- 回收完成：未登记退款单的（admin 直退）保持 refunded；已登记的同步退款单状态
  UPDATE orders
  SET status = 'refunded',
      order_detail = CASE
        WHEN p_refund_note IS NULL OR p_refund_note = '' THEN v_order.order_detail
        ELSE p_refund_note
      END
  WHERE order_no = p_order_no;

  UPDATE refunds SET status = 'succeeded', updated_at = now()
    WHERE order_no = p_order_no AND status = 'pending';

  RETURN v_deduct;
END;
$$;
