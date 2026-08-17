-- 默认管理员账号（模板开箱即用）
-- 登录邮箱：admin@shipany.local  初始密码：123456
-- 该账号 must_change_password = true，首次登录后强制修改密码。
-- 如需修改默认邮箱/密码，请直接编辑本文件后重新执行 pnpm migrate；
-- 生产部署后必须尽快登录并修改默认密码（见 README 安全说明）。

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

INSERT INTO users (
    uuid,
    email,
    nickname,
    avatar_url,
    locale,
    signin_type,
    signin_provider,
    invite_code,
    invited_by,
    is_affiliate,
    role,
    status,
    password_hash,
    password_updated_at,
    must_change_password,
    created_at
)
SELECT
    '00000000-0000-4000-8000-000000000001',
    'admin@shipany.local',
    'admin',
    '',
    'en',
    'credentials',
    'credentials',
    '',
    '',
    false,
    'super_admin',
    'active',
    '$2b$12$QX9rD.JoMxUZcDJ0v2k.OOgCheLCje7wT93pSXS9NTUv/2pRQrZVC',
    now(),
    true,
    now()
WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE email = 'admin@shipany.local'
);
