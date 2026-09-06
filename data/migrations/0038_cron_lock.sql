-- 0038: cron 单实例锁（docs/16 §cron 运维加固）
-- 多实例部署下 /api/cron/daily 可能并发执行，造成重复备份/重复对账等。
-- 用「租约锁」语义：try_acquire_cron_lock 原子 upsert，仅当上次租约过期
-- （locked_at < now() - ttl）时才拿到；执行完显式 release，崩溃残留由 TTL 兜底。
-- private schema + RLS deny-all + 仅授 service_role（0023/0024 同规）。

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.cron_locks (
  key text PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.cron_locks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON private.cron_locks FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.cron_locks TO service_role;

CREATE OR REPLACE FUNCTION private.try_acquire_cron_lock(
  p_key text,
  p_ttl_seconds int
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = private
AS $$
  INSERT INTO private.cron_locks (key, locked_at)
  VALUES (p_key, now())
  ON CONFLICT (key) DO UPDATE
    SET locked_at = now()
    WHERE private.cron_locks.locked_at < now() - make_interval(secs => p_ttl_seconds)
  RETURNING true;
$$;

CREATE OR REPLACE FUNCTION private.release_cron_lock(p_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = private
AS $$
  DELETE FROM private.cron_locks WHERE key = p_key;
$$;

REVOKE ALL ON FUNCTION private.try_acquire_cron_lock(text, int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.release_cron_lock(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.try_acquire_cron_lock(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION private.release_cron_lock(text) TO service_role;
