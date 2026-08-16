-- P-1.8 基础设施补齐：外键约束 + 高频查询索引
--
-- ⚠️ 适用于全新数据库（模板场景）：若已有历史数据且 user_uuid 含 '' 空串，
-- 添加外键前需先清理（DELETE FROM orders WHERE user_uuid = ''; 等）。

-- 外键约束
ALTER TABLE orders
  ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_uuid) REFERENCES users(uuid);
ALTER TABLE credits
  ADD CONSTRAINT fk_credits_user FOREIGN KEY (user_uuid) REFERENCES users(uuid);
ALTER TABLE apikeys
  ADD CONSTRAINT fk_apikeys_user FOREIGN KEY (user_uuid) REFERENCES users(uuid);
ALTER TABLE affiliates
  ADD CONSTRAINT fk_affiliates_user FOREIGN KEY (user_uuid) REFERENCES users(uuid);

-- 高频查询索引
CREATE INDEX IF NOT EXISTS idx_orders_user_uuid ON orders(user_uuid);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_order_no ON orders(order_no);

CREATE INDEX IF NOT EXISTS idx_credits_user_uuid ON credits(user_uuid);
CREATE INDEX IF NOT EXISTS idx_credits_expired_at ON credits(expired_at);
CREATE INDEX IF NOT EXISTS idx_credits_order_no ON credits(order_no);

CREATE INDEX IF NOT EXISTS idx_apikeys_user_uuid ON apikeys(user_uuid);
CREATE INDEX IF NOT EXISTS idx_apikeys_status ON apikeys(status);

CREATE INDEX IF NOT EXISTS idx_affiliates_user_uuid ON affiliates(user_uuid);
CREATE INDEX IF NOT EXISTS idx_affiliates_invited_by ON affiliates(invited_by);

CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
