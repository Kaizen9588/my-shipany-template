import { getSupabaseClient } from "@/models/db";

/**
 * GET /api/health —— 健康检查（6.16）
 * 服务降级：Supabase 宕机时 Landing Page 仍可展示（静态），
 * 登录/支付/控制台不可用，健康检查用于运维探活与降级提示。
 */
export async function GET() {
  const status = { ok: true, services: {} as Record<string, string> };

  // 检查 Supabase 连通性
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("users").select("id").limit(1);
    status.services.supabase = error ? "down" : "up";
    if (error) {
      status.ok = false;
    }
  } catch (e) {
    status.services.supabase = "down";
    status.ok = false;
  }

  return Response.json(status, { status: status.ok ? 200 : 503 });
}
