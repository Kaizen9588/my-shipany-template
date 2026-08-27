-- 0018: Waffo Pancake 迁移（2026-08，@waffo/waffo-node → @waffo/pancake-ts）
-- 背景：docs/payment/waffo-operations-guide.md 路线 B（整体替换为新代 SDK）
-- 1) Pancake 为预建产品模型：checkout 只传 productId，金额真相在渠道目录，
--    需为每个定价映射回填 Waffo Product ID（后台 /admin/pricing 可改）
ALTER TABLE payment_products
    ADD COLUMN IF NOT EXISTS waffo_product_id VARCHAR(255);

-- 2) waffo_orders 增列：Pancake checkout 返回 session 而非订单，Waffo 订单 ID
--    要等 order.completed webhook 才落地；session 默认 45 分钟过期
ALTER TABLE waffo_orders
    ADD COLUMN IF NOT EXISTS session_id VARCHAR(255);
ALTER TABLE waffo_orders
    ADD COLUMN IF NOT EXISTS checkout_expires_at timestamptz;

COMMENT ON COLUMN payment_products.waffo_product_id IS 'Waffo Pancake 预建产品 ID（PROD_/SUB_，需已 publish）';
COMMENT ON COLUMN waffo_orders.session_id IS 'Pancake checkout session ID（cs 元数据锚点之一）';
COMMENT ON COLUMN waffo_orders.checkout_expires_at IS 'Pancake 收银会话过期时间（默认 45 分钟）';

-- 凭据变更说明（不改表结构）：WAFFO_API_KEY / WAFFO_PUBLIC_KEY 废弃，
-- 仅保留 WAFFO_MERCHANT_ID + WAFFO_PRIVATE_KEY（或 WAFFO_PRIVATE_KEY_BASE64）
