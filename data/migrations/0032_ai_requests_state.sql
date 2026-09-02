-- ============================================================
-- 0032 AI 请求状态机（P1：幂等 + 崩溃补偿，docs/13 §v1.5 / docs/03 §P1）
-- ============================================================
-- 目标（handoff §4 P1-AI）：
-- 1. Idempotency-Key 幂等：UNIQUE(user_uuid, request_id) 按用户隔离（P1-5，
--    防「客户端可控公共键空间」跨租户抢注）；同键不同请求体返 422。
-- 2. 崩溃补偿：扣费后进程崩溃 → 行停留 running，cron 扫描退款（refund_pending/refunded）。
-- 3. 生命周期：completed 超过 24h 的记录由每日 cron 清理（幂等键 TTL 口径）。
--
-- 状态机（status CHECK）：
--   running        已扣费、生成中（路由扣费成功后即建行——行存在即代表已扣费，
--                  消除「崩溃时已扣未记」的歧义）
--   succeeded      生成成功、扣费保留
--   failed         生成失败、退款已成功
--   refund_pending 生成失败/崩溃、退款尝试失败，cron 指数退避重试
--   refunded       崩溃补偿退款成功（区别于 failed：用户视角等价，审计区分来源）
--   created        预留（v1 路由扣费前不建行，暂不使用）
--
-- 安全：public 表 RLS deny-all（0024 模式）+ REVOKE anon/authenticated，
--       仅授 service_role（表 + 序列）——请求记录含 prompt 指纹等业务数据，
--       用户不可跨行读写（userClient 路径全部走 serverClient）。

CREATE TABLE IF NOT EXISTS ai_requests (
    id BIGSERIAL PRIMARY KEY,
    request_id VARCHAR(128) NOT NULL,
    user_uuid VARCHAR(64) NOT NULL,
    model VARCHAR(64) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    estimated_credits INT NOT NULL,
    body_fingerprint VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running'
        CHECK (status IN ('created', 'running', 'succeeded', 'failed', 'refund_pending', 'refunded')),
    input_tokens INT,
    output_tokens INT,
    error_message TEXT NOT NULL DEFAULT '',
    refund_attempts INT NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    completed_at timestamptz
);

-- P1-5：幂等键按用户隔离，不做全局 UNIQUE
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_requests_user_request ON ai_requests(user_uuid, request_id);
CREATE INDEX IF NOT EXISTS idx_ai_requests_user ON ai_requests(user_uuid, created_at);
-- 崩溃补偿扫描面：running（崩溃滞留）+ refund_pending（退款重试）
CREATE INDEX IF NOT EXISTS idx_ai_requests_recover
    ON ai_requests(status, updated_at)
    WHERE status IN ('running', 'refund_pending');

ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE ai_requests FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_requests TO service_role;
GRANT USAGE, SELECT ON SEQUENCE ai_requests_id_seq TO service_role;
