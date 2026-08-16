import { validateEnv } from "./lib/env";

/**
 * Next.js 服务启动钩子（App Router，根目录约定文件）。
 * - P-1.7：启动时校验环境变量，缺失必填项 fail fast
 * - P-1.12：自动执行未应用的数据库迁移（幂等，见 lib/migrate.ts）
 *
 * 构建阶段不执行，避免 build 时误连数据库 / 误报环境缺失。
 * Edge 运行时跳过（pg 是 Node-only 模块），迁移只在 Node 运行时执行。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  const env = validateEnv();
  if (!env.ok) {
    console.error("[env] missing required variables:", env.errors.join("; "));
    throw new Error(`invalid environment: ${env.errors.join("; ")}`);
  }
  if (env.warnings.length > 0) {
    console.warn("[env] warnings:", env.warnings.join("; "));
  }

  try {
    // 条件化动态导入：避免 Edge bundle 静态打包 pg（Node-only）
    const { runMigrations } = await import("./lib/migrate");
    const { applied, pending } = await runMigrations();
    if (applied.length > 0) {
      console.log("[migrate] applied:", applied.join(", "));
    }
    if (pending.length > 0) {
      console.warn("[migrate] pending:", pending.join(", "));
    }
  } catch (e) {
    // 迁移失败必须暴露，不能让服务带着残缺 schema 运行
    console.error("[migrate] failed:", e);
    throw e;
  }
}
