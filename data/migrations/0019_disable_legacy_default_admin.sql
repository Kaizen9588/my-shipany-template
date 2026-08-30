-- P0-3：撤销历史迁移 0012 写入的公开默认超级管理员。
-- 只命中原始固定 bcrypt hash；部署者已自行修改密码的账号不会受影响。
UPDATE users
SET
    status = 'pending_activation',
    password_hash = NULL,
    password_updated_at = now(),
    must_change_password = true,
    updated_at = now()
WHERE email = 'admin@shipany.local'
  AND role = 'super_admin'
  AND password_hash = '$2b$12$QX9rD.JoMxUZcDJ0v2k.OOgCheLCje7wT93pSXS9NTUv/2pRQrZVC';
