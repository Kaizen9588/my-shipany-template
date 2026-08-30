-- P0-3：只提供首次改密字段，不在迁移中写入任何公开默认管理员。
-- 初始管理员仅由 lib/bootstrap-admin.ts 在显式设置 ADMIN_BOOTSTRAP_EMAIL 时创建；
-- 生产环境未配置该变量时绝不建号。

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
