import { respData, respErr } from "@/lib/resp";
import { isSuperAdmin, requireAdmin } from "@/lib/auth";
import { findUserByUuid } from "@/models/user";
import { fireAndForgetAudit } from "@/lib/audit";
import { parseReason } from "@/lib/admin-reason";
import { submitApproval } from "@/lib/admin-approval";

const VALID_ROLES = ["user", "operator", "admin", "super_admin"];

/**
 * PUT /api/admin/user —— 管理员更新用户（6.7）
 * 可更新：role（角色）、status（active/banned）、nickname
 * N-6：role / status 是授权与风控操作，强制理由 + 审批队列（双人复核）——
 * 落审批单由另一位管理员批准即执行；nickname 豁免审批照旧直接改。
 */
export async function PUT(req: Request) {
  try {
    // 2.7：改 role 是授权操作，仅 super_admin；status/nickname 为 admin 级
    const body = await req.json();
    const { uuid, role, status, nickname, reason } = body;
    const admin = await requireAdmin(role !== undefined ? "super_admin" : "admin");

    if (!uuid) {
      return respErr("invalid params");
    }

    // N-6：封禁/解封/改角色必须带理由
    let reasonText = "";
    if (role !== undefined || status !== undefined) {
      const parsed = parseReason(reason);
      if (!parsed.ok) {
        return respErr(`role/status change reason required: ${parsed.error}`);
      }
      reasonText = parsed.reason;
    }

    const target = await findUserByUuid(uuid);
    if (!target) {
      return respErr("user not found");
    }

    // 2.7 加固：非 super_admin 不得修改 super_admin 账号（防止 admin 封禁/降级超管）
    if (target.role === "super_admin" && !isSuperAdmin(admin)) {
      return respErr("cannot modify super_admin");
    }

    const fields: Record<string, string> = {};
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        return respErr("invalid role");
      }
      fields.role = role;
    }
    if (status !== undefined) {
      if (!["active", "banned"].includes(status)) {
        return respErr("invalid status");
      }
      fields.status = status;
    }
    if (nickname !== undefined) {
      fields.nickname = String(nickname).slice(0, 100);
    }

    if (Object.keys(fields).length === 0) {
      return respErr("nothing to update");
    }

    // nickname 豁免审批：低敏字段照旧直接改
    if (fields.nickname && !fields.role && !fields.status) {
      const { updateUserByAdmin } = await import("@/models/user");
      await updateUserByAdmin(uuid, { nickname: fields.nickname } as any);
      fireAndForgetAudit({
        admin_uuid: admin.uuid || "",
        action: "admin.user.update",
        target_type: "user",
        target_uuid: uuid,
        detail: JSON.stringify({ nickname: fields.nickname }),
      });
      return respData({ updated: true });
    }

    // role/status：一个审批单承载一次变更（role 优先，二者同传时拆开提交会被
    // 前端避免；服务端按语义归一为单一动作）
    const action = fields.role ? "user_role" : "user_status";
    const payload = { user_uuid: uuid, ...(fields as object) };
    const { approval, single_admin } = await submitApproval({
      action,
      requester: admin,
      reason: reasonText,
      target_uuid: uuid,
      payload,
    });

    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.user.update_requested",
      target_type: "user",
      target_uuid: uuid,
      detail: JSON.stringify({
        ...fields,
        approval_id: approval.id,
        approval_status: approval.status,
        single_admin,
        reason: reasonText,
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
    console.error("[admin/user] failed:", e);
    return respErr("update user failed");
  }
}
