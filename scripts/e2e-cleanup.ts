/**
 * E2E 测试数据清理：删除所有 e2e-* 测试用户及其关联数据。
 *
 * 用途：
 * - 本地反复跑 E2E 后清理测试用户（同时绕开注册每 IP 日配额的堆积）
 * - CI 跑完后清理（CI 每次新进程，内存限流天然干净，此脚本主要用于测试库巡检）
 *
 * 用法：node --experimental-strip-types scripts/e2e-cleanup.ts
 * （自动从 .env.e2e-test 读 DATABASE_URL——E2E 现在跑在本地 Supabase 栈；
 *   进程环境变量优先，文件缺失时退回 .env.local 兼容旧用法）
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

function loadEnvFile(f: string): boolean {
  const envFile = resolve(process.cwd(), f);
  if (!existsSync(envFile)) return false;
  for (const raw of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

// E2E 已切本地栈：.env.e2e-test 优先；没有该文件时退回 .env.local（老流程）
if (!loadEnvFile(".env.e2e-test")) loadEnvFile(".env.local");

const DBURL = process.env.DATABASE_URL || "";
if (!DBURL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DBURL,
  // Supabase pooler 走事务模式时 prepared statement 需要关闭
  max: 5,
});

async function main() {
  const client = await pool.connect();
  try {
    const users = await client.query(
      `SELECT uuid, email FROM users WHERE email LIKE 'e2e-%'`
    );
    if (users.rows.length === 0) {
      console.log("no e2e test users found");
      return;
    }
    const uuids = users.rows.map((r) => r.uuid);
    console.log(
      `found ${uuids.length} e2e users:`,
      users.rows.map((r) => r.email).join(", ")
    );

    // 关联数据按 uuid 逐表清理（users 被 5 张表外键引用，顺序：先子后父）
    const emails = users.rows.map((r) => r.email);
    for (const [table, col] of [
      ["credit_lots", "user_uuid"],
      ["affiliates", "user_uuid"],
      ["credits", "user_uuid"],
      ["orders", "user_uuid"],
      ["apikeys", "user_uuid"],
      ["notifications", "user_uuid"],
    ] as const) {
      const res = await client.query(
        `DELETE FROM ${table} WHERE ${col} = ANY($1::text[])`,
        [uuids]
      );
      if (res.rowCount) console.log(`deleted ${res.rowCount} rows from ${table}`);
    }
    const codes = await client.query(
      `DELETE FROM verification_codes WHERE email = ANY($1::text[])`,
      [emails]
    );
    if (codes.rowCount) console.log(`deleted ${codes.rowCount} verification codes`);

    const res = await client.query(
      `DELETE FROM users WHERE uuid = ANY($1::text[])`,
      [uuids]
    );
    console.log(`deleted ${res.rowCount} users`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
