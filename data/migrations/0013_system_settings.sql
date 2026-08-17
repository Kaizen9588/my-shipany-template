-- 系统配置表（后台可热更新的键值配置）
-- v1 用于：飞书/企微机器人告警 webhook + 通知最低级别
-- 后台 /admin/notify 可读写；未写入时自动回退环境变量（FEISHU_WEBHOOK_URL 等）
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at timestamptz DEFAULT now()
);

INSERT INTO system_settings (key, value, updated_at) VALUES
    ('feishu_webhook_url', '', now()),
    ('feishu_secret', '', now()),
    ('wecom_webhook_url', '', now()),
    ('notify_min_severity', 'warn', now())
ON CONFLICT (key) DO NOTHING;
