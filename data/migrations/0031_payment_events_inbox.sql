-- ============================================================
-- 0031 支付事件 Inbox（P1：webhook 先持久化再处理 + 幂等重放）
--
-- 缺口（docs/03 #10）：三渠道 webhook 到达后直接 handlePaymentEvent，
-- 处理失败（DB 闪断/进程崩溃）渠道重试是唯一恢复手段；且无原始事件存档，
-- 「远端成功但本地失败」只能靠人工对账。
--
-- 本批（docs/03 §payment_events 目标方案落地）：
-- 1. 三渠道 webhook 路由在 parseWebhook 验签后、handlePaymentEvent 之前
--    先 INSERT inbox（含 raw_body 原始存档），再处理；
-- 2. 处理成功置 processed；失败保留 pending + retry_count/last_error，
--    渠道重试同事件（幂等键命中）或每日 cron 重放兜底；
-- 3. 每日对账三规则（lib/webhook-inbox.ts reconcilePayments）：
--    a) 本地 paid 但 30 分钟无任何该单事件且 created 超时 —— 疑似漏单告警；
--    b) 处理失败（failed/pending 超限）事件清单告警；
--    c) 已处理事件金额与订单金额抽核（mismatch 已有 0010 兜底，此处归档口径）。
--
-- 幂等键：UNIQUE (provider, provider_event_id)。provider_event_id 按渠道取
--   Stripe= event.id / Creem= event.id（可选，缺省 fallback）/ Waffo= event.id（Pancake delivery UUID）；
--   渠道不回传 id 时 fallback = sha256(raw_body) 前 40 位（同 payload 重放仍幂等）。
--
-- 放 public schema：webhook 路由直插、admin 对账页直读；RLS deny-all +
-- REVOKE（0024 纵深防御同规），应用读写一律走 serverClient()（service_role）。
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(32) NOT NULL,               -- stripe / creem / waffo
  provider_event_id VARCHAR(256) NOT NULL,     -- 渠道事件 ID（或 raw_body hash fallback）
  event_type VARCHAR(64) NOT NULL,             -- 归一化类型（payment_succeeded 等）或 provider.*
  order_no VARCHAR(64) NOT NULL DEFAULT '',    -- 关联本地订单号（解析后回填）
  amount_cents INT,                            -- 事件金额（分）
  currency VARCHAR(10),
  raw_body JSONB NOT NULL,                     -- 原始 payload 存档（对账与审计依据）
  signature_verified BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'ignored')),
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_events_provider_event_unique UNIQUE (provider, provider_event_id)
);

COMMENT ON TABLE payment_events IS
  'P1 支付事件 inbox：webhook 先持久化再处理；UNIQUE(provider,provider_event_id) 幂等；每日 cron 重放 pending/failed + 三规则对账';

CREATE INDEX IF NOT EXISTS idx_payment_events_order ON payment_events (order_no);
CREATE INDEX IF NOT EXISTS idx_payment_events_status ON payment_events (status, created_at)
  WHERE status IN ('pending', 'failed', 'processing');

-- ============ 权限收口（0024 模式）============
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE payment_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE payment_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE payment_events_id_seq TO service_role;
