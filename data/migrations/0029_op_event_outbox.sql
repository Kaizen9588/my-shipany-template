-- N-4：运营事件 Transactional Outbox（docs/16 §3.3 目标方案，2026-09-01 连库执行）
--
-- 背景（boundary-spec N-4）：recordOpEvent 对 op_events 是 fire-and-forget 异步插入、
-- 吞错——数据库闪断 / 进程崩溃 / after() 窗口异常都会让关键事件（支付、退款、调账、
-- webhook 伪造告警等）永久丢失，与「全量不能丢」的审计要求冲突。第七批的
-- runAfterResponse 只解决「有没有开始跑」（P1-A 调度），不提供持久化重试（N-4 持久化）。
--
-- 本迁移（与 0023 同规：对象全部进 private schema，Data API 默认不可达）：
-- 1. op_events 加 event_id UUID 列 + 部分唯一索引——投递幂等键：
--    重试 / 多 worker 并发投递时 ON CONFLICT DO NOTHING，绝不重复落库
-- 2. private.op_event_outbox 队列表：
--    status: pending（待投递）→ processing（已领取）→ 删除（ack 成功）/ dead（超限死信）
--    attempts/max_attempts + last_error + available_at（指数退避重试）
-- 3. 六个 RPC（REVOKE PUBLIC/anon/authenticated，仅授 service_role）：
--    - op_event_outbox_enqueue：入队（关键事件持久化入口，返回 event_id）
--    - op_event_outbox_claim：FOR UPDATE SKIP LOCKED 原子领取
--      （pending 且到期 + processing 超 stale 分钟的崩溃残留行一并回收）
--    - op_event_deliver：幂等落库 op_events（返回是否新插入）
--    - op_event_outbox_ack：投递成功删除队列行（op_events 本身是持久记录）
--    - op_event_outbox_fail：指数退避（2^n 分钟，封顶 1h），超 max_attempts 置 dead
--    - op_event_outbox_cleanup：清理 dead 行（每日 cron 调用）
-- 4. 表 ENABLE RLS（deny-all）+ REVOKE：纵深防御，访问只走 service_role
--
-- 应用侧（lib/oplog.ts）：warn/error/critical 级事件入队（关键事件三连载体），
-- info 级维持直插（docs/16 §3.3：非关键事件可 fire-and-forget）；入队成功即视为
-- 已持久化，投递由本轮内联 dispatch + 后续事件顺带 + 每日 cron 兜底完成；告警外呼
-- 移到落库成功之后（告警渠道故障不再连累事件本身）。入队失败退回旧直插路径。

-- ============ 1. op_events 投递幂等键 ============
ALTER TABLE public.op_events ADD COLUMN IF NOT EXISTS event_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_op_events_event_id
    ON public.op_events (event_id) WHERE event_id IS NOT NULL;

-- ============ 2. outbox 队列表（private，Data API 默认不可达）============
CREATE TABLE IF NOT EXISTS private.op_event_outbox (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'info'
        CONSTRAINT op_event_outbox_severity_check
        CHECK (severity IN ('info', 'warn', 'error', 'critical')),
    source VARCHAR(50) NOT NULL DEFAULT 'app',
    subject_uuid VARCHAR(255) NOT NULL DEFAULT '',
    detail JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CONSTRAINT op_event_outbox_status_check
        CHECK (status IN ('pending', 'processing', 'dead')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 8,
    last_error TEXT NOT NULL DEFAULT '',
    available_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- 领取查询主索引：pending 且到期（部分索引，队列持续消费后残表很小）
CREATE INDEX IF NOT EXISTS idx_op_event_outbox_claim
    ON private.op_event_outbox (available_at, id) WHERE status = 'pending';
-- stale processing 回收扫描索引（worker 领取后崩溃的残留行）
CREATE INDEX IF NOT EXISTS idx_op_event_outbox_stale
    ON private.op_event_outbox (updated_at) WHERE status = 'processing';

-- deny-all（纵深防御；访问只走 service_role RPC，owner 经迁移读写）
ALTER TABLE private.op_event_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.op_event_outbox FROM PUBLIC;
REVOKE ALL ON TABLE private.op_event_outbox FROM anon, authenticated;
-- SECURITY INVOKER RPC 以调用方（service_role）身份执行，需要表权限：
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.op_event_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE private.op_event_outbox_id_seq TO service_role;

-- ============ 3. op_event_outbox_enqueue：入队（warn+ 事件持久化入口）============
-- 入队即可靠性达成点：INSERT 成功 = 事件已持久化，投递交给 claim/deliver。
CREATE OR REPLACE FUNCTION private.op_event_outbox_enqueue(
  p_event_type TEXT,
  p_severity TEXT,
  p_source TEXT,
  p_subject_uuid TEXT,
  p_detail JSONB
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = private, public, extensions
AS $$
DECLARE
  v_id UUID := gen_random_uuid();
BEGIN
  IF p_severity NOT IN ('info', 'warn', 'error', 'critical') THEN
    RAISE EXCEPTION 'invalid severity: %', p_severity;
  END IF;
  INSERT INTO private.op_event_outbox
    (event_id, event_type, severity, source, subject_uuid, detail)
  VALUES
    (v_id, p_event_type, p_severity, p_source, p_subject_uuid,
     COALESCE(p_detail, '{}'::jsonb));
  RETURN v_id;
END $$;

-- ============ 4. op_event_outbox_claim：原子领取 ============
-- FOR UPDATE SKIP LOCKED：多实例并发领取互不等待（队列标准模式）；
-- processing 超过 p_stale_minutes 的行视为 worker 崩溃残留，一并回收重投
-- （deliver 幂等保证重投不重复落库）。
CREATE OR REPLACE FUNCTION private.op_event_outbox_claim(
  p_batch_size INT DEFAULT 10,
  p_stale_minutes INT DEFAULT 10
)
RETURNS TABLE (
  id BIGINT,
  event_id UUID,
  event_type VARCHAR(100),
  severity VARCHAR(20),
  source VARCHAR(50),
  subject_uuid VARCHAR(255),
  detail JSONB,
  attempts INT
)
LANGUAGE plpgsql
SET search_path = private, public, extensions
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT t.id
    FROM private.op_event_outbox t
    WHERE (t.status = 'pending' AND t.available_at <= now())
       OR (t.status = 'processing'
           AND t.updated_at < now() - make_interval(mins => GREATEST(p_stale_minutes, 1)))
    ORDER BY t.id
    LIMIT GREATEST(p_batch_size, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE private.op_event_outbox o
  SET status = 'processing',
      attempts = o.attempts + 1,
      updated_at = now()
  FROM claimed c
  WHERE o.id = c.id
  RETURNING o.id, o.event_id, o.event_type, o.severity, o.source,
            o.subject_uuid, o.detail, o.attempts;
END $$;

-- ============ 5. op_event_deliver：幂等落库 op_events ============
-- 返回是否新插入：False = 幂等命中（此前重试已落库），调用方照常 ack。
CREATE OR REPLACE FUNCTION private.op_event_deliver(
  p_event_id UUID,
  p_event_type TEXT,
  p_severity TEXT,
  p_source TEXT,
  p_subject_uuid TEXT,
  p_detail JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = private, public, extensions
AS $$
BEGIN
  INSERT INTO public.op_events
    (event_type, severity, source, subject_uuid, detail, event_id)
  VALUES
    (p_event_type, p_severity, p_source, p_subject_uuid,
     COALESCE(p_detail, '{}'::jsonb), p_event_id)
  ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING;
  RETURN FOUND;
END $$;

-- ============ 6. op_event_outbox_ack：投递成功删除队列行 ============
CREATE OR REPLACE FUNCTION private.op_event_outbox_ack(p_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = private, public, extensions
AS $$
BEGIN
  DELETE FROM private.op_event_outbox WHERE id = p_id AND status = 'processing';
END $$;

-- ============ 7. op_event_outbox_fail：指数退避重试 / 死信 ============
-- 退避 2^attempts 分钟（封顶 1h）；超 max_attempts 置 dead（可见可查，不静默丢）。
CREATE OR REPLACE FUNCTION private.op_event_outbox_fail(p_id BIGINT, p_error TEXT DEFAULT '')
RETURNS VOID
LANGUAGE plpgsql
SET search_path = private, public, extensions
AS $$
BEGIN
  UPDATE private.op_event_outbox
  SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
      last_error = LEFT(COALESCE(p_error, ''), 500),
      available_at = now() + LEAST(
        make_interval(mins => POWER(2, LEAST(attempts, 6))::int),
        INTERVAL '1 hour'
      ),
      updated_at = now()
  WHERE id = p_id AND status = 'processing';
END $$;

-- ============ 8. op_event_outbox_cleanup：清理死信 ============
CREATE OR REPLACE FUNCTION private.op_event_outbox_cleanup(p_retain_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SET search_path = private, public, extensions
AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  DELETE FROM private.op_event_outbox
  WHERE status = 'dead'
    AND updated_at < now() - make_interval(days => GREATEST(p_retain_days, 1));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;

-- ============ 9. 权限收口：REVOKE + 仅授 service_role（与 0023/0028 同规）============
REVOKE ALL ON FUNCTION private.op_event_outbox_enqueue(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.op_event_outbox_enqueue(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION private.op_event_outbox_claim(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.op_event_outbox_claim(INT, INT) TO service_role;

REVOKE ALL ON FUNCTION private.op_event_deliver(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.op_event_deliver(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION private.op_event_outbox_ack(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.op_event_outbox_ack(BIGINT) TO service_role;

REVOKE ALL ON FUNCTION private.op_event_outbox_fail(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.op_event_outbox_fail(BIGINT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION private.op_event_outbox_cleanup(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.op_event_outbox_cleanup(INT) TO service_role;
