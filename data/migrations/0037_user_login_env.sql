-- 0037: 管理端用户画像字段（后台用户列表/详情/付费订单展示用）
-- 参照外部后台字段：设备(UA)/注册设备/最近登录设备、国家地区、支付成功时间、用户注册时间
-- 数据最小化：只存解析后的「设备类型 · OS」短语与 ISO 国家码，不存原始 UA；
-- 注册 IP 已有 users.signin_ip。users 表 RLS deny-all（0024）不受加列影响，
-- 运行时恒 service_role bypassrls 读写。

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS signup_device text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_device text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS country varchar(8);
