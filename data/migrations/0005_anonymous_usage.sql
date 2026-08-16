-- 6.0.1 免费试用额度：匿名演示限流（docs/14）
--
-- 核心原则：匿名额度 ≠ 积分账户，匿名 = 服务端限流（IP + 设备指纹双维度）。
-- 隐私合规：只存 sha256 hash，不存明文 IP / 设备指纹。

CREATE TABLE IF NOT EXISTS anonymous_usage (
    id SERIAL PRIMARY KEY,
    anonymous_key VARCHAR(64) NOT NULL,   -- sha256(ip + device_id)，指纹缺失时 sha256(ip)
    usage_date DATE NOT NULL,              -- 当日（UTC）
    count INT NOT NULL DEFAULT 0,
    updated_at timestamptz,
    UNIQUE (anonymous_key, usage_date)
);

-- 原子递增：WHERE count < p_limit 保证达到上限后不再递增（防记录无限膨胀）
-- ON CONFLICT + RETURNING 单语句原子，无并发窗口
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

    RETURN COALESCE(v_count, p_limit);  -- 达到上限时返回 p_limit（拒绝）
END $$ LANGUAGE plpgsql;

-- 失败退还次数（服务端异常/模型报错时，用户未获得服务）
-- GREATEST(count-1, 0) 保证不出现负数
CREATE OR REPLACE FUNCTION decrement_anonymous_usage(
    p_key TEXT, p_date DATE
) RETURNS INT AS $$
DECLARE v_count INT;
BEGIN
    UPDATE anonymous_usage
    SET count = GREATEST(count - 1, 0),
        updated_at = now()
    WHERE anonymous_key = p_key AND usage_date = p_date
    RETURNING count INTO v_count;

    RETURN COALESCE(v_count, 0);
END $$ LANGUAGE plpgsql;
