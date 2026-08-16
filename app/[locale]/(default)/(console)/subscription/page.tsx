import { getSupabaseClient } from "@/models/db";
import { getUserUuid } from "@/services/user";
import Empty from "@/components/blocks/empty";
import moment from "moment";

/**
 * 订阅管理（6.12）
 * v1 主推一次性积分包，订阅不启用（见 DEVELOPMENT_PLAN 5.3）。
 * 本页展示订阅状态；未来启用订阅后：取消/门户走 Provider 接口
 * cancelSubscription()/createPortal()，不硬编码渠道端点。
 */
export default async function SubscriptionPage() {
  const user_uuid = await getUserUuid();
  if (!user_uuid) {
    return <Empty message="no auth" />;
  }

  const supabase = getSupabaseClient();
  const { data: subscriptions } = await supabase
    .from("orders")
    .select("*")
    .eq("user_uuid", user_uuid)
    .eq("status", "paid")
    .not("sub_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">Subscription</h3>

      {!subscriptions || subscriptions.length === 0 ? (
        <div className="rounded-lg border p-6 text-center">
          <p className="text-muted-foreground">No active subscription</p>
          <p className="mt-2 text-sm text-muted-foreground">
            当前为一次性积分包模式（v1 不启用订阅）。如需订阅功能，请在
            DEVELOPMENT_PLAN 5.3 说明中启用。
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {subscriptions.map((s: any) => (
            <div key={s.order_no} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{s.product_name || s.order_no}</span>
                <span className="text-xs text-muted-foreground">
                  {moment(s.created_at).format("YYYY-MM-DD")}
                </span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                sub_id: {s.sub_id} · interval: {s.interval}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
