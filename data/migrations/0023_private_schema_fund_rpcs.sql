-- N-2：资金 RPC 库级权限边界（docs/03 §生产必须满足的数据库权限基线，2026-09-01 连库执行）
--
-- 背景（boundary-spec N-2 / P0）：五个资金函数位于 public schema 且默认
-- EXECUTE 授予 PUBLIC——在 Supabase 默认配置下 anon/authenticated 可直接
-- 调用 decrease_credits / handle_order_payment / process_order_refund /
-- register_order_refund_request / debt_regulate_order_refund，绕过全部应用层
-- 鉴权直接改账本（充值/扣费/退款/债务化）。
--
-- 本迁移：
-- 1. 新建 private schema（不被 Data API 暴露，anon 无法构造 URL 触达）
-- 2. 把五个资金函数整体迁入 private（CREATE OR REPLACE ... private.<fn>，
--    DROP public.<fn>；函数体与最近定义完全一致：decrease_credits=0020、
--    handle_order_payment=0017 八参版、process_order_refund=0022、
--    debt_regulate_order_refund=0021、register_order_refund_request=0022）
-- 3. REVOKE ALL FROM PUBLIC/anon/authenticated + 仅 GRANT EXECUTE TO service_role
-- 4. private schema 不授予 anon/authenticated USAGE；service_role 授 USAGE
-- 5. 资金/账本表启用 RLS：credits / orders / refunds / credit_debts
--    无任何 policy（deny-all），仅 service_role（bypassrls）可读写——
--    应用侧资金路径已全部走 serverClient()（N-3），用户读自己的
--    订单/积分流水的页面走 getSupabaseClient()（anon），如 usage/subscription
--    控制台页与 /api/metrics——这些页面改为走 serverClient() 读（见本次配套代码改动）。
--
-- 注意：函数用 CREATE OR REPLACE 迁移而非 ALTER ... SET SCHEMA——后者会破坏
-- public 上已有的 EXECUTE ACL 记录语义且对「同签名函数在两个 schema 并存」的
-- 过渡期不友好；先建后删保证失败可整体回滚（迁移器单事务）。
-- SECURITY INVOKER 保持不变（默认）：这些函数全部由 service_role 调用，
-- 调用者本身就是特权角色，无需 DEFINER 提权（技能红线：DEFINESR 绕 RLS）。
-- 每个 SET search_path = private,public,extensions：函数体引用 orders/credits/
-- users/affiliates/refunds/credit_debts，钉死 search_path 防同名对象劫持
-- （advisors 函数搜索路径检查项）。

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

-- ============ 1. decrease_credits（= 0020 版）============
CREATE OR REPLACE FUNCTION private.decrease_credits(
  p_user_uuid TEXT,
  p_trans_type TEXT,
  p_credits INT,
  p_trans_no TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SET search_path = private, public, extensions
AS $$
DECLARE
  v_balance INT := 0;
  v_remaining INT := p_credits;
  v_source_order_no TEXT := '';
  v_credit RECORD;
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'invalid credits amount';
  END IF;

  -- P0-2：用户级事务锁串行化同一用户的并发扣减（含账本为空 / 幻影插入场景）
  PERFORM pg_advisory_xact_lock(736925141, hashtext(p_user_uuid));

  -- 锁定该用户全部积分记录，与 process_order_refund 的行锁路径互斥
  PERFORM id FROM credits WHERE user_uuid = p_user_uuid FOR UPDATE;

  -- 计算净余额：正数记录需未过期；负数记录永不过期（expired_at 为 NULL 不参与过滤）
  SELECT COALESCE(SUM(credits), 0) INTO v_balance
  FROM credits
  WHERE user_uuid = p_user_uuid
    AND (
      (credits > 0 AND (expired_at IS NULL OR expired_at >= now()))
      OR credits <= 0
    );

  IF v_balance < p_credits THEN
    RAISE EXCEPTION 'insufficient credits: %', v_balance;
  END IF;

  -- FIFO：从最早过期的正数积分开始消耗，记录首个被消耗积分的 order_no
  FOR v_credit IN
    SELECT id, credits, order_no
    FROM credits
    WHERE user_uuid = p_user_uuid
      AND credits > 0
      AND (expired_at IS NULL OR expired_at >= now())
    ORDER BY expired_at ASC NULLS LAST, id ASC
  LOOP
    IF v_remaining <= 0 THEN
      EXIT;
    END IF;
    IF v_source_order_no = '' THEN
      v_source_order_no := COALESCE(v_credit.order_no, '');
    END IF;
    v_remaining := v_remaining - v_credit.credits;
  END LOOP;

  -- 写入负数扣减记录：expired_at 必须为 NULL（扣减是永久消费行为）
  INSERT INTO credits (trans_no, created_at, user_uuid, trans_type, credits, order_no, expired_at)
  VALUES (p_trans_no, now(), p_user_uuid, p_trans_type, -p_credits, v_source_order_no, NULL);

  RETURN v_source_order_no;
END;
$$;

-- ============ 2. handle_order_payment（= 0017 八参版）============
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

-- ============ 3. process_order_refund（= 0022 版）============
CREATE OR REPLACE FUNCTION private.process_order_refund(
  p_order_no TEXT,
  p_refund_note TEXT DEFAULT ''
) RETURNS INT
LANGUAGE plpgsql
SET search_path = private, public, extensions
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

-- ============ 4. debt_regulate_order_refund（= 0021 版）============
CREATE OR REPLACE FUNCTION private.debt_regulate_order_refund(
  p_order_no TEXT,
  p_user_uuid TEXT,
  p_order_credits INT,
  p_refunded_credits INT,   -- 本次实际从余额扣回的积分
  p_reason TEXT DEFAULT ''
) RETURNS INT
LANGUAGE plpgsql
SET search_path = private, public, extensions
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

-- ============ 5. register_order_refund_request（= 0022 版）============
CREATE OR REPLACE FUNCTION private.register_order_refund_request(
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
SET search_path = private, public, extensions
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
  -- 由闭合方 processRefund 按实际扣回量触发（见 0022 头注释）。

  RETURN v_refund_no;
END;
$$;

-- ============ 权限回收与最小授权 ============
-- private.* 函数：REVOKE ALL FROM PUBLIC + anon + authenticated，仅 service_role 可执行
REVOKE ALL ON FUNCTION private.decrease_credits(text,text,int,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.handle_order_payment(text,timestamptz,text,text,int,text,int,int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.process_order_refund(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.debt_regulate_order_refund(text,text,int,int,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.register_order_refund_request(text,text,text,text,int,text,text,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.decrease_credits(text,text,int,text) TO service_role;
GRANT EXECUTE ON FUNCTION private.handle_order_payment(text,timestamptz,text,text,int,text,int,int) TO service_role;
GRANT EXECUTE ON FUNCTION private.process_order_refund(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION private.debt_regulate_order_refund(text,text,int,int,text) TO service_role;
GRANT EXECUTE ON FUNCTION private.register_order_refund_request(text,text,text,text,int,text,text,text) TO service_role;

-- 删除 public 下的旧函数（迁移器单事务：删除失败整体回滚，private 已建不受影响）。
-- handle_order_payment 历史上出现过三个签名（0003 四参 / 0010 六参 / 0017 八参），
-- 全部清掉；六参版为 0010→0017 过渡产物，当前代码只走八参 RPC。
DROP FUNCTION IF EXISTS public.decrease_credits(text,text,int,text);
DROP FUNCTION IF EXISTS public.handle_order_payment(text,timestamptz,text,text);
DROP FUNCTION IF EXISTS public.handle_order_payment(text,timestamptz,text,text,int,int);
DROP FUNCTION IF EXISTS public.handle_order_payment(text,timestamptz,text,text,int,text,int,int);
DROP FUNCTION IF EXISTS public.process_order_refund(text,text);
DROP FUNCTION IF EXISTS public.debt_regulate_order_refund(text,text,int,int,text);
DROP FUNCTION IF EXISTS public.register_order_refund_request(text,text,text,text,int,text,text,text);

-- ============ 资金/账本表 RLS（deny-all，service_role bypassrls 可写）============
-- 应用侧约定：资金表读写一律 serverClient()（service_role，bypassrls）。
-- 不建任何 policy = anon/authenticated 全拒。users 表此迁移不动（登录/资料
-- 路径仍依赖 anon 读写自身行，其 RLS 策略单独设计，见 handoff §3）。
ALTER TABLE credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_debts ENABLE ROW LEVEL SECURITY;
