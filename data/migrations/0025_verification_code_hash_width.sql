-- 修复（2026-09-01，RLS 批次回归发现）：verification_codes.code 列宽不足
--
-- 2.15 改造（round-7）把验证码改为只存 SHA-256 哈希（64 字符 hex），
-- models/verification.ts 的 insert 与 consume 均写/查 hashString(code)，
-- 但 0006 建表时 code 为 VARCHAR(10)（明文 6 位码时代）——迁移未同步。
-- 现象：send-verification 插入报 22001 value too long for varchar(10)，
-- 邮箱注册/密码重置全链路不可用（service_role 亦被列宽拒绝，与 RLS 无关）。
ALTER TABLE verification_codes ALTER COLUMN code TYPE VARCHAR(64);
