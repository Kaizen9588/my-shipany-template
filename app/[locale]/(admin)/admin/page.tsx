import { getAdminStats } from "@/services/stats";
import {
  ChartCard,
  SimpleBarChart,
  SimpleLineChart,
  StatCard,
} from "@/components/dashboard/stats/charts";
import { getTranslations } from "next-intl/server";

/**
 * 后台数据看板（6.6）
 * 指标 + 30 天趋势图（用户增长 / 收入 / 积分消耗）
 */
export default async function AdminDashboard() {
  const t = await getTranslations("console");
  const stats = await getAdminStats();

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">{t("dashboard")}</h3>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard title="总用户数" value={stats.total_users} />
        <StatCard title="今日新增" value={stats.today_new_users} />
        <StatCard
          title="总收入"
          value={`$${(stats.total_revenue / 100).toFixed(2)}`}
        />
        <StatCard title="今日订单" value={stats.today_orders} />
        <StatCard title="积分消耗" value={stats.credits_consumed} />
        <StatCard title="7天活跃" value={stats.active_users} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="新增用户趋势（30天）">
          <SimpleLineChart data={stats.user_growth_30d} dataKey="count" />
        </ChartCard>
        <ChartCard title="收入趋势（30天，USD）">
          <SimpleBarChart
            data={stats.revenue_30d.map((r) => ({
              ...r,
              amount: r.amount / 100,
            }))}
            dataKey="amount"
            color="#10b981"
          />
        </ChartCard>
        <ChartCard title="积分消耗趋势（30天）">
          <SimpleBarChart
            data={stats.credit_usage_30d}
            dataKey="credits"
            color="#f59e0b"
          />
        </ChartCard>
      </div>
    </div>
  );
}
