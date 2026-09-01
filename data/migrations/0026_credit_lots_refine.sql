-- 第十一批（2026-09-01）：P0-1 剩余——credit_lots 批次账本 + 退款精确准入 + 债务清偿
--
-- 问题（docs/03 #9/#13、handoff §3 P0-1 剩余）：
--   1) 退款回收是近似口径 min(订单积分, 当前余额)：无法区分「这单发的积分还剩多少」，
--      用户可先消费 A 单积分、退 B 单，把回收量做小甚至归零（白嫖路径的一半——
--      债务化 0021 堵住了不回收的缺口，但回收量判定本身不精确）。
--   2) 正负净额模型无法支撑过期/退款/审计的精确追踪（credit_lots 长期方向）。
--   3) credit_debts 只能由退款自动登记，没有任何清偿入口；账号 restricted 后无人可解。
--   4) webhook 登记的 refund_requested 退款单只能在订单详情/流水里翻到，无工作台。
--
-- 设计：**双账本叠加**，不做一次性替换——
--   - `credits` 流水表保留：使用页/后台流水/统计/邮件通知全部继续以它为真相源，
--     前端零改动；正负净额余额语义不变。
--   - 新增 `credit_lots` 批次账本：每个发放动作一个批次（total/remaining/expired_at/
--     status），作为退款精确准入与未来 credit_consumptions 明细的权威账本。
--   - 发放路径同步建批次：private.handle_order_payment（订单发放）、private RPC
--     grant_credit_lot（服务端 increaseCredits / AI 失败退款 / 管理员加积分统一入口）。
--   - 扣减路径同步消耗批次：private.decrease_credits 改为批次 FIFO（过期优先）+
--     UPDATE ... WHERE remaining >= x 行级原子（docs/03 #13 正解），credits 流水照旧写负数行。
--   - 退款：private.process_order_refund 改为「按该订单未退款批次精确回收」——
--     回收量 = SUM(该订单批次 remaining)，扣完批次置 refunded；余额不足部分照旧
--     由 services/refund.ts 债务化（0021）。批次准入让「先消费再退款」的缺口计算精确。
--   - 债务清偿：private.settle_credit_debt——管理员确认清偿（现金/线下/追回）后
--     债务置 settled + 账号恢复 active；审计走调用方 lib/audit。
--
-- 迁移器单事务执行；DDL 幂等性由 IF NOT EXISTS + 函数整体重建保证。

-- ============ 1. credit_lots 批次账本 ============

CREATE TABLE IF NOT EXISTS credit_lots (
    id BIGSERIAL PRIMARY KEY,
    lot_no VARCHAR(64) UNIQUE NOT NULL,             -- 批次号（lot-<uuid>）
    user_uuid VARCHAR(255) NOT NULL,
    source_type VARCHAR(32) NOT NULL,               -- order_pay / system_add / new_user / ai_refund / other
    source_ref VARCHAR(255) NOT NULL DEFAULT '',    -- 订单号 / 备注（与 credits.order_no 同源）
    total_credits INT NOT NULL CHECK (total_credits > 0),
    remaining_credits INT NOT NULL CHECK (remaining_credits >= 0),
    expired_at timestamptz,                         -- NULL = 永久（与 credits 口径一致）
    status VARCHAR(20) NOT NULL DEFAULT 'active',   -- active / exhausted / refunded
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    CONSTRAINT fk_credit_lots_user FOREIGN KEY (user_uuid) REFERENCES users(uuid)
);
CREATE INDEX IF NOT EXISTS idx_credit_lots_user_active
    ON credit_lots(user_uuid) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_credit_lots_source_ref ON credit_lots(source_ref);
CREATE INDEX IF NOT EXISTS idx_credit_lots_expired_at ON credit_lots(expired_at)
    WHERE status = 'active' AND expired_at IS NOT NULL;

-- ============ 2. credit_consumptions 消费明细（一次消费跨多批次）============

CREATE TABLE IF NOT EXISTS credit_consumptions (
    id BIGSERIAL PRIMARY KEY,
    consumption_no VARCHAR(64) NOT NULL,            -- 所属 credits 流水 trans_no（同一消费事件）
    user_uuid VARCHAR(255) NOT NULL,
    lot_id BIGINT NOT NULL REFERENCES credit_lots(id),
    credits INT NOT NULL CHECK (credits > 0),       -- 本次从该批次扣减的数量
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_consumptions_no_lot_unique UNIQUE (consumption_no, lot_id)
);
CREATE INDEX IF NOT EXISTS idx_credit_consumptions_user ON credit_consumptions(user_uuid);
CREATE INDEX IF NOT EXISTS idx_credit_consumptions_no ON credit_consumptions(consumption_no);

-- ============ 3. 存量回填（幂等：按 trans_no 对齐，重复执行跳过）============
-- 正数流水 = 发放批次；负数流水与退款负流水在此之前的消费无批次明细（历史口径），
-- 只把「每个用户已存在的负数总量」从其批次中按 FIFO 扣除，保证 remaining 总量
-- 与 credits 净额一致（平衡不变量）。当前生产库为空表，此段为空库外的兜底。

INSERT INTO credit_lots (lot_no, user_uuid, source_type, source_ref, total_credits, remaining_credits, expired_at, created_at)
SELECT
    'lot-' || c.trans_no,
    c.user_uuid,
    CASE
      WHEN c.trans_type = 'order_pay' THEN 'order_pay'
      WHEN c.trans_type = 'new_user' THEN 'new_user'
      WHEN c.trans_type = 'system_add' THEN 'system_add'
      WHEN c.trans_type = 'ai_refund' THEN 'ai_refund'
      ELSE 'other'
    END,
    COALESCE(c.order_no, ''),
    c.credits,
    c.credits,
    c.expired_at,
    COALESCE(c.created_at, now())
FROM credits c
WHERE c.credits > 0
  AND NOT EXISTS (SELECT 1 FROM credit_lots l WHERE l.lot_no = 'lot-' || c.trans_no)
ORDER BY c.id;

-- 历史负数流水回扣批次（FIFO 过期优先），仅当该用户存在未被回扣的批次差额时执行。
-- 用临时聚合：每用户历史净消费 = SUM(-负数) - SUM(已回扣)，>0 才补扣。
DO $$
DECLARE
  rec RECORD;
  v_to_deduct INT;
  v_lot RECORD;
  v_take INT;
BEGIN
  FOR rec IN
    SELECT user_uuid,
           GREATEST(-COALESCE(SUM(credits) FILTER (WHERE credits < 0), 0), 0) AS consumed
    FROM credits
    GROUP BY user_uuid
  LOOP
    CONTINUE WHEN rec.consumed <= 0;
    -- 已被批次反映的扣减量 = 发放总量(G) - 批次剩余总和；补扣量 = 历史消费 - 已反映量。
    -- 首次执行：批次 remaining=total=G，已反映=0，补扣 rec.consumed；
    -- 重复执行：已反映=consumed，补扣 0（幂等）。
    SELECT rec.consumed - (
             SELECT COALESCE(SUM(c.credits), 0) FROM credits c
               WHERE c.user_uuid = rec.user_uuid AND c.credits > 0
           ) + COALESCE(SUM(l.remaining_credits), 0)
      INTO v_to_deduct
    FROM credit_lots l WHERE l.user_uuid = rec.user_uuid;
    v_to_deduct := LEAST(GREATEST(v_to_deduct, 0), rec.consumed);
    CONTINUE WHEN v_to_deduct <= 0;

    FOR v_lot IN
      SELECT id, remaining_credits FROM credit_lots
      WHERE user_uuid = rec.user_uuid AND status = 'active' AND remaining_credits > 0
      ORDER BY expired_at ASC NULLS LAST, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_to_deduct <= 0;
      v_take := LEAST(v_lot.remaining_credits, v_to_deduct);
      UPDATE credit_lots
        SET remaining_credits = remaining_credits - v_take,
            status = CASE WHEN remaining_credits - v_take <= 0 THEN 'exhausted' ELSE status END,
            updated_at = now()
        WHERE id = v_lot.id;
      v_to_deduct := v_to_deduct - v_take;
    END LOOP;
  END LOOP;
END $$;

-- ============ 4. 发放批次 RPC（统一入口，service_role 专用）============
-- services/credit.ts increaseCredits 在 insertCredit 成功后调用，批次与流水同事务性
-- 由调用方保证失败重试（insertCredit 幂等键 trans_no + 批次 lot_no = 'lot-'||trans_no 幂等）。

CREATE OR REPLACE FUNCTION private.grant_credit_lot(
  p_trans_no TEXT,
  p_user_uuid TEXT,
  p_source_type TEXT,
  p_source_ref TEXT,
  p_credits INT,
  p_expired_at timestamptz
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions
AS $$
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'invalid credits amount';
  END IF;
  -- 幂等：同流水号只建一个批次
  INSERT INTO credit_lots (lot_no, user_uuid, source_type, source_ref, total_credits, remaining_credits, expired_at)
  VALUES ('lot-' || p_trans_no, p_user_uuid, p_source_type, COALESCE(p_source_ref, ''),
          p_credits, p_credits, p_expired_at)
  ON CONFLICT (lot_no) DO NOTHING;
  RETURN 'lot-' || p_trans_no;
END $$;

-- ============ 5. decrease_credits 改批次 FIFO 扣减（P0-2 语义不变 + 批次同步）============
-- 保持对外契约不变：(user_uuid, trans_type, credits, trans_no) -> source_order_no。
-- 并发安全从「全行 FOR UPDATE + 净额校验」升级为「用户 advisory lock + 批次行级
-- UPDATE ... WHERE remaining >= x」（docs/03 #13 正解），advisory lock 保留以覆盖
-- 账本为空/幻影插入窗口。

CREATE OR REPLACE FUNCTION private.decrease_credits(
  p_user_uuid TEXT,
  p_trans_type TEXT,
  p_credits INT,
  p_trans_no TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions
AS $$
DECLARE
  v_balance INT := 0;
  v_remaining INT := p_credits;
  v_source_order_no TEXT := '';
  v_lot RECORD;
  v_take INT;
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'invalid credits amount';
  END IF;

  -- P0-2：用户级事务锁串行化同一用户的并发扣减（含账本为空 / 幻影插入场景）
  PERFORM pg_advisory_xact_lock(736925141, hashtext(p_user_uuid));

  -- 批次 FIFO（过期优先）：对候选批次行加锁并逐行原子扣减
  FOR v_lot IN
    SELECT id, remaining_credits, COALESCE(source_ref, '') AS source_ref
    FROM credit_lots
    WHERE user_uuid = p_user_uuid
      AND status = 'active'
      AND remaining_credits > 0
      AND (expired_at IS NULL OR expired_at >= now())
    ORDER BY expired_at ASC NULLS LAST, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF v_source_order_no = '' AND v_lot.source_ref <> '' THEN
      v_source_order_no := v_lot.source_ref;
    END IF;
    v_take := LEAST(v_lot.remaining_credits, v_remaining);
    UPDATE credit_lots
      SET remaining_credits = remaining_credits - v_take,
          status = CASE WHEN remaining_credits - v_take <= 0 THEN 'exhausted' ELSE 'active' END,
          updated_at = now()
      WHERE id = v_lot.id AND remaining_credits >= v_take;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'concurrent lot modification: %', v_lot.id;
    END IF;
    INSERT INTO credit_consumptions (consumption_no, user_uuid, lot_id, credits)
    VALUES (p_trans_no, p_user_uuid, v_lot.id, v_take);
    v_remaining := v_remaining - v_take;
  END LOOP;

  -- 批次不足 = 余额不足（保持错误信息格式，services/credit 解析）
  IF v_remaining > 0 THEN
    SELECT COALESCE(SUM(remaining_credits), 0) INTO v_balance
    FROM credit_lots
    WHERE user_uuid = p_user_uuid AND status = 'active'
      AND (expired_at IS NULL OR expired_at >= now());
    RAISE EXCEPTION 'insufficient credits: %', v_balance;
  END IF;

  -- credits 流水照旧写负数行（展示层真相源不变）
  INSERT INTO credits (trans_no, created_at, user_uuid, trans_type, credits, order_no, expired_at)
  VALUES (p_trans_no, now(), p_user_uuid, p_trans_type, -p_credits, v_source_order_no, NULL);

  RETURN v_source_order_no;
END $$;

-- ============ 6. handle_order_payment：发放时建批次（其余逻辑不变）============
-- 幂等键从「credits 无同 order_no 行」升级为「批次 lot-'||trans_no 不存在」；
-- credits 流水的 trans_no 与批次号同源生成，保持两账本对齐。

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
  v_trans_no TEXT;
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

  -- 充值积分 + 建批次（同一 trans_no，幂等：同 order_no 只充一次）
  IF v_order.credits > 0 AND v_order.user_uuid <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM credits WHERE order_no = v_order.order_no) THEN
      v_trans_no := gen_random_uuid()::text;
      INSERT INTO credits (trans_no, created_at, user_uuid, trans_type, credits, order_no, expired_at)
      VALUES (v_trans_no, now(), v_order.user_uuid, 'order_pay',
              v_order.credits, v_order.order_no, v_order.expired_at);
      INSERT INTO credit_lots (lot_no, user_uuid, source_type, source_ref, total_credits, remaining_credits, expired_at)
      VALUES ('lot-' || v_trans_no, v_order.user_uuid, 'order_pay', v_order.order_no,
              v_order.credits, v_order.credits, v_order.expired_at)
      ON CONFLICT (lot_no) DO NOTHING;
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
END $$;

-- ============ 7. process_order_refund：按订单批次精确回收 ============
-- 回收量 = SUM(该订单批次 remaining)（不再用近似口径 min(订单积分, 余额)）；
-- 扣完的批次置 refunded。缺口语义不变：扣除后 < 订单发放积分 → 调用方债务化。
-- credits 负流水照旧写（展示层/统计不变）。

CREATE OR REPLACE FUNCTION private.process_order_refund(
  p_order_no TEXT,
  -- 默认值与 0023 保持一致：CREATE OR REPLACE 不允许移除既有参数默认值
  p_refund_note TEXT DEFAULT ''
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_recoverable INT := 0;
  v_deducted INT := 0;
  v_lot RECORD;
  v_take INT;
BEGIN
  SELECT * INTO v_order FROM orders WHERE order_no = p_order_no FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_no;
  END IF;

  IF v_order.status = 'refunded' THEN
    RETURN 0;
  END IF;

  IF v_order.status NOT IN ('paid', 'refund_requested') THEN
    RAISE EXCEPTION 'order is not refundable: %', v_order.status;
  END IF;

  -- 精确准入：该订单发放的批次还剩多少可回收（过期批次 remaining 仍计入——
  -- 过期只是不可消费，不改变「这单发的积分还没用完」的事实，防止过期套利）。
  -- 先取用户级锁再读快照，与 decrease_credits 互斥，消除读-扣之间的快照漂移。
  PERFORM pg_advisory_xact_lock(736925141, hashtext(v_order.user_uuid));

  SELECT COALESCE(SUM(remaining_credits), 0) INTO v_recoverable
  FROM credit_lots
  WHERE user_uuid = v_order.user_uuid
    AND source_type = 'order_pay'
    AND source_ref = p_order_no
    AND status = 'active';

  IF v_recoverable > 0 THEN
    v_deducted := 0;
    FOR v_lot IN
      SELECT id, remaining_credits FROM credit_lots
      WHERE user_uuid = v_order.user_uuid
        AND source_type = 'order_pay'
        AND source_ref = p_order_no
        AND status = 'active'
        AND remaining_credits > 0
      ORDER BY id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_recoverable <= 0;
      v_take := LEAST(v_lot.remaining_credits, v_recoverable);
      UPDATE credit_lots
        SET remaining_credits = remaining_credits - v_take,
            status = CASE WHEN remaining_credits - v_take <= 0 THEN 'refunded' ELSE 'active' END,
            updated_at = now()
        WHERE id = v_lot.id AND remaining_credits >= v_take;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'concurrent lot modification: %', v_lot.id;
      END IF;
      v_deducted := v_deducted + v_take;
      v_recoverable := v_recoverable - v_take;
    END LOOP;

    -- credits 负流水照旧写（展示层/统计不变）
    INSERT INTO credits (trans_no, created_at, user_uuid, trans_type, credits, order_no, expired_at)
    VALUES (gen_random_uuid()::text, now(), v_order.user_uuid, 'order_refund',
            -v_deducted, v_order.order_no, NULL);
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

  RETURN v_deducted;
END $$;

-- ============ 8. 债务清偿 RPC（回收工作台调用，P0-1 闭环最后一环）============
-- 管理员确认清偿方式（现金追回/线下协商/豁免决策）后：债务置 settled、
-- 账号从 restricted 恢复 active。幂等：已 settled 返回 0。
-- 注意：不自动补发积分——清偿是运营决策，如需补偿积分走 adjustCreditsByAdmin 留痕。

CREATE OR REPLACE FUNCTION private.settle_credit_debt(
  p_debt_no TEXT,
  p_note TEXT
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions
AS $$
DECLARE
  v_debt credit_debts%ROWTYPE;
BEGIN
  SELECT * INTO v_debt FROM credit_debts WHERE debt_no = p_debt_no FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'debt not found: %', p_debt_no;
  END IF;
  IF v_debt.status = 'settled' THEN
    RETURN 0;
  END IF;

  UPDATE credit_debts
  SET status = 'settled',
      settled_at = now(),
      reason = CASE
        WHEN COALESCE(p_note, '') = '' THEN v_debt.reason
        ELSE v_debt.reason || ' | settled: ' || p_note
      END
  WHERE debt_no = p_debt_no;

  -- 该用户无其他 outstanding 债务时恢复账号（有多个债务则保持 restricted）
  UPDATE users SET status = 'active'
  WHERE uuid = v_debt.user_uuid AND status = 'restricted'
    AND NOT EXISTS (
      SELECT 1 FROM credit_debts d2
      WHERE d2.user_uuid = v_debt.user_uuid AND d2.status = 'outstanding'
    );

  RETURN v_debt.due_credits;
END $$;

-- ============ 9. 权限收口（与 0023 同规：REVOKE + 仅授 service_role）============

REVOKE ALL ON FUNCTION private.grant_credit_lot(TEXT,TEXT,TEXT,TEXT,INT,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.grant_credit_lot(TEXT,TEXT,TEXT,TEXT,INT,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION private.decrease_credits(TEXT,TEXT,INT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.decrease_credits(TEXT,TEXT,INT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION private.handle_order_payment(TEXT,timestamptz,TEXT,TEXT,INT,TEXT,INT,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.handle_order_payment(TEXT,timestamptz,TEXT,TEXT,INT,TEXT,INT,INT) TO service_role;
REVOKE ALL ON FUNCTION private.process_order_refund(TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.process_order_refund(TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION private.settle_credit_debt(TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.settle_credit_debt(TEXT,TEXT) TO service_role;

-- 新表 RLS deny-all + 表权限回收（0024 同规，纵深防御两层）
ALTER TABLE credit_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_consumptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE credit_lots FROM anon, authenticated;
REVOKE ALL ON TABLE credit_consumptions FROM anon, authenticated;
