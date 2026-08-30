import { respData, respErr } from "@/lib/resp";
import { metricsGuard } from "@/lib/metrics-auth";
import { getSupabaseClient } from "@/models/db";

/**
 * GET /api/metrics/events —— 运维事件流水（只读数据源，供飞书多维表格「数据接入」拉取）
 *
 * 事件来源：op_events 表（项目已有的运营事件底座，见 data/migrations/0014_op_events.sql），
 * 覆盖退款（payment.refund_processed）、支付告警（provider_unhealthy / provider_recovered /
 * provider_failure / amount_mismatch）等。直接读它，无需新造事件表。
 *
 * 安全：与 /api/metrics 相同，走 metricsGuard（METRICS_ACCESS_SECRET 鉴权 + 限流）。
 * 只读、不发出网请求。字段用通用英文名，可跨项目复用。
 *
 * Query 参数：
 *   days  - 拉最近 N 天（默认 7，上限 90）
 *   level - 按 severity 过滤（all|info|warn|error|critical，默认 all）
 *   limit - 最多返回条数（默认 200，上限 1000）
 *
 * 响应：{ site, generatedAt, events: [{ timestamp, type, level, source, subject, message }] }
 */
export async function GET(req: Request) {
  const blocked = await metricsGuard(req);
  if (blocked) return blocked;

  try {
    const url = new URL(req.url);
    const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "7", 10) || 7, 1), 90);
    const level = url.searchParams.get("level") || "all";
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 1000);

    const since = new Date(Date.now() - days * 86400000).toISOString();
    const supabase = getSupabaseClient();

    let query = supabase
      .from("op_events")
      .select("event_type, severity, source, subject_uuid, detail, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (level !== "all") {
      query = query.eq("severity", level);
    }

    const { data, error } = await query;
    if (error) throw error;

    const events = (data || []).map((e: any) => ({
      timestamp: e.created_at,
      type: e.event_type,
      level: e.severity,
      source: e.source,
      subject: e.subject_uuid || "",
      // 常见 detail 兼容：错误信息/金额等取前 200 字可读文本
      message: typeof e.detail === "object" && e.detail ? JSON.stringify(e.detail).slice(0, 500) : "",
    }));

    return respData({
      site: process.env.NEXT_PUBLIC_PROJECT_NAME || "default",
      generatedAt: new Date().toISOString(),
      events,
    });
  } catch (e: any) {
    console.error("[metrics/events] GET failed:", e);
    return respErr("metrics events query failed");
  }
}