import { readFileSync, readdirSync } from "fs";
import path from "path";
import { Pool } from "pg";

/**
 * 最小数据库迁移机制（P-1.12）
 *
 * - data/migrations/*.sql：按文件名前缀（如 0001_xxx.sql）顺序执行
 * - schema_migrations：版本表，记录已应用的迁移（由本模块自举创建）
 * - 无回滚能力：向前迁移 + 手工回滚（Drizzle 迁移系统留到 P3）
 *
 * 用法：
 * - 服务启动时由根目录 instrumentation.ts 自动调用（数据库未配置时静默跳过）
 * - 手动执行：pnpm migrate
 */
const MIGRATIONS_DIR = path.join(process.cwd(), "data", "migrations");

export interface MigrateResult {
  /** 本次运行新应用的迁移文件名 */
  applied: string[];
  /** 运行后仍未应用的迁移文件名 */
  pending: string[];
}

export async function runMigrations(): Promise<MigrateResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // 数据库未配置（如仅 Landing Page 模式），跳过
    return { applied: [], pending: [] };
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    // 自举创建版本表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await pool.query("SELECT version FROM schema_migrations");
    const appliedVersions = new Set<string>(rows.map((r) => r.version));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const applied: string[] = [];
    for (const file of files) {
      const version = file.split("_")[0];
      if (!version || appliedVersions.has(version)) {
        continue;
      }

      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
          [version, file]
        );
        await client.query("COMMIT");
        appliedVersions.add(version);
        applied.push(file);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(
          `migration failed: ${file}: ${(e as Error).message}`
        );
      } finally {
        client.release();
      }
    }

    const pending = files.filter((file) => {
      const version = file.split("_")[0];
      return version && !appliedVersions.has(version);
    });

    return { applied, pending };
  } finally {
    await pool.end();
  }
}
