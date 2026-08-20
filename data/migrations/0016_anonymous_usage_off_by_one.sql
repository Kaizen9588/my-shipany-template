-- 对抗性测试修复（2026-08-17）：匿名演示额度 off-by-one
--
-- 问题：increment_anonymous_usage 在达到上限时返回 p_limit（而非 NULL），
-- 路由按「count >= dailyLimit → 429」判断 -> 上限为 3 时实际只放行 2 次。
-- 且「正好递增到上限」与「已达上限被拒」都返回 p_limit，路由无法区分。
--
-- 修复：达到上限不再递增并返回 NULL，路由以 NULL 判定「额度已用完」，
-- 恰好放行 dailyLimit 次。

CREATE OR REPLACE FUNCTION increment_anonymous_usage(
    p_key TEXT, p_date DATE, p_limit INT
) RETURNS INT AS $$
DECLARE v_count INT;
BEGIN
    INSERT INTO anonymous_usage (anonymous_key, usage_date, count)
    VALUES (p_key, p_date, 1)
    ON CONFLICT (anonymous_key, usage_date)
    DO UPDATE SET count = anonymous_usage.count + 1,
                  updated_at = now()
    WHERE anonymous_usage.count < p_limit
    RETURNING count INTO v_count;

    -- 已达上限（WHERE 不命中）时 v_count 为 NULL，由应用层判 429
    RETURN v_count;
END $$ LANGUAGE plpgsql;
