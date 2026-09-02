import { countUsers } from "@/models/user";
import { serverClient } from "@/models/db";

/**
 * 后台数据看板统计（6.6）
 * 指标：总用户/今日新增/总收入/今日订单/积分消耗/近7日活跃用户
 * 图表：30 天用户增长 / 30 天收入 / 30 天积分消耗趋势
 */
export async function getAdminStats() {
  // 后台统计跨用户读全表，走 service_role（serverClient），绕过 RLS（N-3）
  const supabase = serverClient();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  // 用户数
  const total_users = await countUsers();
  const { count: todayNewUsers } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayStart.toISOString());

  // 订单（N-13 收入确认口径：只认 paid——refunded/charged_back/disputed/
  // refund_requested/refund_blocked 均不得计入可确认收入，否则退款后看板虚增）
  const { data: paidOrders } = await supabase
    .from("orders")
    .select("created_at, amount")
    .eq("status", "paid");
  const { count: todayOrders } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "paid")
    .gte("created_at", todayStart.toISOString());

  const total_revenue = (paidOrders || []).reduce(
    (sum, o) => sum + (o.amount || 0),
    0
  );

  // 积分消耗（全部负数记录之和）
  const { data: negCredits } = await supabase
    .from("credits")
    .select("credits")
    .lt("credits", 0);
  const credits_consumed = (negCredits || []).reduce(
    (sum, c) => sum + Math.abs(c.credits),
    0
  );

  // 近 7 日活跃用户（7 天内有积分流水）
  const { data: activeCreditUsers } = await supabase
    .from("credits")
    .select("user_uuid")
    .gte("created_at", daysAgo(7));
  const active_users = new Set(
    (activeCreditUsers || []).map((c) => c.user_uuid)
  ).size;

  // 30 天趋势（JS 聚合）
  const dayKey = (iso: string) => iso.slice(0, 10);
  const last30 = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    last30.add(d.toISOString().slice(0, 10));
  }

  const { data: newUsers30 } = await supabase
    .from("users")
    .select("created_at")
    .gte("created_at", daysAgo(30));
  const userGrowthMap = new Map<string, number>();
  (newUsers30 || []).forEach((u) => {
    const k = dayKey(u.created_at);
    userGrowthMap.set(k, (userGrowthMap.get(k) || 0) + 1);
  });

  const { data: revenueOrders30 } = await supabase
    .from("orders")
    .select("created_at, amount")
    .eq("status", "paid")
    .gte("created_at", daysAgo(30));
  const revenueMap = new Map<string, number>();
  (revenueOrders30 || []).forEach((o) => {
    const k = dayKey(o.created_at);
    revenueMap.set(k, (revenueMap.get(k) || 0) + (o.amount || 0));
  });

  const { data: creditUsage30 } = await supabase
    .from("credits")
    .select("created_at, credits")
    .lt("credits", 0)
    .gte("created_at", daysAgo(30));
  const creditMap = new Map<string, number>();
  (creditUsage30 || []).forEach((c) => {
    const k = dayKey(c.created_at);
    creditMap.set(k, (creditMap.get(k) || 0) + Math.abs(c.credits));
  });

  return {
    total_users,
    today_new_users: todayNewUsers || 0,
    total_revenue,
    today_orders: todayOrders || 0,
    credits_consumed,
    active_users,
    user_growth_30d: [...last30].sort().map((date) => ({
      date,
      count: userGrowthMap.get(date) || 0,
    })),
    revenue_30d: [...last30].sort().map((date) => ({
      date,
      amount: revenueMap.get(date) || 0,
    })),
    credit_usage_30d: [...last30].sort().map((date) => ({
      date,
      credits: creditMap.get(date) || 0,
    })),
  };
}

export type AdminStats = Awaited<ReturnType<typeof getAdminStats>>;
