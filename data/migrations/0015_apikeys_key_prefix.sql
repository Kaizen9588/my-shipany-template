-- 对抗性测试修复（2026-08-17）：apikeys 表缺 key_prefix 列
--
-- 问题：api-keys/actions.ts 创建 API Key 时写入 key_prefix（明文前 8 位用于列表展示），
-- 但 0000 基线表没有该列 -> PostgREST 42703 (column does not exist)，API Key 创建功能完全不可用。
--
-- 修复：补列 + 用户维度索引（列表按 user_uuid 查询）。

ALTER TABLE apikeys
  ADD COLUMN IF NOT EXISTS key_prefix varchar(8);

CREATE INDEX IF NOT EXISTS idx_apikeys_user_uuid ON apikeys (user_uuid);
