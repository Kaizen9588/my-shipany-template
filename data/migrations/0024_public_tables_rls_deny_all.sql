-- 第十批（2026-09-01）：public schema 全部业务表 RLS 全量启用（deny-all）
--
-- 背景：advisors 扫描发现 15 张 public 表 RLS 未启用
--   （affiliates, anonymous_usage, apikeys, audit_logs, creem_orders,
--     notifications, op_events, payment_products, payment_settings, posts,
--     schema_migrations, system_settings, users, verification_codes, waffo_orders），
--   并点名敏感列暴露（apikeys.api_key、waffo_orders.session_id）。
--   anon key 公开在浏览器可见，Data API（PostgREST / pg_graphql）对 public
--   schema 全表可读——此前这 15 张表对持有 anon key 的任何人完全敞开。
--
-- 设计依据（已核实代码事实，2026-09-01）：
--   1) 应用不存在 anon key / 浏览器端直连路径：无 createBrowserClient、
--      无 @supabase/ssr，userClient() 零调用点；全部读写经 Next.js 服务端
--      getSupabaseClient()，生产 SUPABASE_SERVICE_ROLE_KEY 为功能必填
--      （docs/08）→ 实际身份始终是 service_role（bypassrls，不受 RLS 影响）。
--   2) 应用不使用 Supabase Auth：会话由 NextAuth 自管（自有 JWT cookie），
--      用户身份（users.uuid）不在 Supabase JWT 中。任何 `uuid = auth.uid()`
--      型自访策略都不会命中——自访语义由服务端承担（session → uuid → 查询）。
--   因此正确策略是「全拒 + 服务端特权」：ENABLE RLS 且不建任何 policy，
--   anon/authenticated 全拒；与 0023 资金四表同 posture。
--   未来若接入 Supabase Auth 或 anon 直连，必须先显式设计策略并 GRANT
--   （fail-loud，而不是依赖 RLS 未启用时的静默放行）。
--
-- 表级 REVOKE 与 RLS 是独立的两层（纵深防御）：
--   RLS 逐行过滤；REVOKE 在权限层直接拒绝（含 pg_graphql 路径）。
--   即使未来有人误加宽松 policy，表权限仍然缺席，不会静默放开。

-- ============ 15 张 public 业务表：ENABLE RLS（deny-all，无策略）============

ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE apikeys            ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE anonymous_usage    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_products   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE creem_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE waffo_orders       ENABLE ROW LEVEL SECURITY;

-- ============ 表权限显式回收（anon / authenticated 无任何表权限）============

REVOKE ALL ON TABLE users              FROM anon, authenticated;
REVOKE ALL ON TABLE apikeys            FROM anon, authenticated;
REVOKE ALL ON TABLE affiliates         FROM anon, authenticated;
REVOKE ALL ON TABLE notifications      FROM anon, authenticated;
REVOKE ALL ON TABLE verification_codes FROM anon, authenticated;
REVOKE ALL ON TABLE anonymous_usage    FROM anon, authenticated;
REVOKE ALL ON TABLE payment_products   FROM anon, authenticated;
REVOKE ALL ON TABLE payment_settings   FROM anon, authenticated;
REVOKE ALL ON TABLE posts              FROM anon, authenticated;
REVOKE ALL ON TABLE system_settings    FROM anon, authenticated;
REVOKE ALL ON TABLE audit_logs         FROM anon, authenticated;
REVOKE ALL ON TABLE op_events          FROM anon, authenticated;
REVOKE ALL ON TABLE schema_migrations  FROM anon, authenticated;
REVOKE ALL ON TABLE creem_orders       FROM anon, authenticated;
REVOKE ALL ON TABLE waffo_orders       FROM anon, authenticated;

-- 0023 已对资金四表 ENABLE RLS（deny-all），但未回收表权限——
-- Supabase 默认特权会授予 anon/authenticated 全部表权限。在此一并回收，
-- 使全部 19 张 public 业务表的权限层与行级层同时收口。
REVOKE ALL ON TABLE credits            FROM anon, authenticated;
REVOKE ALL ON TABLE orders             FROM anon, authenticated;
REVOKE ALL ON TABLE refunds            FROM anon, authenticated;
REVOKE ALL ON TABLE credit_debts       FROM anon, authenticated;

-- ============ advisors WARN 收口：anonymous_usage 两个 RPC ============
-- 两函数仍在 public schema（demo 路由经 server 调用），但 public 函数经
-- Data API 对 anon 可枚举/可调用。anonymous_usage 表 RLS deny-all 后
-- SECURITY INVOKER 调用会在表层被拒，这里再把权限与 search_path 收口：
--   - EXECUTE 仅授 service_role（public schema 中不再有 anon 可调用对象）
--   - search_path 钉死，防同名对象劫持（advisors function_search_path_mutable）

ALTER FUNCTION public.increment_anonymous_usage(text, date, integer) SET search_path = public, extensions;
ALTER FUNCTION public.decrement_anonymous_usage(text, date) SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.increment_anonymous_usage(text, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decrement_anonymous_usage(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_anonymous_usage(text, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrement_anonymous_usage(text, date) TO service_role;

-- 说明：schema_migrations 被 lib/migrate.ts 经 DATABASE_URL（postgres 角色，
-- 表属主）读写，属主不受 RLS/REVOKE 影响，迁移链路不受本迁移影响。
