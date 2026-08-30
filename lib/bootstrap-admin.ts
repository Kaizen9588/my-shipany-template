import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { hashPassword } from "./password.ts";

type QueryClient = Pick<PoolClient, "query">;

type BootstrapEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, "ADMIN_BOOTSTRAP_EMAIL" | "ADMIN_BOOTSTRAP_PASSWORD">
>;

export type BootstrapAdminResult =
  | { status: "not_configured" }
  | { status: "already_exists"; email: string }
  | { status: "created"; email: string; temporaryPassword?: string };

function generateTemporaryPassword(): string {
  // 固定前缀确保同时满足现有密码强度规则；剩余部分使用 CSPRNG。
  return `Aa1-${randomBytes(18).toString("base64url")}`;
}

/**
 * P0-3 初始管理员引导。
 *
 * 不配置 ADMIN_BOOTSTRAP_EMAIL 时绝不创建账号；配置后只创建一次 pending_activation
 * 超级管理员。未给密码时生成临时强密码并仅交给调用方写入受限启动日志。
 */
export async function bootstrapAdmin(
  client: QueryClient,
  env: BootstrapEnvironment = {
    ADMIN_BOOTSTRAP_EMAIL: process.env.ADMIN_BOOTSTRAP_EMAIL,
    ADMIN_BOOTSTRAP_PASSWORD: process.env.ADMIN_BOOTSTRAP_PASSWORD,
  }
): Promise<BootstrapAdminResult> {
  const email = env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  if (!email) {
    return { status: "not_configured" };
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error("ADMIN_BOOTSTRAP_EMAIL must be a valid email address");
  }

  const existing = await client.query<{ uuid: string }>(
    "SELECT uuid FROM users WHERE email = $1 LIMIT 1",
    [email]
  );
  if (existing.rows.length > 0) {
    return { status: "already_exists", email };
  }

  const temporaryPassword = env.ADMIN_BOOTSTRAP_PASSWORD || generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await client.query(
    `INSERT INTO users (
      uuid, email, nickname, avatar_url, locale, signin_type, signin_provider,
      invite_code, invited_by, is_affiliate, role, status, password_hash,
      password_updated_at, must_change_password, created_at
    ) VALUES (
      $1, $2, 'admin', '', 'en', 'credentials', 'credentials',
      '', '', false, 'super_admin', 'pending_activation', $3,
      now(), true, now()
    )`,
    [randomUUID(), email, passwordHash]
  );

  return {
    status: "created",
    email,
    ...(env.ADMIN_BOOTSTRAP_PASSWORD ? {} : { temporaryPassword }),
  };
}
