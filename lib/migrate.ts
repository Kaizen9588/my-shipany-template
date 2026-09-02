import { readFileSync, readdirSync } from "fs";
import path from "path";
import { Pool, type PoolClient } from "pg";
import { bootstrapAdmin } from "./bootstrap-admin.ts";
import { findVersionConflicts, getConcurrentMigrationFiles } from "./migrate-concurrent.ts";

/**
 * 数据库迁移与版本校验（P1-6 / P1-7）
 *
 * - 空库只能通过 data/migrations/0000 起的顺序迁移初始化；不再支持 install.sql 路径。
 * - `pnpm migrate` 是唯一写入 schema 的入口，并使用事务级 advisory lock 串行化多实例执行。
 * - 服务运行时只校验版本完整性，绝不隐式修改生产 schema。
 */
const MIGRATIONS_DIR = path.join(process.cwd(), "data", "migrations");
const MIGRATION_LOCK_KEY = 821316459;
const BASELINE_VERSION = "0000";

type QueryClient = Pick<PoolClient, "query" | "release">;

export interface MigrateResult {
  /** 本次运行新应用的迁移文件名 */
  applied: string[];
  /** 运行后仍未应用的迁移文件名 */
  pending: string[];
}

export interface MigrationCheckResult {
  /** 数据库中已记录的迁移版本 */
  applied: string[];
  /** 当前代码所需但数据库尚未应用的迁移文件 */
  pending: string[];
}

export function getMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d+_[\w-]+\.sql$/.test(file))
    .sort();
}

export function getMigrationVersion(file: string): string {
  return file.split("_")[0] || "";
}

export function getPendingMigrationFiles(
  files: string[],
  appliedVersions: Iterable<string>
): string[] {
  const applied = new Set(appliedVersions);
  return files.filter((file) => !applied.has(getMigrationVersion(file)));
}

async function hasTable(client: QueryClient, table: string): Promise<boolean> {
  const { rows } = await client.query(
    "SELECT to_regclass($1) AS table_name",
    [`public.${table}`]
  );
  return Boolean((rows[0] as { table_name?: string | null } | undefined)?.table_name);
}

async function readAppliedVersions(client: QueryClient): Promise<string[]> {
  const { rows } = await client.query(
    "SELECT version FROM schema_migrations ORDER BY version"
  );
  return rows.map((row) => (row as { version: string }).version);
}

async function assertNotLegacySchema(client: QueryClient): Promise<void> {
  const hasMigrationTable = await hasTable(client, "schema_migrations");
  if (hasMigrationTable) {
    return;
  }

  // install.sql 曾经留下 users 表但没有迁移版本记录；继续执行 0000 会让数据库来源不可审计。
  if (await hasTable(client, "users")) {
    throw new Error(
      "legacy schema detected: users exists but schema_migrations does not. Do not mix install.sql with migrations; create a migration baseline explicitly before continuing."
    );
  }
}

/**
 * 唯一允许修改数据库结构的迁移入口，供 `pnpm migrate` 与受控部署步骤调用。
 * 每批迁移与版本写入共用一个事务；任一 SQL 失败则全部回滚。
 */
export async function runMigrations(): Promise<MigrateResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { applied: [], pending: [] };
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = (await pool.connect()) as QueryClient;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await assertNotLegacySchema(client);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = getMigrationFiles();
    // N-11：版本冲突防护——concurrent 目录与事务目录共用 schema_migrations，
    // 重号会被先执行方抢先注册、另一方静默跳过，必须在入口拒绝
    const conflicts = findVersionConflicts(files, getConcurrentMigrationFiles());
    if (conflicts.length > 0) {
      throw new Error(
        `migration version conflict between data/migrations and data/migrations-concurrent: ${conflicts.join("; ")}`
      );
    }
    const appliedVersions = new Set(await readAppliedVersions(client));
    const applied: string[] = [];

    for (const file of files) {
      const version = getMigrationVersion(file);
      if (appliedVersions.has(version)) {
        continue;
      }

      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
          [version, file]
        );
      } catch (error) {
        throw new Error(`migration failed: ${file}: ${(error as Error).message}`);
      }
      appliedVersions.add(version);
      applied.push(file);
    }

    // 初始管理员不属于 SQL 基线：只有显式环境变量才允许在受控迁移阶段创建。
    const bootstrap = await bootstrapAdmin(client);
    if (bootstrap.status === "created") {
      console.warn(
        `[bootstrap-admin] created pending administrator for ${bootstrap.email}; sign in once and change the temporary password immediately.`
      );
      if (bootstrap.temporaryPassword) {
        console.warn(
          `[bootstrap-admin] one-time temporary password: ${bootstrap.temporaryPassword}`
        );
      }
    }

    await client.query("COMMIT");
    return { applied, pending: getPendingMigrationFiles(files, appliedVersions) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * 运行时只读检查：当数据库配置存在时，服务必须拒绝带着缺失迁移启动。
 * 空库会返回全部 pending，要求部署流水线先运行 `pnpm migrate`。
 */
export async function verifyMigrations(): Promise<MigrationCheckResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { applied: [], pending: [] };
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = (await pool.connect()) as QueryClient;
  try {
    const files = getMigrationFiles();
    // 与 runMigrations 同规：concurrent 目录版本冲突在运行时校验也拒绝
    const conflicts = findVersionConflicts(files, getConcurrentMigrationFiles());
    if (conflicts.length > 0) {
      throw new Error(
        `migration version conflict between data/migrations and data/migrations-concurrent: ${conflicts.join("; ")}`
      );
    }
    if (!(await hasTable(client, "schema_migrations"))) {
      return { applied: [], pending: files };
    }

    const applied = await readAppliedVersions(client);
    if (!applied.includes(BASELINE_VERSION) && (await hasTable(client, "users"))) {
      throw new Error(
        "invalid migration state: users exists but baseline migration 0000 is not recorded"
      );
    }
    return { applied, pending: getPendingMigrationFiles(files, applied) };
  } finally {
    client.release();
    await pool.end();
  }
}
