import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { queryOpEvents } from "@/lib/oplog";

/**
 * GET /api/admin/op-events —— 运营事件检索（docs/16 §3.4）
 * 参数：event_type / severity / subject / page / limit
 */
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const params = {
      event_type: url.searchParams.get("event_type") || undefined,
      severity: url.searchParams.get("severity") || undefined,
      subject: url.searchParams.get("subject") || undefined,
      page: parseInt(url.searchParams.get("page") || "1", 10) || 1,
      limit: parseInt(url.searchParams.get("limit") || "50", 10) || 50,
    };
    const result = await queryOpEvents(params);
    return respData(result);
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/op-events] failed:", e);
    return respErr("query op events failed");
  }
}
