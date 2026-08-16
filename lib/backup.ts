import { getSupabaseClient } from "@/models/db";
import { Storage, getStorageKey } from "@/lib/storage";

/**
 * 数据备份（6.16）
 * 定期导出关键表（users/orders/credits）到 S3，每日一次（Vercel Cron）。
 * Supabase 自带每日自动备份（免费版保留 7 天）；此处为跨区域额外副本。
 *
 * 2.13 修复：users 表不再 select(*) -- 整行导出会把 password_hash /
 * signin_openid / signin_ip 明文写进备份文件，bucket 公开性又完全依赖
 * 部署方自觉，等于把密码哈希库放在门外。现按白名单收敛导出字段。
 */
const USER_BACKUP_FIELDS = [
  "id",
  "uuid",
  "email",
  "created_at",
  "nickname",
  "avatar_url",
  "locale",
  "signin_type",
  "signin_provider",
  "invite_code",
  "invited_by",
  "is_affiliate",
  "role",
  "status",
] as const;

export async function backupKeyTables(): Promise<{
  exported: string[];
  error?: string;
}> {
  const supabase = getSupabaseClient();
  const storage = new Storage();

  const exported: string[] = [];

  for (const table of ["users", "orders", "credits"] as const) {
    const select =
      table === "users" ? USER_BACKUP_FIELDS.join(",") : "*";
    const { data, error } = await supabase.from(table).select(select);
    if (error) {
      return { exported, error: `${table}: ${error.message}` };
    }

    const filename = `${table}-${new Date().toISOString().slice(0, 10)}.json`;
    const key = getStorageKey(`backups/${filename}`);

    await storage.uploadFile({
      body: Buffer.from(JSON.stringify(data || [])),
      key,
      contentType: "application/json",
      disposition: "attachment",
    });

    exported.push(key);
  }

  return { exported };
}
