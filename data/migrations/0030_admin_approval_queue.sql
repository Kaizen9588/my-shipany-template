-- ============================================================
-- 0030 管理员审批队列（N-6 剩余：双人复核）
--
-- 高危后台操作（退款/调积分/改角色/封禁/支付渠道+定价）不再直接执行：
-- 先落 private.admin_approvals 审批单，由另一位管理员批准后执行。
--
-- 双人复核核心不变量（应用层 lib/admin-approval.ts 强制）：
--   approver_uuid <> requester_uuid —— 发起人不得批准自己的单据。
--
-- 单管理员豁免：提交时若不存在其他活跃管理员（role>=admin 且 active），
-- 单据直接置 approved（approver_uuid=''，approve_reason='single-admin mode'），
-- 随后内联执行——流程与审计统一，单管理员部署不死锁。
-- 双人复核保护要求生产部署配置 >= 2 个活跃管理员账号（见 docs/boundary-spec）。
--
-- 表放 private schema（与 op_event_outbox 同规）：Data API 默认不暴露，
-- 全部读写走 service_role（serverClient），无需额外 RPC；仍启用 RLS deny-all
-- + REVOKE 作纵深防御（0024 模式）。
--
-- 状态机：pending -> approved -> executing -> executed
--                          |             \-> failed（可重试，回到 executing）
--                          \-> rejected（终态）
--         executing 超 5 分钟视为执行进程崩溃残留，允许重新占用（应用层回收）。
-- ============================================================

CREATE TABLE IF NOT EXISTS private.admin_approvals (
  id BIGSERIAL PRIMARY KEY,
  action VARCHAR(50) NOT NULL,             -- refund | adjust_credits | user_role | user_status | payment_settings
  required_level VARCHAR(20) NOT NULL DEFAULT 'admin',  -- 批准/执行所需最低角色级别
  target_type VARCHAR(50) NOT NULL DEFAULT '',  -- order | user | config
  target_uuid VARCHAR(255) NOT NULL DEFAULT '', -- order_no / user uuid / product_id / ''
  payload JSONB NOT NULL DEFAULT '{}',     -- 执行参数快照（服务端写入，执行时重新校验）
  reason TEXT NOT NULL,                    -- 发起人理由（parseReason 5~200）
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','executing','executed','failed','cancelled')),
  requester_uuid VARCHAR(255) NOT NULL,
  requester_email VARCHAR(255) NOT NULL DEFAULT '',
  approver_uuid VARCHAR(255) NOT NULL DEFAULT '',
  approver_email VARCHAR(255) NOT NULL DEFAULT '',
  approve_reason TEXT NOT NULL DEFAULT '',
  exec_error TEXT NOT NULL DEFAULT '',     -- 最近一次执行失败原因（LEFT 500）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE private.admin_approvals IS
  'N-6 管理员高危操作审批队列：双人复核（approver<>requester），单管理员部署自动降级 approved 并留痕';

-- 待办/待重试队列索引（低频人工操作，partial 即可）
CREATE INDEX IF NOT EXISTS idx_admin_approvals_open
  ON private.admin_approvals (status, created_at DESC)
  WHERE status IN ('pending', 'approved', 'failed');

-- 发起人历史查询（本人可见自己的单据进度）
CREATE INDEX IF NOT EXISTS idx_admin_approvals_requester
  ON private.admin_approvals (requester_uuid, created_at DESC);

-- ============ 权限收口（0024 纵深防御模式）============
ALTER TABLE private.admin_approvals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.admin_approvals FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.admin_approvals TO service_role;
GRANT USAGE, SELECT ON SEQUENCE private.admin_approvals_id_seq TO service_role;
