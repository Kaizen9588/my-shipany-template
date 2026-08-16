import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { adjustCreditsByAdmin } from "@/services/credit";
import { findUserByUuid } from "@/models/user";
import { fireAndForgetAudit } from "@/lib/audit";

/**
 * POST /api/admin/user/credits —— 管理员手动调整积分（6.9）
 * 请求：{ user_uuid, credits, remark? }（credits 可正可负）
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("admin"); // 2.7：调整积分是资金操作，需 admin 级
    const { user_uuid, credits, remark } = await req.json();

    if (!user_uuid || typeof credits !== "number" || !Number.isInteger(credits) || credits === 0) {
      return respErr("invalid params");
    }
    if (Math.abs(credits) > 1000000) {
      return respErr("credits amount too large");
    }

    const target = await findUserByUuid(user_uuid);
    if (!target) {
      return respErr("user not found");
    }

    await adjustCreditsByAdmin({
      user_uuid,
      credits,
      remark: String(remark || "").slice(0, 200),
    });

    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.user.adjust_credits",
      target_type: "user",
      target_uuid: user_uuid,
      detail: JSON.stringify({ credits, remark }),
    });

    return respData({ adjusted: true });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/user/credits] failed:", e);
    return respErr("adjust credits failed");
  }
}
