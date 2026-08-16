import { getAdminStats } from "@/services/stats";
import {
  ChartCard,
  SimpleBarChart,
  SimpleLineChart,
  StatCard,
} from "@/components/dashboard/stats/charts";

/**
 * 后台数据看板（6.6）
 * 指标 + 30 天趋势图（用户增长 / 收入 / 积分消耗）
 */
export default async function AdminDashboard() {
  const stats = await getAdminStats();

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">Dashboard</h3>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard title="Total Users" value={stats.total_users} />
        <StatCard title="New Today" value={stats.today_new_users} />
        <StatCard
          title="Total Revenue"
          value={`$${(stats.total_revenue / 100).toFixed(2)}`}
        />
        <StatCard title="Orders Today" value={stats.today_orders} />
        <StatCard title="Credits Used" value={stats.credits_consumed} />
        <StatCard title="Active (7d)" value={stats.active_users} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="User Growth (30d)">
          <SimpleLineChart data={stats.user_growth_30d} dataKey="count" />
        </ChartCard>
        <ChartCard title="Revenue (30d, USD)">
          <SimpleBarChart
            data={stats.revenue_30d.map((r) => ({
              ...r,
              amount: r.amount / 100,
            }))}
            dataKey="amount"
            color="#10b981"
          />
        </ChartCard>
        <ChartCard title="Credit Usage (30d)">
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
