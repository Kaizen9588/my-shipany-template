import { after } from "next/server";

/**
 * 副作用执行模型（docs/16 §5，handoff P1「副作用执行模型」）：
 *
 * 裸 `void promise` 在 serverless（Vercel）上是不可靠的——响应一旦返回，运行时
 * 可能立即冻结/回收函数实例，尚未完成的副作用（审计落库、告警外呼、邮件发送）
 * 会被静默丢弃，没有任何重试机会。
 *
 * `after()`（next/server，Next 16 stable）把回调注册到「响应完成后、函数冻结前」
 * 的平台保证窗口内执行，且响应失败/redirect/notFound 时仍会执行。本函数统一包一层：
 * - 请求作用域内（Route Handler / Server Action / RSC）：走 after()，平台保证执行；
 * - 请求作用域外（迁移脚本、cron 直调、单测等，E468）：同步回退 `void work()`，
 *   行为与旧 fire-and-forget 一致；
 * - after() 环境性不可用（自托管无 waitUntil，E91 等）：**显式告警**并回退——
 *   不能静默降级，否则部署形态变化会让所有副作用悄悄回到丢失形态（审查修复）。
 *
 * 传入的 work 自身必须吞错（审计/oplog/notify/email 均已如此），after() 中的异常
 * 由 Next reportTaskError 记 console，不影响已发出的响应。
 */
let warnedAfterUnavailable = false;

function fallbackInBackground(work: () => Promise<unknown> | unknown, reason: string): void {
  if (!warnedAfterUnavailable) {
    warnedAfterUnavailable = true;
    // 不能用 trackCriticalEvent：它自身依赖本函数，会递归
    console.error(
      `[after-response] after() unavailable (${reason}); falling back to bare background execution. ` +
        `Side effects may be lost on freezing platforms — fix deployment (waitUntil required).`
    );
  }
  void Promise.resolve()
    .then(work)
    .catch((e) => {
      console.error("[after-response] background work failed:", e);
    });
}

export function runAfterResponse(work: () => Promise<unknown> | unknown): void {
  try {
    after(async () => {
      await work();
    });
  } catch (e: any) {
    const code = String(e?.__NEXT_ERROR_CODE || "");
    if (code === "E468") {
      // `after()` outside a request scope：迁移/cron/单测等合法场景，静默回退
      fallbackInBackground(work, "outside request scope");
    } else {
      // E91（waitUntil 不可用）/ 其他：环境性不可用，必须显式暴露
      fallbackInBackground(work, `error ${code || "unknown"}: ${e?.message || e}`);
    }
  }
}
