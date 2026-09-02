import { requireAdmin } from "@/lib/auth";
import { listOpenApprovals, listRecentApprovals, ApprovalRow } from "@/lib/admin-approval";
import ApprovalActions from "@/components/admin/approval-actions";
import { Badge } from "@/components/ui/badge";
import moment from "moment";

const ACTION_LABELS: Record<string, string> = {
  refund: "退款/闭合退款",
  adjust_credits: "调整积分",
  user_role: "修改角色",
  user_status: "封禁/解封",
  payment_settings: "支付渠道/定价",
};

function payloadSummary(row: ApprovalRow): string {
  const p = (row.payload || {}) as Record<string, any>;
  if (row.action === "refund") {
    return `订单 ${p.order_no || row.target_uuid}${p.amount ? ` · 金额 ${(p.amount / 100).toFixed(2)}` : ""}${p.close_only ? " · 仅本地闭合" : " · 含渠道退款"}`;
  }
  if (row.action === "adjust_credits") {
    return `用户 ${p.user_uuid || row.target_uuid} · 积分 ${p.credits > 0 ? "+" : ""}${p.credits}`;
  }
  if (row.action === "user_role") {
    return `用户 ${p.user_uuid || row.target_uuid} → 角色 ${p.role}`;
  }
  if (row.action === "user_status") {
    return `用户 ${p.user_uuid || row.target_uuid} → 状态 ${p.status}`;
  }
  if (row.action === "payment_settings") {
    const nSettings = Array.isArray(p.settings) ? p.settings.length : 0;
    const nProducts = Array.isArray(p.products) ? p.products.length : 0;
    return `渠道变更 ${nSettings} 项 · 定价变更 ${nProducts} 项`;
  }
  return JSON.stringify(p).slice(0, 80);
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "executed"
      ? "default"
      : status === "failed" || status === "rejected"
        ? "destructive"
        : "outline";
  const labels: Record<string, string> = {
    pending: "待复核",
    approved: "已批准",
    rejected: "已驳回",
    executing: "执行中",
    executed: "已执行",
    failed: "执行失败",
    cancelled: "已撤回",
  };
  return <Badge variant={variant}>{labels[status] || status}</Badge>;
}

function ApprovalTable({
  rows,
  viewerUuid,
  empty,
}: {
  rows: ApprovalRow[];
  viewerUuid: string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-3">#</th>
            <th className="py-2 pr-3">动作</th>
            <th className="py-2 pr-3">内容</th>
            <th className="py-2 pr-3">发起人</th>
            <th className="py-2 pr-3">状态</th>
            <th className="py-2 pr-3">复核人</th>
            <th className="py-2 pr-3">时间</th>
            <th className="py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b align-top">
              <td className="py-2 pr-3 font-mono text-xs">{row.id}</td>
              <td className="py-2 pr-3">{ACTION_LABELS[row.action] || row.action}</td>
              <td className="py-2 pr-3">
                <div>{payloadSummary(row)}</div>
                <div className="text-xs text-muted-foreground">
                  理由：{row.reason}
                </div>
                {row.exec_error && (
                  <div className="text-xs text-red-600">失败：{row.exec_error}</div>
                )}
              </td>
              <td className="py-2 pr-3 text-xs">
                {row.requester_email || row.requester_uuid.slice(0, 8)}
              </td>
              <td className="py-2 pr-3">
                <StatusBadge status={row.status} />
              </td>
              <td className="py-2 pr-3 text-xs">
                {row.approver_email ||
                  (row.approver_uuid ? row.approver_uuid.slice(0, 8) : "-")}
                {row.approve_reason && (
                  <div className="text-xs text-muted-foreground">
                    {row.approve_reason}
                  </div>
                )}
              </td>
              <td className="py-2 pr-3 text-xs">
                {moment(row.created_at).format("MM-DD HH:mm")}
              </td>
              <td className="py-2">
                <ApprovalActions row={row} viewerUuid={viewerUuid} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 审批队列（N-6 双人复核，迁移 0030）：
 * 高危操作（退款/调积分/改角色/封禁/渠道定价）先落审批单，由另一位管理员
 * 批准即执行。单管理员部署自动降级 approved 照常执行（单据留痕）。
 */
export default async function ApprovalsPage() {
  const admin = await requireAdmin();
  const [openRows, recentRows] = await Promise.all([
    listOpenApprovals(50),
    listRecentApprovals(20),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">审批队列</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          高危操作双人复核：发起人不能复核自己的单据；执行失败的单据可重试。
          单管理员部署（无其他活跃管理员）时单据自动批准并执行，留痕在本页。
        </p>
      </div>

      <div className="rounded-lg border p-4">
        <h4 className="mb-3 font-medium">待处理（{openRows.length}）</h4>
        <ApprovalTable
          rows={openRows}
          viewerUuid={admin.uuid || ""}
          empty="暂无待处理审批单"
        />
      </div>

      <div className="rounded-lg border p-4">
        <h4 className="mb-3 font-medium">最近记录</h4>
        <ApprovalTable
          rows={recentRows}
          viewerUuid={admin.uuid || ""}
          empty="暂无记录"
        />
      </div>
    </div>
  );
}
