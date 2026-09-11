"use client";

import {
  computeFingerprint,
  createFingerprintThrottle,
  isReportableClientError,
} from "@/lib/error-report";
import { captureClientException } from "@/lib/telemetry";
import { useEffect } from "react";

/**
 * 全局客户端错误捕获（docs/16 v2）：window error + unhandledrejection 统一上报。
 *
 * - 纯被动监听：不拦截、不改变任何错误行为，error.tsx 兜底页照常工作；
 *   未发生错误时零开销（事件驱动，非轮询）
 * - 指纹节流：同一错误 60s 只报一次、单次浏览上限 20 条，防错误风暴
 * - 上报链路全程吞错，绝不产生二次错误
 * - 未捕获异常同时送 PostHog（captureClientException，未配置时静默跳过），
 *   与 error.tsx 边界页的上报入口保持一致
 */

const SESSION_REPORT_CAP = 20;

function postReport(body: Record<string, unknown>): void {
  // keepalive：页面卸载/跳转时请求仍能发出
  void fetch("/api/log-client-error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}

export default function ErrorReporter() {
  useEffect(() => {
    const throttle = createFingerprintThrottle();
    let sent = 0;

    const send = (
      kind: "error" | "unhandledrejection",
      message: string,
      stack: string
    ) => {
      try {
        if (sent >= SESSION_REPORT_CAP) return;
        if (!isReportableClientError(message)) return;
        if (!throttle.allow(computeFingerprint(message, stack))) return;
        sent += 1;

        // PostHog 侧复用既有入口（error 对象重建 stack 便于聚合）
        try {
          const err = new Error(message);
          if (stack) err.stack = stack;
          captureClientException(err);
        } catch {
          // 吞错
        }

        postReport({ kind, message, stack, url: window.location.href });
      } catch {
        // 吞错：上报绝不能产生新错误
      }
    };

    const onError = (e: ErrorEvent) => {
      send(
        "error",
        e.message || (e.error ? String(e.error) : "unknown error"),
        (e.error instanceof Error && e.error.stack) || ""
      );
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      send(
        "unhandledrejection",
        reason instanceof Error ? reason.message : String(reason ?? "unknown rejection"),
        (reason instanceof Error && reason.stack) || ""
      );
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
