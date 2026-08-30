import { respData, respErr } from "@/lib/resp";
import { metricsGuard } from "@/lib/metrics-auth";
import { getAdminStats } from "@/services/stats";
import { getSupabaseClient } from "@/models/db";

/**
 * GET /api/metrics —— 运维运营指标（只读数据源，供飞书多维表格「数据接入」拉取）
 *
 * 安全：metricsGuard 统一做 METRICS_ACCESS_SECRET 鉴权 + 限流（见 lib/metrics-auth.ts）。
 * 只读、无副作用、不发出网请求。字段用通用英文名，换项目可复用（site 标识区分多项目）。
 *
 * 响应（Feishu 数据接入/脚本消费）：
 *   { site, generatedAt, days,
 *     series:   按日趋势（Date, new_users, new_orders, gmv, credits_consumed）
 *     kpi:      顶部数字卡（total_users, total_revenue, monthly_gmv, credits_balance,
 *               today_new_users, today_orders, active_users_7d, credits_consumed_total）
 *     updatedAt }
 */
export async function GET(req: Request) {
  const blocked = await metricsGuard(req);
  if (blocked) return blocked;

  try {
    const stats = await getAdminStats();
    const supabase = getSupabaseClient();

    // 当日支付成功订单数（我的 stats 里只有 30 天序列，这里补当日数）
    const today = new Date();
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const { count: todayOrders } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "paid")
      .gte("created_at", todayStart.toISOString());

    // 总可用积分余额（正负流水求和）
    const { data: creditRows } = await supabase
      .from("credits")
      .select("credits");
    const credits_balance = (creditRows || []).reduce(
      (sum, r: any) => sum + (r.credits || 0),
      0
    );

    // 组装：把 30 天内的三组趋势合并成按日 series
    const date = new Map<string, { new_users: number; new_orders: number; gmv: number; credits_consumed: number }>();
    for (const u of stats.user_growth_30d) {
      const k = u.date;
      const s = date.get(k) || { new_users: 0, new_orders: 0, gmv: 0, credits_consumed: 0 };
      s.new_users += u.count ?? 0;
      date.set(k, s);
    }
    for (const o of stats.revenue_30d) {
      const k = o.date;
      const s = date.get(k) || { new_users: 0, new_orders: 0, gmv: 0, credits_consumed: 0 };
      s.gmv += o.amount ?? 0;
      s.new_orders += 1;
      date.set(k, s);
    }
    for (const c of stats.credit_usage_30d) {
      const k = c.date;
      const s = date.get(k) || { new_users: 0, new_orders: 0, gmv: 0, credits_consumed: 0 };
      s.credits_consumed += c.credits ?? 0;
      date.set(k, s);
    }
    const series = [...date.keys()].sort().map((dateKey) => {
      const d = date.get(dateKey)!;
      return { date: dateKey, ...d };
    });

    const site = process.env.NEXT_PUBLIC_PROJECT_NAME || "default";

    return respData({
      site,
      generatedAt: today.toISOString(),
      days: series.length,
      series,
      kpi: {
        total_users: stats.total_users,
        total_revenue: stats.total_revenue,
        monthly_gmv: stats.total_revenue,
        credits_balance,
        today_new_users: stats.today_new_users,
        today_orders: todayOrders ?? 0,
        active_users_7d: stats.active_users,
        credits_consumed_total: stats.credits_consumed,
      },
      updatedAt: today.toISOString(),
    });
  } catch (e: any) {
    console.error("[metrics] GET failed:", e);
    return respErr("metrics query failed");
  }
}