-- 第十二批（2026-09-02）：恢复固定默认管理员（产品决策，覆盖 0012/0019 时代的「无默认账号」策略）
--
-- 决策（用户 2026-09-02）：
--   默认管理员固定为 admin@shipany.local / 123456，明文不进仓库（bcrypt 哈希入库），
--   账号在首次完成强制改密前不可用（pending_activation + must_change_password）。
--   与历史 0012 的本质区别：0012 种入的是 active + 公开凭据直接可用的账号（P0-3 弱口令 No-Go）；
--   本迁移种入的是 **pending_activation + must_change_password=true**——公开凭据只能进入
--   一次性改密流程（/change-password），完成改密（8 位以上含字母数字）后账号才 active。
--   「谁先登谁改密」窗口仍存在，但：(a) 改密页/后台/控制台全部被 layout 守卫拦在改密之前；
--   (b) 该默认账号仅面向本地开发与自托管快速启动场景（见 README），生产部署者若不想要
--   默认管理员，可在迁移后执行 0027 反向清理段（见文件末尾注释）。
--
-- 与 0019 的关系：0019 只禁用「旧固定 hash」账号；本迁移写入的是新 hash，
-- 不会被 0019 误伤（幂等重跑也安全）。
--
-- 幂等：只在账号不存在、或处于 0019 禁用态（pending_activation 且 password_hash 为空）时写入；
-- 部署者已自行改密的账号（active / hash 非空且非本默认值）绝不触碰。

INSERT INTO users (
    uuid, email, nickname, avatar_url, locale, signin_type, signin_provider,
    invite_code, invited_by, is_affiliate, role, status, password_hash,
    password_updated_at, must_change_password, created_at, updated_at
)
SELECT
    '00000000-0000-4000-8000-000000000001',
    'admin@shipany.local',
    'admin',
    '',
    'en',
    'credentials',
    'credentials',
    '',
    '',
    false,
    'super_admin',
    'pending_activation',                        -- 完成首次强制改密后才转 active
    '$2b$12$PL2RCnUlrQYC9qFaquCyceE7HenyEsP2oIFd9IgbFfc2KFSFw0H2u', -- bcrypt(12) of the default password（明文见 README）
    now(),
    true,                                        -- 首次登录强制改密
    now(),
    now()
WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE email = 'admin@shipany.local'
       AND uuid = '00000000-0000-4000-8000-000000000001'
);

-- 0019 禁用态账号（pending_activation + 空 hash）恢复为「默认凭据 + 强制改密」，
-- 使升级用户也能使用本约定；部署者已改密的账号不命中（password_hash 非空）。
UPDATE users
SET
    status = 'pending_activation',
    password_hash = '$2b$12$PL2RCnUlrQYC9qFaquCyceE7HenyEsP2oIFd9IgbFfc2KFSFw0H2u',
    password_updated_at = now(),
    must_change_password = true,
    updated_at = now()
WHERE email = 'admin@shipany.local'
  AND uuid = '00000000-0000-4000-8000-000000000001'
  AND role = 'super_admin'
  AND status = 'pending_activation'
  AND password_hash IS NULL;

-- 生产部署者如不需要默认管理员，在迁移后执行：
--   DELETE FROM users WHERE email='admin@shipany.local' AND uuid='00000000-0000-4000-8000-000000000001';
-- 或在创建自己的管理员后禁用本账号（status='banned'）。
