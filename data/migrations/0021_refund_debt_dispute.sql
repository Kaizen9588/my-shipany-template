-- P0-1 退款债务化 + N-13 争议/拒付链路（2026-08-30）
--
-- 目标：修复「已消费积分 + 全额退款 = 必然白嫖」的资金漏洞。
-- 此前 process_order_refund 扣回 LEAST(订单积分, 当前余额)，余额为 0 时扣回 0
-- 却把订单进终态 refunded，钱全退。docs/05 §4.3 P0-1。
--
-- 本迁移（代码与文档先行，连库后应用）：
-- 1. orders.status 扩展 refund_requested / refund_blocked / disputed / charged_back
--    - refund_requested：webhook/后台登记退款事实，进入回收流程（中间态）
--    - refund_blocked：回收需人工决策（余额无法覆盖已消费的部分），人工 intermediate
--    - disputed / charged_back：争议/拒付归一化状态（N-13）
-- 2. 新增 credit_debts(user_uuid, order_no, due_credits, status) 欠款账本，
--    越权全额退款差额债务化
-- 3. 新增 refunds 退款单（支持部分/多次退款、渠道退款 ID 幂等、发起方）
-- 4. RLS：credit_debts / refunds 仅 service_role；orders 保留现有行为（表级 RLS 由
--    后续迁移统一启用，见 N-2 library-level 部分）
-- 5. 债务化存储过程 debt_regulate_order_refund：退款准入校验，超额写 debt +
--    refund_blocked + 账号 restricted（清偿前禁止消费与再次下单）

-- order status 允许值扩展（用 CHECK 收紧当前脏值不现实，改为对新增状态做主键约束）
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (
  status IN ('created','paid','deleted','expired','refunded','mismatch',
             'refund_requested','refund_blocked','disputed','charged_back')
);

-- credit_debts：欠款账本（P0-1）
CREATE TABLE IF NOT EXISTS credit_debts (
  id BIGSERIAL PRIMARY KEY,
  debt_no VARCHAR(64) UNIQUE NOT NULL,
  user_uuid VARCHAR(64) NOT NULL,
  order_no VARCHAR(64) NOT NULL,
  due_credits INT NOT NULL CHECK (due_credits > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'outstanding', -- outstanding / settled / written_off
  reason TEXT,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT credit_debts_user_no_unique UNIQUE (user_uuid, order_no)
);
CREATE INDEX IF NOT EXISTS idx_credit_debts_user ON credit_debts(user_uuid);
CREATE INDEX IF NOT EXISTS idx_credit_debts_status ON credit_debts(status);

-- refunds：退款单（支持部分/多次退款）
CREATE TABLE IF NOT EXISTS refunds (
  id BIGSERIAL PRIMARY KEY,
  refund_no VARCHAR(64) UNIQUE NOT NULL,
  order_no VARCHAR(64) NOT NULL,
  user_uuid VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_refund_id VARCHAR(256),
  amount_cents INT NOT NULL,               -- 本次退款金额（分）
  currency VARCHAR(10) NOT NULL,
  credits_refunded INT DEFAULT 0,          -- 本次回补积分（债务条目另计）
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending / succeeded / failed
  reason TEXT,
  initiated_by VARCHAR(20) NOT NULL DEFAULT 'system', -- admin / system / customer
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refunds_refund_no_unique UNIQUE (refund_no)
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_no);
CREATE INDEX IF NOT EXISTS idx_refunds_provider ON refunds(provider, provider_refund_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);

-- 债务化存储过程：退款准入 + 差额债务化 + restricted
-- 由 process_order_refund / disputed 事件触发。当前 process_order_refund 已把订单置
-- 'refunded'；本过程是其资金安全补强：若已消费超额（该订单积分无法全额从余额扣回），
-- 记 credit_debts 欠款、置 refund_blocked、账号 restricted。
CREATE OR REPLACE FUNCTION debt_regulate_order_refund(
  p_order_no TEXT,
  p_user_uuid TEXT,
  p_order_credits INT,
  p_refunded_credits INT,   -- 本次实际从余额扣回的积分
  p_reason TEXT DEFAULT ''
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_debt INT;
  v_debt_no TEXT;
  v_existing INT;
BEGIN
  -- 清算缺口 = 订单发放积分 - 本次扣回积分；>0 表示已消费而无法回收的部分
  v_debt := GREATEST(COALESCE(p_order_credits,0) - GREATEST(COALESCE(p_refunded_credits,0),0), 0);
  IF v_debt <= 0 THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*) INTO v_existing FROM credit_debts
    WHERE user_uuid = p_user_uuid AND order_no = p_order_no;
  IF v_existing > 0 THEN
    RETURN v_existing; -- 已登记过，幂等
  END IF;

  v_debt_no := 'debt-' || gen_random_uuid()::text;
  INSERT INTO credit_debts (debt_no, user_uuid, order_no, due_credits, status, reason)
  VALUES (v_debt_no, p_user_uuid, p_order_no, v_debt, 'outstanding',
          COALESCE(NULLIF(p_reason,''), 'refund exceeds unconsumed credits'));

  -- 订单置 refund_blocked（人工决策中间态），账号 restricted（清偿前禁止消费/下单）
  UPDATE orders SET status = 'refund_blocked' WHERE order_no = p_order_no;
  UPDATE users SET status = 'restricted'
    WHERE uuid = p_user_uuid AND COALESCE(status,'') <> 'restricted';

  RETURN v_debt;
END;
$$;