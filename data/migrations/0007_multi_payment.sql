-- 6.1 多支付渠道：orders 补 payment_provider + 渠道专属表 + 支付设置种子
--
-- payment_settings / payment_products 已在迁移 0001 创建，这里补种子数据。
-- 渠道专属表见 docs/03-database-schema.md §渠道专属表。

-- 订单渠道字段（写入即冻结，切换渠道不影响存量订单）
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(50) DEFAULT 'stripe';

-- Creem 专属表
CREATE TABLE IF NOT EXISTS creem_orders (
    id SERIAL PRIMARY KEY,
    order_no VARCHAR(255) UNIQUE NOT NULL,      -- 关联 orders.order_no
    creem_checkout_id VARCHAR(255),
    creem_subscription_id VARCHAR(255),
    creem_payment_method VARCHAR(100),
    created_at timestamptz
);

-- Waffo 专属表
CREATE TABLE IF NOT EXISTS waffo_orders (
    id SERIAL PRIMARY KEY,
    order_no VARCHAR(255) UNIQUE NOT NULL,      -- 关联 orders.order_no
    acquiring_order_id VARCHAR(255),             -- Waffo 订单 ID
    payment_request_id VARCHAR(64),              -- 幂等键
    sub_id VARCHAR(255),                         -- 订阅 ID
    created_at timestamptz
);

-- 支付渠道启用状态种子（priority 小者优先 = 默认渠道）
-- Stripe 保持默认（已有集成不破坏）；Creem/Waffo 配置凭据后自动可用
INSERT INTO payment_settings (provider, enabled, priority, updated_at) VALUES
    ('stripe', true, 10, now()),
    ('creem',  true, 20, now()),
    ('waffo',  true, 30, now())
ON CONFLICT (provider) DO NOTHING;

-- 定价映射种子（与 data/pricing.ts 保持一致；creem_product_id 需在 Creem Dashboard 创建后回填）
INSERT INTO payment_products (product_id, amount, currency, credits, valid_months, created_at) VALUES
    ('starter',  9900, 'USD', 100, 1,  now()),
    ('standard', 19900, 'USD', 200, 3,  now()),
    ('premium',  29900, 'USD', 300, 12, now())
ON CONFLICT (product_id) DO NOTHING;
