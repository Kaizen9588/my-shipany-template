import { requireAdmin } from "@/lib/auth";
import { getPaymentSettings } from "@/models/payment";
import { getProviderHealthSnapshot } from "@/lib/payment/health";
import { aggregatePaymentEvents } from "@/lib/oplog";
import PaymentSettingsForm from "./payment-form";

/**
 * 后台支付渠道管理（docs/16 §4.2b）
 * - 渠道卡片：启用开关 + priority（数据库热切换，无需重部署）
 * - 定价映射：金额（分）/ 积分 / 有效期 / 渠道产品 ID
 */
export default async function PaymentAdminPage() {
  await requireAdmin();

  const [settingMap, stats24h, health] = await Promise.all([
    getPaymentSettings(),
    aggregatePaymentEvents(24),
    Promise.resolve(getProviderHealthSnapshot()),
  ]);

  const settings = Object.values(settingMap);

  const healthRows = Object.keys(settingMap).map((provider) => {
    const h = health[provider];
    const unhealthyUntil = h?.unhealthyUntil || 0;
    const minutesLeft = unhealthyUntil > Date.now()
      ? Math.ceil((unhealthyUntil - Date.now()) / 60000)
      : 0;
    const stat = stats24h[provider] || { success: 0, failed: 0 };
    const hasData = !!h || stat.success > 0 || stat.failed > 0;
    const status = unhealthyUntil > Date.now()
      ? `unhealthy（${minutesLeft} 分钟后恢复）`
      : hasData
        ? "正常"
        : "暂无调用数据";
    return {
      provider,
      status,
      healthy: unhealthyUntil <= Date.now(),
      hasData,
      success: stat.success,
      failed: stat.failed,
    };
  });

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">支付渠道管理</h3>
      <p className="text-sm text-muted-foreground">
        这里保存即为热切换：Checkout 路由实时按 <code>payment_settings</code>{" "}
        的启用状态和优先级选择渠道，无需重启服务。
      </p>
      <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        <strong>关于健康状态：</strong>
        判定来源是“最近 24h 本服务对 checkout 调用的成败统计”（内存计数），并
        非对渠道的实时外部探活。只有发生过调用的渠道才会出现累计计数；标记为
        “暂无调用数据”不代表渠道不可用。若需要真实探活，请在代码中接入渠道
        提供的健康检查接口（当前模板未内置）。
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-3">渠道</th>
              <th>健康状态</th>
              <th>24h 成功</th>
              <th>24h 失败</th>
            </tr>
          </thead>
          <tbody>
            {healthRows.map((r) => (
              <tr key={r.provider} className="border-b">
                <td className="p-3">{r.provider}</td>
                <td
                  className={
                    r.healthy
                      ? r.hasData
                        ? "text-green-600"
                        : "text-muted-foreground"
                      : "text-red-600"
                  }
                >
                  {r.status}
                </td>
                <td>{r.success}</td>
                <td>{r.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PaymentSettingsForm settings={settings} />
    </div>
  );
}
