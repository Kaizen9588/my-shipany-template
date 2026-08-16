import { defineConfig } from "drizzle-kit";

/**
 * Drizzle 配置（P3）
 * 仅用于 generate（类型化 schema → SQL 迁移），push 请用 Supabase SQL editor 执行。
 * 最小迁移机制（lib/migrate.ts + data/migrations/）仍是运行时迁移的执行者。
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./data/drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
  verbose: true,
  strict: true,
});
