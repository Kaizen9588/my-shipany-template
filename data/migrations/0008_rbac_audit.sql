-- 6.10 RBAC 权限系统：users.role 字段 + 操作审计日志表（6.20 的最小前置）

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user';
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 操作审计日志（6.7/6.9 后台操作记录；完整审计系统见 6.20）
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    admin_uuid VARCHAR(255) NOT NULL DEFAULT '',
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL DEFAULT '',
    target_uuid VARCHAR(255) NOT NULL DEFAULT '',
    detail TEXT,
    ip VARCHAR(255),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
