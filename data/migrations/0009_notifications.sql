-- 6.14 站内通知中心（轮询 + SSE，不用 Supabase Realtime，见 DEVELOPMENT_PLAN 6.14）

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    uuid VARCHAR(255) UNIQUE NOT NULL,
    user_uuid VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'system',   -- payment / credit / system
    title VARCHAR(255) NOT NULL DEFAULT '',
    content TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_uuid, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
