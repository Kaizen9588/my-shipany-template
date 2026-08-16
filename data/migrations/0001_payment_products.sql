-- P-1.1 定价架构修复：支付配置表（热切换与定价映射）
-- 见 docs/03-database-schema.md「支付配置表（热切换与定价映射）」

-- 渠道启用状态（热切换的根基：配置数据库化，不依赖环境变量）
CREATE TABLE IF NOT EXISTS payment_settings (
    id SERIAL PRIMARY KEY,
    provider VARCHAR(50) UNIQUE NOT NULL,       -- 'creem' / 'waffo' / 'stripe' / 'paypal'
    enabled BOOLEAN NOT NULL DEFAULT true,
    priority INT NOT NULL DEFAULT 100,          -- 路由优先级（小者优先，priority 最小 = 默认渠道）
    updated_at timestamptz
);

-- 定价映射（兼容预建产品 Creem 与动态金额 Waffo/Stripe 两种模式）
-- ⚠️ v1 保持单表；阶段 2 加 Stripe/PayPal 时拆为 payment_products + channel_products（见 docs/12 遗留项跟踪表）
CREATE TABLE IF NOT EXISTS payment_products (
    id SERIAL PRIMARY KEY,
    product_id VARCHAR(50) UNIQUE NOT NULL,     -- 'starter' / 'standard' / 'premium'
    amount INT NOT NULL,                         -- 分（含税价）
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    credits INT NOT NULL,
    valid_months INT NOT NULL,
    creem_product_id VARCHAR(255),               -- Creem 预建产品 ID（可空）
    stripe_price_id VARCHAR(255),                -- Stripe 预建 price（可空）
    created_at timestamptz
);
