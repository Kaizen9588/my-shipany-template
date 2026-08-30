import { createClient, SupabaseClient } from "@supabase/supabase-js";

//
// N-3 客户端分离（2026-08-30）
//
// 此前唯一的 getSupabaseClient() 用 anon key 创建，但一旦配置了
// SUPABASE_SERVICE_ROLE_KEY 就静默升级为 service_role —— 所有调用方（含终端用户
// 触发的路径）都被隐式切成特权客户端，绕过 RLS，且 service key 有泄漏面。
// docs/boundary-spec N-3 / docs/03：「服务端与客户端 client 必须分离」。
//
// 现在拆成两个显式入口：
//   - serverClient()：service_role，仅受控服务端特权路径（支付/退款/积分/后台/admin RPC），
//     绕 RLS。未配置 service key 时抛错，绝不用 anon 静默冒充特权。
//   - userClient()：anon，随用户请求走 RLS，永不使用 service_role。
//
// getSupabaseClient() 保留为历史兼容入口，语义不变（anon，且仅在显式配置
// service key 时升级）——避免一次性大规模迁移调用方破坏未设 service key 的
// 仅 Landing 部署。新代码应改用 serverClient / userClient 之一。

let server: SupabaseClient | null = null;
let user: SupabaseClient | null = null;

function createOrThrow(
  slot: () => SupabaseClient | null,
  set: (c: SupabaseClient) => void,
  keyName: string
): SupabaseClient {
  const existing = slot();
  if (existing) {
    return existing;
  }
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseKey = process.env[keyName] || "";
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(`Supabase ${keyName} client is not configured`);
  }
  const client = createClient(supabaseUrl, supabaseKey);
  set(client);
  return client;
}

/** 服务端特权客户端（service_role，绕 RLS），仅限受控服务端路径。 */
export function serverClient(): SupabaseClient {
  return createOrThrow(
    () => server,
    (c) => (server = c),
    "SUPABASE_SERVICE_ROLE_KEY"
  );
}

/** 用户态客户端（anon，随用户请求走 RLS），永不使用 service_role。 */
export function userClient(): SupabaseClient {
  return createOrThrow(
    () => user,
    (c) => (user = c),
    "SUPABASE_ANON_KEY"
  );
}

/**
 * @deprecated 历史兼容入口。语义与旧版一致：sar 用 anon，配置了
 * SUPABASE_SERVICE_ROLE_KEY 时仍会升级为 service_role。新代码应显式选择
 * serverClient() / userClient()，不要依赖本函数的隐式升级。
 */
export function getSupabaseClient(): SupabaseClient {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return serverClient();
  }
  return userClient();
}