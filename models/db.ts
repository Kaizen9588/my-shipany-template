import { createClient, SupabaseClient } from "@supabase/supabase-js";

// P-1.8 问题 2：模块级单例，避免每次调用新建 HTTP 连接池
let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) {
    return client;
  }

  const supabaseUrl = process.env.SUPABASE_URL || "";

  let supabaseKey = process.env.SUPABASE_ANON_KEY || "";
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  }

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase URL or key is not set");
  }

  client = createClient(supabaseUrl, supabaseKey);

  return client;
}
