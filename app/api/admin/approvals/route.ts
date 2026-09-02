import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { fireAndForgetAudit } from "@/lib/audit";
import { parseReason } from "@/lib/admin-reason";
import {
  cancelApproval,
  decideApproval,
  executeApproval,
  isApprovalAction,
  listOpenApprovals,
  listRecentApprovals,
  submitApproval,
} from "@/lib/admin-approval";

/**
 * /api/admin/approvals —— N-6 审批队列（双人复核，迁移 0030）
 *
 * GET  ?scope=open|recent —— 队列（admin 页面 RSC 也可直读 service，此路由供 client 刷新）
 * POST { op }
 *   - op=submit   { action, target_uuid, payload, reason }：提交审批单（高危路由已内置，
 *       此入口供补提/工具场景）
 *   - op=decide   { id, decision: approve|reject, approve_reason }：另一位管理员批准（即执行）
 *       或驳回；发起人不得复核自己的单据（服务端硬校验）
 *   - op=retry    { id }：failed 单重试（条件占用，防双执行）
 *   - op=cancel   { id }：发起人撤回自己的 pending 单
 */
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") === "recent" ? "recent" : "open";
    const rows =
      scope === "recent" ? await listRecentApprovals(20) : await listOpenApprovals(50);
    return respData({ approvals: rows, scope });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/approvals] GET failed:", e);
    return respErr("get approvals failed");
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("admin");
    const body = await req.json();
    const op = String(body?.op || "");

    if (op === "submit") {
      if (!isApprovalAction(body?.action)) {
        return respErr("invalid approval action");
      }
      const parsed = parseReason(body?.reason);
      if (!parsed.ok) {
        return respErr(`reason required: ${parsed.error}`);
      }
      const { approval, single_admin } = await submitApproval({
        action: body.action,
        requester: admin,
        reason: parsed.reason,
        target_uuid: typeof body?.target_uuid === "string" ? body.target_uuid : "",
        payload:
          body?.payload && typeof body.payload === "object" ? body.payload : {},
      });
      fireAndForgetAudit({
        admin_uuid: admin.uuid || "",
        action: "admin.approval.submit",
        target_type: approval.target_type,
        target_uuid: approval.target_uuid,
        detail: JSON.stringify({
          approval_id: approval.id,
          approval_action: approval.action,
          status: approval.status,
          single_admin,
        }),
      });
      return respData({ approval_id: approval.id, status: approval.status, single_admin });
    }

    if (op === "decide") {
      const id = Number(body?.id);
      const decision = body?.decision === "approve" ? "approve" : body?.decision === "reject" ? "reject" : "";
      if (!Number.isInteger(id) || id <= 0 || !decision) {
        return respErr("invalid params");
      }
      // 批准/驳回意见可选；驳回时建议说明（不强求，理由已随单据留痕）
      let approveReason = typeof body?.approve_reason === "string" ? body.approve_reason : "";
      if (approveReason) {
        const parsed = parseReason(approveReason);
        if (!parsed.ok) {
          return respErr(`approve reason invalid: ${parsed.error}`);
        }
        approveReason = parsed.reason;
      }
      const result = await decideApproval({
        id,
        approver: admin,
        decision,
        approve_reason: approveReason,
      });
      fireAndForgetAudit({
        admin_uuid: admin.uuid || "",
        action: decision === "approve" ? "admin.approval.approve" : "admin.approval.reject",
        target_type: "approval",
        target_uuid: String(id),
        detail: JSON.stringify(result),
      });
      return respData(result);
    }

    if (op === "retry") {
      const id = Number(body?.id);
      if (!Number.isInteger(id) || id <= 0) {
        return respErr("invalid params");
      }
      // 重试视作再次批准：执行人与批准人都落在当前管理员身上（单据批准人不变）
      const result = await executeApprovalViaRetry(id, admin);
      fireAndForgetAudit({
        admin_uuid: admin.uuid || "",
        action: "admin.approval.retry",
        target_type: "approval",
        target_uuid: String(id),
        detail: JSON.stringify(result),
      });
      return respData(result);
    }

    if (op === "cancel") {
      const id = Number(body?.id);
      if (!Number.isInteger(id) || id <= 0) {
        return respErr("invalid params");
      }
      await cancelApproval(id, admin);
      fireAndForgetAudit({
        admin_uuid: admin.uuid || "",
        action: "admin.approval.cancel",
        target_type: "approval",
        target_uuid: String(id),
        detail: "",
      });
      return respData({ cancelled: true });
    }

    return respErr("invalid op");
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    if (e.message === "password change required") {
      return respErr("password change required", 403);
    }
    console.error("[admin/approvals] POST failed:", e);
    return respErr(e?.message || "approval op failed");
  }
}

/** retry 专用：failed 单条件占用（executing / 5 分钟 stale 回收）后执行 */
async function executeApprovalViaRetry(
  id: number,
  admin: { uuid?: string; email?: string }
) {
  const { _internal } = await import("@/lib/admin-approval");
  const claimed = await _internal.claimForRetry(id);
  if (!claimed) {
    throw new Error("approval is not retryable now (pending review or executing)");
  }
  return executeApproval(id, admin as any);
}
