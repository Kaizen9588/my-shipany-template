import { readFileSync, readdirSync } from "fs";
import path from "path";
import { Pool, type PoolClient } from "pg";

/**
 * 非事务迁移（CONCURRENTLY）入口（N-11 剩余，handoff §4 迁移发布机制补全）
 *
 * 背景：`CREATE INDEX CONCURRENTLY` 不能在事务内执行（PostgreSQL 限制），
 * 而 runMigrations() 全程单事务 + 失败回滚。大表索引因此必须拆到本专用入口：
 * 每个文件独立 autocommit 执行（无 BEGIN），版本仍记录进 schema_migrations
 * （mode 列区分 'transactional' / 'concurrent'），保证版本单调可审计。
 *
 * 执行纪律（写入 data/migrations-concurrent/README.md）：
 * - 文件只允许 CONCURRENTLY 类语句（CREATE INDEX CONCURRENTLY /
 *   DROP INDEX CONCURRENTLY / COMMENT），脚本会静态校验并拒绝混入普通 DDL
 *   （普通 DDL 需要回滚语义，autocommit 下失败即留半成品）。
 * - 执行前必须先跑完 `pnpm migrate`（本入口不接管普通迁移）。
 * - CI/deploy 在 `pnpm migrate` 之后、发布应用之前调用 `pnpm migrate:concurrent`。
 */

const CONCURRENT_MIGRATIONS_DIR = path.join(
  process.cwd(),
  "data",
  "migrations-concurrent"
);
const MIGRATION_LOCK_KEY = 821316459;

type QueryClient = Pick<PoolClient, "query" | "release">;

export interface ConcurrentMigrateResult {
  /** 本次运行新应用的迁移文件名 */
  applied: string[];
  /** 运行后仍未应用的迁移文件名 */
  pending: string[];
}

export function getConcurrentMigrationFiles(): string[] {
  return readdirSync(CONCURRENT_MIGRATIONS_DIR)
    .filter((file) => /^\d+_[\w-]+\.sql$/.test(file))
    .sort();
}

/** 版本冲突防护：同一版本号不得同时出现在两个迁移目录（先执行方抢先注册） */
export function findVersionConflicts(
  transactionalFiles: string[],
  concurrentFiles: string[]
): string[] {
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  for (const file of [...transactionalFiles, ...concurrentFiles]) {
    const version = file.split("_")[0] || "";
    const prev = seen.get(version);
    if (prev) {
      conflicts.push(`${version}: ${prev} <-> ${file}`);
    } else {
      seen.set(version, file);
    }
  }
  return conflicts;
}

/**
 * 静态校验：文件只允许 CONCURRENTLY/COMMENT 语句。
 * autocommit 模式没有回滚，任何需要事务语义的语句都必须被拒绝。
 */
export function assertConcurrentOnly(sql: string, file: string): void {
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
  for (const stmt of statements) {
    const head = stmt.replace(/^--[^\n]*\n?/, "").trim();
    if (
      !/^CREATE (UNIQUE )?INDEX CONCURRENTLY/i.test(head) &&
      !/^DROP INDEX CONCURRENTLY/i.test(head) &&
      !/^COMMENT ON/i.test(head)
    ) {
      throw new Error(
        `${file}: only CONCURRENTLY statements are allowed in migrations-concurrent (got: ${head.slice(0, 60)}...)`
      );
    }
  }
}

async function hasModeColumn(client: QueryClient): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'schema_migrations' AND column_name = 'mode'`
  );
  return rows.length > 0;
}

/**
 * 非事务迁移执行入口，供 `pnpm migrate:concurrent` 与受控部署步骤调用。
 * 与 runMigrations 共用 advisory lock 键（多实例串行），但不使用 BEGIN——
 * 每个文件独立 autocommit，CONCURRENTLY 语句才能执行。
 */
export async function runConcurrentMigrations(): Promise<ConcurrentMigrateResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { applied: [], pending: [] };
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = (await pool.connect()) as QueryClient;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      if (!(await hasModeColumn(client))) {
        await client.query(
          `ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'transactional'`
        );
      }

      const files = getConcurrentMigrationFiles();
      const { rows } = await client.query(
        "SELECT version FROM schema_migrations ORDER BY version"
      );
      const appliedVersions = new Set(
        rows.map((row) => (row as { version: string }).version)
      );
      const applied: string[] = [];

      for (const file of files) {
        const version = file.split("_")[0] || "";
        if (appliedVersions.has(version)) {
          continue;
        }
        const sql = readFileSync(
          path.join(CONCURRENT_MIGRATIONS_DIR, file),
          "utf8"
        );
        assertConcurrentOnly(sql, file);
        try {
          await client.query(sql);
          await client.query(
            "INSERT INTO schema_migrations (version, name, mode) VALUES ($1, $2, 'concurrent')",
            [version, file]
          );
        } catch (error) {
          throw new Error(
            `concurrent migration failed: ${file}: ${(error as Error).message}（CONCURRENTLY 失败会留下 INVALID 索引，需 DROP INDEX CONCURRENTLY 后重试）`
          );
        }
        appliedVersions.add(version);
        applied.push(file);
      }

      return {
        applied,
        pending: files
          .filter((file) => !appliedVersions.has(file.split("_")[0] || ""))
          .map((file) => file),
      };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}
