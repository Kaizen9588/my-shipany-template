-- H1 + M1：迟付恢复 + 联盟奖励收敛为首次付费（2026-08 方案文档对抗式审查）
--
-- H1「迟付撞上 expired 订单」：
-- expire-orders 定时任务会把 60 分钟未支付的订单置为 expired，但用户可能
-- 已打开收银台稍后付款、或渠道 webhook 延迟投递。此前 0010 对非 created 状态
-- 一律 RAISE EXCEPTION → 500 → 渠道无限重试但永不落账（钱收了、积分不发），
-- 且无人工恢复路径。本版本允许 expired 订单被迟到的支付回调恢复为 paid，
-- 并在 order_detail 记录恢复事实供审计。
--
-- M1「联盟奖励按每笔订单发放」：
-- docs/05 §3.1/§3.2 与 docs/03 均声明「被邀请人首次付费 → completed」，
-- 但 0010 的幂等条件仅按 paid_order_no 去重，被邀请人后续每笔付费都新增奖励行
-- （方向为多发）。本版本收敛为每个被邀请人仅首笔付费产生奖励（与文档口径一致）。
--
-- 复审 2 加固：两个 NOT EXISTS 在同一用户两张订单同时支付时仍存在并发窗口
-- （各自锁定不同订单行），补上「每 user_uuid 仅一条 completed」的部分唯一索引
-- 作数据库级兑底。建索引前先收敛历史重复（保留每用户最早一条）。

-- 收敛历史重复奖励（保留每用户最早一条 completed）
DELETE FROM affiliates a
USING affiliates b
WHERE a.user_uuid = b.user_uuid
  AND a.status = 'completed'
  AND b.status = 'completed'
  AND a.id > b.id;

-- 部分唯一索引：数据库级兑底，防止首付奖励并发双发
CREATE UNIQUE INDEX IF NOT EXISTS affiliates_single_completed_per_user
  ON affiliates (user_uuid)
  WHERE status = 'completed';

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
  v_recovered BOOLEAN := false;
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

  -- expired 订单允许被迟到的支付回调恢复（钱已实际收到，必须落账）；
  -- mismatch 等其他状态仍需人工核查，不自动处理
  IF v_order.status = 'expired' THEN
    v_recovered := true;
  ELSIF v_order.status <> 'created' THEN
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

  -- 1. 更新订单为 paid（expired 恢复时在 order_detail 留审计痕迹）
  UPDATE orders
  SET status = 'paid',
      paid_at = p_paid_at,
      paid_email = p_paid_email,
      paid_detail = p_paid_detail,
      order_detail = CASE
        WHEN v_recovered THEN json_build_object(
          'recovered_from_expired', true,
          'recovered_at', now()
        )::text
        ELSE order_detail
      END
  WHERE order_no = p_order_no;

  -- 2. 充值积分（幂等：同 order_no 只充一次）
  IF v_order.credits > 0 AND v_order.user_uuid <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM credits WHERE order_no = v_order.order_no) THEN
      INSERT INTO credits (trans_no, created_at, user_uuid, trans_type, credits, order_no, expired_at)
      VALUES (gen_random_uuid()::text, now(), v_order.user_uuid, 'order_pay',
              v_order.credits, v_order.order_no, v_order.expired_at);
    END IF;
  END IF;

  -- 3. 记录联盟奖励（双重幂等：同 paid_order_no 只记一次 + 每个被邀请人仅首笔付费）
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

  -- 终态恒为 paid（含 expired 恢复），返回真实状态而非锁定行旧快照
  RETURN 'paid';
END;
$$;
