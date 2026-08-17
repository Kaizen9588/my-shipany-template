import { respData, respErr } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import {
  PasswordChangeError,
  changeUserPassword,
} from "@/services/user-password";

/**
 * POST /api/user/change-password —— 修改密码（默认管理员首次登录强制改密）
 *
 * 请求：{ currentPassword, newPassword }
 * - 未登录 401
 * - currentPassword 错误 / 新密码强度不足 → 400
 * - 成功后清除 must_change_password，下次会话即解除强制改密
 */
export async function POST(req: Request) {
  try {
    const user_uuid = await getUserUuid();
    if (!user_uuid) {
      return respErr("no auth", 401);
    }

    const { currentPassword, newPassword } = await req.json();
    if (!currentPassword || !newPassword) {
      return respErr(
        "currentPassword and newPassword are required",
        400
      );
    }

    await changeUserPassword({
      userUuid: user_uuid,
      currentPassword: String(currentPassword),
      newPassword: String(newPassword),
    });

    return respData({ ok: true });
  } catch (e) {
    if (e instanceof PasswordChangeError) {
      return respErr(e.message, 400);
    }
    console.error("[change-password] failed:", e);
    return respErr("change password failed", 500);
  }
}
