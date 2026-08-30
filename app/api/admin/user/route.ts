import { respData, respErr } from "@/lib/resp";
import { isSuperAdmin, requireAdmin } from "@/lib/auth";
import { findUserByUuid, updateUserByAdmin } from "@/models/user";
import { fireAndForgetAudit } from "@/lib/audit";
import { parseReason } from "@/lib/admin-reason";

const VALID_ROLES = ["user", "operator", "admin", "super_admin"];

/**
 * PUT /api/admin/user —— 管理员更新用户（6.7；N-6：强制 reason）
 * 可更新：role（角色）、status（active/banned）、nickname
 * N-6：role / status 是授权与风控操作，必须带理由（进审计）；nickname 豁免。
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

    await updateUserByAdmin(uuid, fields as any);

    // 操作审计（fire-and-forget；N-6：reason 入审计）
    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.user.update",
      target_type: "user",
      target_uuid: uuid,
      detail: JSON.stringify({ ...fields, ...(reasonText ? { reason: reasonText } : {}) }),
    });

    return respData({ updated: true });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/user] failed:", e);
    return respErr("update user failed");
  }
}
