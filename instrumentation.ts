import { validateEnv } from "./lib/env";

/**
 * Next.js 服务启动钩子（App Router，根目录约定文件）。
 * - P-1.7：启动时校验环境变量，缺失必填项 fail fast
 * - P1-6/P1-7：运行时只读校验迁移版本；DDL 仅能由受控的 pnpm migrate / 部署步骤执行
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
    // 条件化动态导入：避免 Edge bundle 静态打包 pg（Node-only）。
    // 这里绝不执行 DDL，避免多实例或 serverless 冷启动中隐式改生产 schema。
    const { verifyMigrations } = await import("./lib/migrate");
    const { pending } = await verifyMigrations();
    if (pending.length > 0) {
      throw new Error(
        `database migrations are pending: ${pending.join(", ")}. Run pnpm migrate before starting the application.`
      );
    }
  } catch (e) {
    console.error("[migrate] schema verification failed:", e);
    throw e;
  }
}
