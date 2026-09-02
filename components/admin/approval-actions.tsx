"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ApprovalRow } from "@/lib/admin-approval";

const ACTION_LABELS: Record<string, string> = {
  refund: "退款/闭合退款",
  adjust_credits: "调整积分",
  user_role: "修改角色",
  user_status: "封禁/解封",
  payment_settings: "支付渠道/定价",
};

const STATUS_BADGES: Record<string, string> = {
  pending: "⏳ 待复核",
  approved: "✅ 已批准待执行",
  rejected: "❌ 已驳回",
  executing: "🔄 执行中",
  executed: "✔️ 已执行",
  failed: "⚠️ 执行失败",
  cancelled: "🚫 已撤回",
};

function payloadSummary(action: string, row: ApprovalRow): string {
  const p = (row.payload || {}) as Record<string, any>;
  if (action === "refund") {
    return `订单 ${p.order_no || row.target_uuid}${p.amount ? ` · 金额 ${(p.amount / 100).toFixed(2)}` : ""}${p.close_only ? " · 仅本地闭合" : " · 含渠道退款"}`;
  }
  if (action === "adjust_credits") {
    return `用户 ${p.user_uuid || row.target_uuid} · 积分 ${p.credits > 0 ? "+" : ""}${p.credits}`;
  }
  if (action === "user_role") {
    return `用户 ${p.user_uuid || row.target_uuid} → 角色 ${p.role}`;
  }
  if (action === "user_status") {
    return `用户 ${p.user_uuid || row.target_uuid} → 状态 ${p.status}`;
  }
  if (action === "payment_settings") {
    const nSettings = Array.isArray(p.settings) ? p.settings.length : 0;
    const nProducts = Array.isArray(p.products) ? p.products.length : 0;
    return `渠道变更 ${nSettings} 项 · 定价变更 ${nProducts} 项`;
  }
  return JSON.stringify(p).slice(0, 80);
}

/** 审批队列行内操作（N-6）：批准即执行 / 驳回 / failed 重试 / 发起人撤回 */
export default function ApprovalActions({
  row,
  viewerUuid,
}: {
  row: ApprovalRow;
  viewerUuid: string;
}) {
  const [loading, setLoading] = useState(false);
  const isRequester = row.requester_uuid === viewerUuid;

  const post = async (body: Record<string, unknown>) => {
    setLoading(true);
    try {
      const resp = await fetch("/api/admin/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const { code, message, data } = await resp.json();
      if (code !== 0) {
        toast.error(message);
        return null;
      }
      return data;
    } catch {
      toast.error("操作失败");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const decide = async (decision: "approve" | "reject") => {
    let approveReason = "";
    if (decision === "approve") {
      approveReason =
        window.prompt(
          `批准并立即执行「${ACTION_LABELS[row.action]}」？请输入批准意见（可留空）`
        ) || "";
      const ok = window.confirm(
        `确认执行？执行内容：${payloadSummary(row.action, row)}`
      );
      if (!ok) return;
    } else {
      approveReason =
        window.prompt(
          `驳回该审批单？可输入驳回原因（可留空）`
        ) || "";
      if (approveReason === null) return;
    }
    const data = await post({ op: "decide", id: row.id, decision, approve_reason: approveReason });
    if (!data) return;
    if (data.executed) {
      toast.success("已批准并执行完成");
    } else if (data.status === "failed") {
      toast.error(`批准后执行失败：${data.exec_error || "未知错误"}（可在队列重试）`);
    } else {
      toast.success("已驳回");
    }
    window.location.reload();
  };

  const retry = async () => {
    const ok = window.confirm(
      `重试执行？执行内容：${payloadSummary(row.action, row)}`
    );
    if (!ok) return;
    const data = await post({ op: "retry", id: row.id });
    if (!data) return;
    if (data.executed) {
      toast.success("重试执行完成");
    } else {
      toast.error(`重试仍失败：${data.exec_error || "未知错误"}`);
    }
    window.location.reload();
  };

  const cancel = async () => {
    const ok = window.confirm("撤回该审批单？");
    if (!ok) return;
    const data = await post({ op: "cancel", id: row.id });
    if (!data) return;
    toast.success("已撤回");
    window.location.reload();
  };

  return (
    <div className="flex flex-wrap gap-2">
      {(row.status === "pending" || row.status === "failed") && !isRequester && (
        <>
          <Button
            type="button"
            size="sm"
            disabled={loading}
            onClick={() => decide("approve")}
          >
            {loading ? "..." : row.status === "failed" ? "重试执行" : "批准并执行"}
          </Button>
          {row.status === "pending" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => decide("reject")}
            >
              驳回
            </Button>
          )}
        </>
      )}
      {(row.status === "pending" || row.status === "failed") && isRequester && (
        <>
          <span className="text-xs text-muted-foreground self-center">
            本人发起，需他人复核
          </span>
          {row.status === "pending" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={cancel}
            >
              撤回
            </Button>
          )}
        </>
      )}
      {row.status === "failed" && isRequester && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={retry}
        >
          重试执行
        </Button>
      )}
    </div>
  );
}

/** 批准意见输入（approve 时可选）——保留给需要表单化复核的场景 */
export function ApproveReasonInput({
  onReason,
}: {
  onReason: (v: string) => void;
}) {
  return (
    <Input
      placeholder="批准意见（可选）"
      onChange={(e) => onReason(e.target.value)}
      className="w-48"
    />
  );
}
