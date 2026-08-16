import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { findUserByUuid, updateUserByAdmin } from "@/models/user";
import { fireAndForgetAudit } from "@/lib/audit";

const VALID_ROLES = ["user", "operator", "admin", "super_admin"];

/**
 * PUT /api/admin/user —— 管理员更新用户（6.7）
 * 可更新：role（角色）、status（active/banned）、nickname
 */
export async function PUT(req: Request) {
  try {
    // 2.7：改 role 是授权操作，仅 super_admin；status/nickname 为 admin 级
    const body = await req.json();
    const { uuid, role, status, nickname } = body;
    const admin = await requireAdmin(role !== undefined ? "super_admin" : "admin");

    if (!uuid) {
      return respErr("invalid params");
    }

    const target = await findUserByUuid(uuid);
    if (!target) {
      return respErr("user not found");
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

    // 操作审计（fire-and-forget）
    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.user.update",
      target_type: "user",
      target_uuid: uuid,
      detail: JSON.stringify(fields),
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
