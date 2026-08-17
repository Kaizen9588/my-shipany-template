import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runMigrations } from "../lib/migrate.ts";

/**
 * 手动执行数据库迁移：pnpm migrate
 * 需要 DATABASE_URL 环境变量（Supabase 连接串，推荐带 pgbouncer 事务模式）。
 *
 * 脚本从项目根目录 .env.local 读取环境变量（找不到时静默跳过，
 * 便于仅 Landing Page 模式不配置数据库）。已存在的进程环境变量优先。
 */
function loadEnvLocal(): void {
  const envFile = resolve(process.cwd(), ".env.local");
  if (!existsSync(envFile)) return;

  const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadEnvLocal();

  const { applied, pending } = await runMigrations();
  console.log(
    `[migrate] applied: ${applied.length > 0 ? applied.join(", ") : "none"}`
  );
  if (pending.length > 0) {
    console.warn(`[migrate] pending: ${pending.join(", ")}`);
  }
}

main().catch((e) => {
  console.error("[migrate] failed:", e);
  process.exit(1);
});
