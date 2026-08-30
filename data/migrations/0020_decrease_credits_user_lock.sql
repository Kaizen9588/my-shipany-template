-- P0-2：decrease_credits 并发安全加固（用户级事务 advisory lock）
--
-- 背景（docs/03 §3 / docs/05 §P0-2，第九轮对抗式审查）：
--   扣减的写入是 INSERT 一条负数流水，`SELECT ... FOR UPDATE` 只能锁查询快照里
--   **已存在**的行。账本为空（无任何行可锁）或并发插入负数流水时，两个事务都能
--   通过 SUM 校验，append-only 账本上不等价于串行化，存在双花窗口。
--
-- 修法：函数入口先取**用户级事务 advisory lock**，把同一用户的所有扣减完全串行化。
--   - 必须是事务级（pg_advisory_xact_lock），session 级锁在 Supabase pooler
--     事务模式下会把锁泄漏给连接池里下一个复用连接的事务。
--   - 使用两段 int4 键 (736925141, hashtext(user_uuid))：固定命名空间避免与
--     迁移器全局锁（lib/migrate.ts MIGRATION_LOCK_KEY = 821316459）或其他子系统撞键。
--   - 与 process_order_refund 的锁序（orders → credits）无环：本函数不取 orders 行锁。
--
-- 保留原有 FOR UPDATE 行锁：它继续与 process_order_refund 等按行锁互斥的路径串行化。

CREATE OR REPLACE FUNCTION decrease_credits(
  p_user_uuid TEXT,
  p_trans_type TEXT,
  p_credits INT,
  p_trans_no TEXT
) RETURNS TEXT
LANGUAGE plpgsql
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
