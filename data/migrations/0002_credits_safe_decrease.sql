-- P-1.2 积分扣减安全：原子「检查 + 扣减」存储过程
--
-- 修复三个问题：
-- 1. 原 decreaseCredits 不检查余额，并发请求可透支 → 本函数行锁 + 余额校验
-- 2. 原 FIFO 扣减把原始积分的 expired_at 复制到负数记录上，原始积分过期后
--    负数记录同时被排除，已消耗的积分"复活" → 负数扣减记录 expired_at 为 NULL，
--    查询有效积分时负数记录不做 expired_at 过滤（扣减是永久消费）
-- 3. 余额计算累加正负记录计算净余额（修正文档中错误的 credits > 0 过滤说明）

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

  -- 锁定该用户全部积分记录，串行化同一用户的并发扣减
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
