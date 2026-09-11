"use client";

import { captureClientException } from "@/lib/telemetry";
import { useEffect } from "react";

/**
 * 根级兜底页（docs/16 v2）：root layout 自身崩溃时替换整棵树。
 *
 * - 必须自带 <html>/<body>（Next 约定），此时拿不到 i18n/主题/providers，
 *   文案用英文、样式内联，不依赖 globals.css 与字体加载
 * - 上报双通道：PostHog（captureClientException，未配置静默）+
 *   /api/log-client-error（此时 [locale] layout 上的全局 ErrorReporter
 *   已不在树上，需要本页显式上报）
 * - 上报全程吞错
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
    try {
      captureClientException(error);
    } catch {
      // 吞错
    }
    try {
      void fetch("/api/log-client-error", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "error",
          message: `[global-error] ${error.message}`,
          stack: error.stack || "",
          url: window.location.href,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // 吞错
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#fafafa",
          color: "#18181b",
        }}
      >
        <div style={{ textAlign: "center", padding: "0 24px" }}>
          <h1 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 12px" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#71717a", margin: "0 0 24px" }}>
            An unexpected error occurred. Please try again.
          </p>
          <button
            onClick={retry}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: "#18181b",
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
              marginRight: 12,
            }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #e4e4e7",
              color: "#18181b",
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            Back to home
          </a>
        </div>
      </body>
    </html>
  );
}
