-- 运营事件日志底座（docs/16 §3.2）
-- 结构化运营事件，全量记录；后台 /admin/logs 检索 + 支付健康统计
CREATE TABLE IF NOT EXISTS op_events (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'info',
    source VARCHAR(50) NOT NULL DEFAULT 'app',
    subject_uuid VARCHAR(255) NOT NULL DEFAULT '',
    detail JSONB NOT NULL DEFAULT '{}',
    ip VARCHAR(255),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_op_events_type_time ON op_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_op_events_severity_time ON op_events(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_op_events_subject_time ON op_events(subject_uuid, created_at DESC);
