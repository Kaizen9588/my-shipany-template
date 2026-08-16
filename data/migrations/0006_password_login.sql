-- 6.4 邮箱密码登录：验证码表 + users 密码字段
-- 见 DEVELOPMENT_PLAN 6.4 与 docs/04-auth-flow.md

CREATE TABLE IF NOT EXISTS verification_codes (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    code VARCHAR(10) NOT NULL,
    expired_at timestamptz NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email);

-- 密码登录（OAuth 用户为 NULL）
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_at timestamptz;
