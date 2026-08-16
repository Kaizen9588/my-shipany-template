import { runMigrations } from "../lib/migrate";

/**
 * 手动执行数据库迁移：pnpm migrate
 * 需要 DATABASE_URL 环境变量（Supabase 连接串，推荐带 pgbouncer 事务模式）。
 */
async function main() {
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
