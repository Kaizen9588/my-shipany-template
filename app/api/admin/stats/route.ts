import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { getAdminStats } from "@/services/stats";

/**
 * GET /api/admin/stats —— 后台数据看板统计（6.6）
 */
export async function GET() {
  try {
    await requireAdmin();
    const stats = await getAdminStats();
    return respData(stats);
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/stats] failed:", e);
    return respErr("get stats failed");
  }
}
