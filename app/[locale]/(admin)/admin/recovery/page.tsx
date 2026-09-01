import { getSupabaseClient } from "@/models/db";
import { requireAdmin } from "@/lib/auth";
import moment from "moment";

import {
  CloseRefundButton,
  SettleDebtButton,
} from "@/components/dashboard/stats/recovery-actions";

/**
 * 回收工作台（P0-1 闭环，handoff §3）
 *
 * 两个队列：
 * 1. refund_requested 订单——渠道退款 webhook 已登记退款事实，待管理员本地闭合
 *    （processRefund 按订单 credit_lots 批次精确回收积分 + 订单终态化）
 * 2. outstanding 债务——退款缺口已登记 credit_debts、账号 restricted，
 *    待管理员确认清偿后恢复账号
 */
export default async function RecoveryPage() {
  await requireAdmin();

  const supabase = getSupabaseClient();
  const [{ data: refundOrders }, { data: debts }] = await Promise.all([
    supabase
      .from("orders")
      .select("order_no, user_uuid, paid_email, credits, amount, currency, status, created_at, users(email)")
      .in("status", ["refund_requested", "refund_blocked"])
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("credit_debts")
      .select("debt_no, user_uuid, order_no, due_credits, status, reason, created_at, users(email)")
      .eq("status", "outstanding")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const refundRows = refundOrders || [];
  const debtRows = debts || [];

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-medium">回收工作台</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          退款闭合按订单批次精确回收积分（迁移 0026 credit_lots）；缺口自动债务化并冻结账号，清偿后恢复。
        </p>
      </div>

      {/* 队列一：待闭合退款 */}
      <div className="space-y-2">
        <h4 className="font-medium">待闭合退款（refund_requested / refund_blocked）</h4>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">订单号</th>
                <th>用户</th>
                <th>积分</th>
                <th>金额</th>
                <th>状态</th>
                <th>时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {refundRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    暂无待闭合退款
                  </td>
                </tr>
              )}
              {refundRows.map((o: any) => (
                <tr key={o.order_no} className="border-b">
                  <td className="p-3 font-mono text-xs">{o.order_no}</td>
                  <td>{o.users?.email || o.user_uuid?.slice(0, 8)}</td>
                  <td>{o.credits}</td>
                  <td>
                    ${(o.amount / 100).toFixed(2)} {o.currency}
                  </td>
                  <td>
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                      {o.status}
                    </span>
                  </td>
                  <td>{moment(o.created_at).format("YYYY-MM-DD HH:mm")}</td>
                  <td className="p-3">
                    <CloseRefundButton orderNo={o.order_no} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 队列二：待清偿债务 */}
      <div className="space-y-2">
        <h4 className="font-medium">待清偿债务（账号已受限）</h4>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">债务号</th>
                <th>用户</th>
                <th>欠款积分</th>
                <th>关联订单</th>
                <th>原因</th>
                <th>登记时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {debtRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    暂无待清偿债务
                  </td>
                </tr>
              )}
              {debtRows.map((d: any) => (
                <tr key={d.debt_no} className="border-b">
                  <td className="p-3 font-mono text-xs">{d.debt_no}</td>
                  <td>{d.users?.email || d.user_uuid?.slice(0, 8)}</td>
                  <td className="text-red-600">{d.due_credits}</td>
                  <td className="font-mono text-xs">{d.order_no || "-"}</td>
                  <td className="max-w-[240px] truncate text-xs text-muted-foreground" title={d.reason || ""}>
                    {d.reason || "-"}
                  </td>
                  <td>{moment(d.created_at).format("YYYY-MM-DD HH:mm")}</td>
                  <td className="p-3">
                    <SettleDebtButton debtNo={d.debt_no} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
