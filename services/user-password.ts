import { getSupabaseClient } from "@/models/db";
import { findUserByUuid } from "@/models/user";
import { getIsoTimestr } from "@/lib/time";
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "@/lib/password";

/**
 * 用户修改密码（默认管理员首次登录强制改密）
 *
 * 约束：
 * - 新密码满足强度要求（≥8 位，字母 + 数字）
 * - 必须校验当前密码，避免会话劫持后可任意改密
 * - 新密码不得与当前密码相同
 * - 更新成功后清除 must_change_password（0012_default_admin.sql）
 */
export class PasswordChangeError extends Error {}

export async function changeUserPassword(params: {
  userUuid: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const { userUuid, currentPassword, newPassword } = params;

  if (!currentPassword) {
    throw new PasswordChangeError("current password is required");
  }
  if (currentPassword === newPassword) {
    throw new PasswordChangeError(
      "new password must be different from current password"
    );
  }

  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) {
    throw new PasswordChangeError(strengthError);
  }

  const user = await findUserByUuid(userUuid);
  if (!user) {
    throw new PasswordChangeError("user not found");
  }
  if (!user.password_hash) {
    throw new PasswordChangeError(
      "password login is not enabled for this account"
    );
  }

  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) {
    throw new PasswordChangeError("current password is incorrect");
  }

  const passwordHash = await hashPassword(newPassword);
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("users")
    .update({
      password_hash: passwordHash,
      password_updated_at: getIsoTimestr(),
      must_change_password: false,
    })
    .eq("uuid", userUuid);

  if (error) {
    throw error;
  }
}
