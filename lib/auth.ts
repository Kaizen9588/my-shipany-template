import { auth } from "@/auth";
import { findUserByUuid } from "@/models/user";
import { User } from "@/types/user";

/**
 * 后台权限校验（6.10 RBAC，2.7 分级修复）
 *
 * 角色体系：super_admin / admin / operator / user（users.role 字段）
 * - operator：只读 + 日常运营（看板/订单查询），无用户管理/退款/调积分
 * - admin：全部后台操作（含退款/调积分/封禁）
 * - super_admin：admin + 角色授予（唯一能设置 super_admin 的级别）
 * - ADMIN_EMAILS 白名单作为过渡保留（等价 super_admin，RBAC 落地后不再依赖）
 *
 * 2.7 修复要点：
 * - requireAdmin(level) 分级；此前 operator 也能调退款/调积分/改角色
 * - 授予 super_admin 仅 super_admin 可为；此前任意后台角色可自我提权
 * - getAdminUser 检查 status；此前被 ban 的管理员仍可操作
 */
export const ADMIN_ROLES = ["super_admin", "admin", "operator"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** 权限等级：数值越高权限越大 */
const ROLE_LEVEL: Record<string, number> = {
  operator: 1,
  admin: 2,
  super_admin: 3,
};

export function isAdminRole(role?: string): boolean {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}

/** 当前用户是否达到要求的最低权限等级 */
export function hasAdminLevel(user: Pick<User, "email" | "role">, level: AdminRole): boolean {
  if (isSuperAdmin(user)) {
    return true;
  }
  return (ROLE_LEVEL[user.role || ""] || 0) >= ROLE_LEVEL[level];
}

export function isSuperAdmin(user: Pick<User, "email" | "role">): boolean {
  const whitelist =
    process.env.ADMIN_EMAILS?.split(",").map((s) => s.trim()).filter(Boolean) ||
    [];
  return user.role === "super_admin" || whitelist.includes(user.email);
}

/** 返回当前管理员用户（无权限或已封禁返回 null） */
export async function getAdminUser(): Promise<User | null> {
  const session = await auth();
  const uuid = session?.user?.uuid;
  if (!uuid) {
    return null;
  }

  const user = await findUserByUuid(uuid);
  if (!user) {
    return null;
  }

  // 2.7：被 ban 的账号立即失去后台权限（session 是 JWT 不会随 ban 吊销，必须实时查库拦截）
  if (user.status === "banned") {
    return null;
  }

  // 角色体系 或 ADMIN_EMAILS 白名单过渡
  if (isAdminRole(user.role) || isSuperAdmin(user)) {
    return user;
  }

  return null;
}

/** 要求管理员权限（operator 及以上），无权限抛错（供 API 路由使用） */
export async function requireAdmin(): Promise<User>;

/** 要求指定级别权限：operator（看板/查询）/ admin（退款/调积分/封禁）/ super_admin（角色授予） */
export async function requireAdmin(level: AdminRole): Promise<User>;

export async function requireAdmin(level?: AdminRole): Promise<User> {
  const admin = await getAdminUser();
  if (!admin) {
    throw new Error("no admin access");
  }
  if (level && !hasAdminLevel(admin, level)) {
    throw new Error("no admin access");
  }
  return admin;
}
