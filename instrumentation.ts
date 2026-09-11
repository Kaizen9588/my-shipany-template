import { validateEnv } from "./lib/env";
import type { FingerprintThrottle } from "./lib/error-report";

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
    const err = new Error(`invalid environment: ${env.errors.join("; ")}`);
    const { emitStartupFailure } = await import("./lib/oplog");
    await emitStartupFailure("environment validation", err);
    throw err;
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
    const { emitStartupFailure } = await import("./lib/oplog");
    await emitStartupFailure("migration verification", e);
    throw e;
  }
}

/**
 * 服务端请求级错误兜底（docs/16 v2，Next 15+ instrumentation 稳定 API）。
 *
 * 任何 server 请求未捕获异常（render / route / action / proxy）统一进
 * op_events（system.server_exception，error 级走 outbox + 告警），补齐
 * captureServerException 手动埋点（checkout/webhook/cron）之外的面。
 * 指纹节流防风暴：如 DB 不可达时每个请求都会炸，同因错误窗口内只落一条。
 * 全程吞错：监控自身不允许产生新错误。
 */
let serverErrorThrottle: FingerprintThrottle | null = null;

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: { [key: string]: string | string[] } },
  context: {
    routerKind: string;
    routePath: string;
    routeType: string;
  }
): Promise<void> {
  try {
    if (process.env.NEXT_RUNTIME === "edge") {
      return;
    }
    const { computeFingerprint, createFingerprintThrottle } = await import(
      "./lib/error-report"
    );
    if (!serverErrorThrottle) {
      serverErrorThrottle = createFingerprintThrottle();
    }

    const message = String(
      error instanceof Error ? error.message : error
    ).slice(0, 500);
    const stack = error instanceof Error ? (error.stack || "").slice(0, 1500) : "";
    if (!serverErrorThrottle.allow(computeFingerprint(message, stack))) {
      return;
    }

    const digest =
      error instanceof Error ? (error as { digest?: string }).digest : undefined;
    const { recordOpEvent } = await import("./lib/oplog");
    recordOpEvent({
      event_type: "system.server_exception",
      severity: "error",
      source: "app",
      detail: {
        message,
        digest,
        path: String(request.path || "").slice(0, 500),
        method: request.method,
        routePath: context.routePath,
        routeType: context.routeType,
        routerKind: context.routerKind,
      },
    });
  } catch {
    // 吞错
  }
}
