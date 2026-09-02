import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runConcurrentMigrations } from "../lib/migrate-concurrent.ts";

/**
 * 手动执行非事务迁移（CONCURRENTLY 索引等）：pnpm migrate:concurrent
 * 需要 DATABASE_URL。必须先跑完 pnpm migrate（本脚本不接管普通迁移）。
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

  const { applied, pending } = await runConcurrentMigrations();
  console.log(
    `[migrate:concurrent] applied: ${applied.length > 0 ? applied.join(", ") : "none"}`
  );
  if (pending.length > 0) {
    console.warn(`[migrate:concurrent] pending: ${pending.join(", ")}`);
  }
}

main().catch((e) => {
  console.error("[migrate:concurrent] failed:", e);
  process.exit(1);
});
