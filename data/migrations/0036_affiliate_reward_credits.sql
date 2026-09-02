-- 第三十六批（2026-09-01）：联盟奖励发放闭环（方案 A：自动转积分，docs/05 §3.4 拍板）
--
-- 问题：订单支付时 handle_order_payment 只往 affiliates 写一条 completed 记录
-- （reward_amount = min(amount*20%, max_reward)），邀请人拿不到任何实际奖励——
-- 「记录完成、发放缺失」的半成品。冲销半边已由 0028 闭合（退款/拒付置 reversed），
-- 但冲销只翻状态不扣回已发积分，方案 A 落地后会成为新的套利口子（发分 → 退款 → 保留分）。
--
-- 本迁移一次闭合两侧：
--   1) 发放：handle_order_payment 内 affiliates INSERT ... RETURNING reward_amount，
--      插入成功（无冲突、状态非 completed 占位）才发放奖励积分，与佣金记录同事务原子；
--      webhook 重试时 affiliates 幂等检查不通过 → 不再插入 → 不重复发放。
--      奖励积分 = LEAST(订单积分 * reward_percent / 100, max_reward / 100)：
--        - 与佣金金额同比例同上限（$50 上限 ÷ $1≈1 积分定价 ≈ 50 积分）；
--        - expired_at = NULL（永久有效）：奖励是平台信用而非付费商品，与 system_add 口径一致，
--          不随订单积分的有效期过期；
--        - 批次账本同步建批次（lot-<trans_no>，source_type='affiliate_reward'），
--          冲销侧按批次精确扣回。
--   2) 冲销：reverse_affiliate_reward 从「只翻状态」升级为「翻状态 + 批次精确扣回 +
--      credits 负流水」——与 process_order_refund 同款 FOR UPDATE 循环；
--      返回值语义从「冲销佣金金额（分）」扩展为「冲销佣金金额（分）」不变
--      （扣回积分量进 credits 负流水与调用方审计 detail，签名与既有调用方零改动）。
--
-- 幂等：CREATE OR REPLACE + INSERT ... ON CONFLICT DO NOTHING + NOT EXISTS 防重。
-- 权限：与 0026/0028 同规，private schema 函数 + REVOKE + 仅授 service_role。

-- ============ 1. private.handle_order_payment（0034 版 + 奖励发放）============

CREATE OR REPLACE FUNCTION private.handle_order_payment(
  p_order_no TEXT,
  p_paid_at timestamptz,
  p_paid_email TEXT,
  p_paid_detail TEXT,
  -- 默认值与 0023 保持一致：CREATE OR REPLACE 不允许移除既有参数默认值
  p_amount_cents INT DEFAULT NULL,
  p_currency TEXT DEFAULT NULL,
  p_reward_percent INT DEFAULT 20,
  p_max_reward INT DEFAULT 5000
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_invited_by TEXT := '';
  v_recovered BOOLEAN := false;
  v_expired_at timestamptz;
  v_reward_amount INT := 0;
  v_reward_credits INT := 0;
  v_reward_trans_no TEXT;
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

  -- 充值积分 + 建批次（同一 trans_no，幂等：同 order_no 只充一次）
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
        -- RETURNING 拿到本次真实插入的 reward_amount（冲突 DO NOTHING 时无返回行）
        INSERT INTO affiliates (user_uuid, invited_by, created_at, status, paid_order_no,
                                paid_amount, reward_percent, reward_amount)
        VALUES (v_order.user_uuid, v_invited_by, now(), 'completed', v_order.order_no,
                v_order.amount, p_reward_percent,
                LEAST(v_order.amount * p_reward_percent / 100, p_max_reward))
        ON CONFLICT (user_uuid) WHERE status = 'completed' DO NOTHING
        RETURNING reward_amount INTO v_reward_amount;

        -- 方案 A：奖励自动转积分（与佣金记录同事务原子，webhook 重试幂等）
        -- 折算：订单积分 × 佣金比例，上限 = max_reward 分 ÷ 100 分/积分（$50 → 50 积分）；
        -- 永久有效（NULL，与 system_add 口径一致，不随订单积分有效期过期）。
        IF v_reward_amount IS NOT NULL AND v_reward_amount > 0 AND v_order.credits > 0 THEN
          v_reward_credits := LEAST(
            (v_order.credits * p_reward_percent) / 100,
            p_max_reward / 100
          );
          IF v_reward_credits > 0 THEN
            v_reward_trans_no := gen_random_uuid()::text;
            INSERT INTO credits (trans_no, created_at, user_uuid, trans_type, credits, order_no, expired_at)
            VALUES (v_reward_trans_no, now(), v_invited_by, 'affiliate_reward',
                    v_reward_credits, v_order.order_no, NULL);
            -- 批次账本同步建批次（冲销按此精确扣回）
            INSERT INTO credit_lots (lot_no, user_uuid, source_type, source_ref, total_credits, remaining_credits, expired_at)
            VALUES ('lot-' || v_reward_trans_no, v_invited_by, 'affiliate_reward', v_order.order_no,
                    v_reward_credits, v_reward_credits, NULL)
            ON CONFLICT (lot_no) DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN 'paid';
END;
$$;

-- ============ 2. reverse_affiliate_reward：翻状态 + 批次精确扣回 ============
-- 0028 版只翻状态（当时尚无积分发放）；方案 A 后冲销必须扣回已发积分，
-- 否则「发分 → 退款/拒付 → 保留分」成为新套利口子。
-- 与 process_order_refund 同款：批次 FOR UPDATE 循环扣至 refunded/exhausted，
-- credits 负流水照旧写（展示层/统计不变）。签名不变（调用方零改动）。

CREATE OR REPLACE FUNCTION private.reverse_affiliate_reward(
  p_order_no TEXT,
  p_reason TEXT DEFAULT ''
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions
AS $$
DECLARE
  v_reward INT;
  v_inviter TEXT;
  v_remaining INT := 0;
  v_deducted INT := 0;
  v_lot RECORD;
  v_take INT;
BEGIN
  -- 行锁防并发双冲销；completed 才可冲销（幂等：reversed 再次调用返回 0）
  SELECT reward_amount, invited_by INTO v_reward, v_inviter
  FROM affiliates
  WHERE paid_order_no = p_order_no AND status = 'completed'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  UPDATE affiliates
  SET status = 'reversed'
  WHERE paid_order_no = p_order_no AND status = 'completed';

  -- 扣回该订单发给邀请人的奖励批次（含过期批次——过期只是不可消费，
  -- 不改变「奖励随该订单冲销而失效」的事实，与 0026 退款防过期套利同口径）
  SELECT COALESCE(SUM(remaining_credits), 0) INTO v_remaining
  FROM credit_lots
  WHERE user_uuid = v_inviter
    AND source_type = 'affiliate_reward'
    AND source_ref = p_order_no
    AND status = 'active';

  IF v_remaining > 0 THEN
    PERFORM pg_advisory_xact_lock(736925141, hashtext(v_inviter));

    FOR v_lot IN
      SELECT id, remaining_credits FROM credit_lots
      WHERE user_uuid = v_inviter
        AND source_type = 'affiliate_reward'
        AND source_ref = p_order_no
        AND status = 'active'
        AND remaining_credits > 0
      ORDER BY id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_lot.remaining_credits, v_remaining);
      UPDATE credit_lots
        SET remaining_credits = remaining_credits - v_take,
            status = CASE WHEN remaining_credits - v_take <= 0 THEN 'refunded' ELSE 'active' END,
            updated_at = now()
        WHERE id = v_lot.id AND remaining_credits >= v_take;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'concurrent lot modification: %', v_lot.id;
      END IF;
      v_deducted := v_deducted + v_take;
      v_remaining := v_remaining - v_take;
    END LOOP;

    -- credits 负流水照旧写（展示层/统计不变；trans_type 与发放对称）
    INSERT INTO credits (trans_no, created_at, user_uuid, trans_type, credits, order_no, expired_at)
    VALUES (gen_random_uuid()::text, now(), v_inviter, 'affiliate_reward',
            -v_deducted, p_order_no, NULL);
  END IF;

  -- 冲销原因进 paid_order_no 不合适；affiliates 无 remark 列，原因只进调用方审计
  -- （admin.order.refund / payment.dispute_lost / payment.refund_processed detail）。
  IF COALESCE(p_reason, '') <> '' THEN
    -- no-op：保留参数以便调用方语义对齐 settle_credit_debt 的签名习惯
    NULL;
  END IF;

  RETURN COALESCE(v_reward, 0);
END $$;

-- 权限：与 0026/0028 同规
REVOKE ALL ON FUNCTION private.handle_order_payment(TEXT, timestamptz, TEXT, TEXT, INT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.handle_order_payment(TEXT, timestamptz, TEXT, TEXT, INT, TEXT, INT, INT) TO service_role;
REVOKE ALL ON FUNCTION private.reverse_affiliate_reward(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.reverse_affiliate_reward(TEXT, TEXT) TO service_role;
