/**
 * API 测试环境数据库生命周期：truncate 全部业务表 + 补 service_role 表权限 + 种子数据。
 *
 * 用法：pnpm api-test:db-reset（Playwright globalSetup 与 CI 均调用本文件）
 *
 * 设计：
 * - 本地 Supabase 栈（supabase start）的表由 pnpm migrate 建出，但本地栈上
 *   DDL 走 postgres 角色而云端走 supabase_admin——云端默认授予 service_role
 *   的表权限在本地不生效，这里幂等补 GRANT（云端重复执行无害）。
 * - 迁移一律走 pnpm migrate（项目唯一迁移口径，supabase CLI 不重放迁移，
 *   因 0024 加固的 schema_migrations 表由 lib/migrate.ts 运行时创建）。
 * - truncate 保留结构、重置序列：每次全量测试都从干净库开始，
 *   cleanup 脚本（e2e-cleanup.ts）从必需品降级为保险丝。
 * - 种子：管理员（migration 0027 自带，改密激活）+ 普通用户 + 博客文章，
 *   全部幂等 upsert。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

/** 最小 env 加载：进程环境优先，其次 .env.api-test，最后 .env.local（CI/本地 dev 回退） */
function loadEnv(): void {
  const candidates = [".env.api-test", ".env.local"];
  for (const f of candidates) {
    const p = resolve(process.cwd(), f);
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

loadEnv();

const DBURL = process.env.DATABASE_URL || "";
if (!DBURL) {
  console.error("[api-test:db] DATABASE_URL is required");
  process.exit(1);
}

/** public schema 全部业务表，按外键依赖无关（truncate 统一用 CASCADE） */
export async function truncateAll(): Promise<void> {
  const client = new Client({ connectionString: DBURL });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname='public'`
    );
    const tables = rows
      .map((r) => `"public"."${r.tablename}"`)
      .filter(
        (t) =>
          // 0024 之后 service_role 对这些表有完整权限；pg_stat 等系统视图不在 pg_tables
          !t.includes("schema_migrations")
      );
    if (tables.length > 0) {
      await client.query(
        `TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`
      );
    }
  } finally {
    await client.end();
  }
}

export async function grantServiceRole(): Promise<void> {
  const client = new Client({ connectionString: DBURL });
  await client.connect();
  try {
    await client.query(`
      DO $$
      DECLARE t text;
      BEGIN
        FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
          EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
        END LOOP;
        FOR t IN SELECT sequencename FROM pg_sequences WHERE schemaname='public' LOOP
          EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role', t);
        END LOOP;
      END $$;
    `);
  } finally {
    await client.end();
  }
}

/** 测试常量用户：普通用户 + 管理员。与 helpers 中的登录凭据一一对应。 */
export const SEED_USERS = {
  user: {
    email: "seed-user@test.local",
    password: "SeedUser123456",
    role: "user",
  },
} as const;

export async function seed(): Promise<void> {
  const client = new Client({ connectionString: DBURL });
  await client.connect();
  try {
    // 普通用户（active，可直接登录）：bcrypt hash 预生成（cost 12 与 lib/password 一致）。
    // users.email 无唯一约束（真实 Supabase 的唯一索引在 auth.users），用存在性守卫。
    const { rows: exist } = await client.query(
      `SELECT 1 FROM users WHERE email = $1`,
      [SEED_USERS.user.email]
    );
    if (exist.length === 0) {
      await client.query(
        `INSERT INTO users (uuid, email, nickname, password_hash, signin_type, signin_provider, role, status, must_change_password, created_at)
         VALUES ($1,$2,$3,$4,'credentials','credentials',$5,'active',false,now())`,
        [
          "seed-user-0000-4000-8000-0000000000aa",
          SEED_USERS.user.email,
          // 昵称前缀 seed-nick 是 e2e 头像断言（img[alt^="seed-nick"]）的不变量：
          // 空库首跑（db-reset 后）也必须成立，settings 用例只会在此基础上再改
          "seed-nick-e2e",
          "$2b$12$BI7ziEJE2LAhOSXm/ERW0eiBNxVhATXXRWAaL/8qAPg6Vy/sh0c6.", // SeedUser123456
          SEED_USERS.user.role,
        ]
      );
    }

    // 博客文章：search 接口数据
    await client.query(
      `INSERT INTO posts (uuid, slug, title, description, content, status, locale, created_at)
       VALUES ('post-seed-0000-4000-8000-000000000001','api-test-hello','API Test Hello','seed post','## hello','online','en',now())
       ON CONFLICT (uuid) DO NOTHING`
    );
  } finally {
    await client.end();
  }
}

export async function main(): Promise<void> {
  const t0 = Date.now();
  await grantServiceRole();
  await truncateAll();
  // truncate 清掉了迁移种子（0027 默认管理员等）→ 重放迁移找回它们：
  // 全部 DDL/种子均幂等（IF NOT EXISTS / ON CONFLICT），费用仅百毫秒级
  const { execSync } = await import("node:child_process");
  execSync("pnpm migrate", {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  });
  await seed();
  console.log(`[api-test:db] reset+seed done in ${Date.now() - t0}ms`);
}

// CLI 入口：scripts 引用 main()；直接执行请用 api-tests/run-db-lifecycle.ts
// （本文件会被 Playwright 转译为 CJS，不能使用 import.meta 判断入口）
export { main as runMain };
