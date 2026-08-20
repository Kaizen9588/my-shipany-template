/**
 * 统一日志封装（P-1.7）
 *
 * 替代散落的 console.log，为后续结构化日志 / PostHog 错误追踪做准备。
 * 目标：业务代码统一使用 logger，错误统一走 logger.error（未来可接入上报）。
 * 当前已接入：支付 checkout 入口与三个支付 webhook 路由的失败路径；
 * 其余模块仍在渐进收敛中，新增代码请优先用本封装而不是 console.*。
 */

type LogContext = Record<string, unknown>;

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) {
        return a.stack || a.message;
      }
      if (typeof a === "object") {
        try {
          return JSON.stringify(a);
        } catch (e) {
          return String(a);
        }
      }
      return String(a);
    })
    .join(" ");
}

export const logger = {
  debug(...args: unknown[]) {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[debug]", formatArgs(args));
    }
  },

  info(...args: unknown[]) {
    console.log("[info]", formatArgs(args));
  },

  warn(...args: unknown[]) {
    console.warn("[warn]", formatArgs(args));
  },

  /**
   * 记录错误。context 为结构化上下文，未来接入 PostHog 错误追踪时
   * 在此统一上报（异常 + breadcrumb）。
   */
  error(err: unknown, context?: LogContext) {
    const detail = err instanceof Error ? err.stack || err.message : String(err);
    console.error("[error]", detail, context ? JSON.stringify(context) : "");
  },
};
