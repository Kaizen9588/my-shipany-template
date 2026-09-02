import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { findUserByUuid } from "@/models/user";
import { fireAndForgetAudit } from "@/lib/audit";
import { parseReason } from "@/lib/admin-reason";
import { submitApproval } from "@/lib/admin-approval";

/**
 * POST /api/admin/user/credits —— 管理员手动调整积分（6.9）
 * N-6：强制 reason + 审批队列（双人复核）——不再直接执行，落审批单，
 * 由另一位管理员在 /admin/approvals 批准即执行（单管理员部署自动降级照常执行）。
 * 请求：{ user_uuid, credits, reason }（credits 可正可负，reason 进审计）
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("admin"); // 2.7：调整积分是资金操作，需 admin 级
    const { user_uuid, credits, reason } = await req.json();

    if (!user_uuid || typeof credits !== "number" || !Number.isInteger(credits) || credits === 0) {
      return respErr("invalid params");
    }
    // N-6：调账是资产变更，必须带理由（进审计与账本 remark）
    const parsed = parseReason(reason);
    if (!parsed.ok) {
      return respErr(`adjust reason required: ${parsed.error}`);
    }
    if (Math.abs(credits) > 1000000) {
      return respErr("credits amount too large");
    }

    const target = await findUserByUuid(user_uuid);
    if (!target) {
      return respErr("user not found");
    }

    const { approval, single_admin } = await submitApproval({
      action: "adjust_credits",
      requester: admin,
      reason: parsed.reason,
      target_uuid: user_uuid,
      payload: { user_uuid, credits },
    });

    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.user.adjust_credits_requested",
      target_type: "user",
      target_uuid: user_uuid,
      detail: JSON.stringify({
        credits,
        approval_id: approval.id,
        approval_status: approval.status,
        single_admin,
        reason: parsed.reason,
      }),
    });

    return respData({
      approval_required: true,
      approval_id: approval.id,
      status: approval.status,
      single_admin,
    });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/user/credits] failed:", e);
    return respErr("adjust credits failed");
  }
}
