import { describe, expect, it } from "vitest";

import {
  CLIENT_ERROR_MESSAGE_MAX,
  CLIENT_ERROR_STACK_MAX,
  CLIENT_ERROR_URL_MAX,
  computeFingerprint,
  createFingerprintThrottle,
  isReportableClientError,
  parseClientErrorPayload,
} from "@/lib/error-report";

describe("computeFingerprint", () => {
  it("同输入产出稳定指纹", () => {
    const a = computeFingerprint("boom", "Error: boom\n    at foo (/app/x.ts:1:2)");
    const b = computeFingerprint("boom", "Error: boom\n    at foo (/app/x.ts:1:2)");
    expect(a).toBe(b);
    expect(a).not.toBe("");
  });

  it("message 或堆栈首帧不同 → 指纹不同", () => {
    const base = computeFingerprint("boom", "Error: boom\n    at foo (/app/x.ts:1:2)");
    expect(computeFingerprint("boom2", "Error: boom\n    at foo (/app/x.ts:1:2)")).not.toBe(base);
    expect(computeFingerprint("boom", "Error: boom\n    at bar (/app/y.ts:9:9)")).not.toBe(base);
  });

  it("无堆栈时按 no-stack 归位，message 仍参与指纹", () => {
    expect(computeFingerprint("a")).toBe(computeFingerprint("a", ""));
    expect(computeFingerprint("a")).not.toBe(computeFingerprint("b"));
  });
});

describe("isReportableClientError", () => {
  it("过滤跨域脱敏与良性噪音", () => {
    expect(isReportableClientError("")).toBe(false);
    expect(isReportableClientError("   ")).toBe(false);
    expect(isReportableClientError("Script error.")).toBe(false);
    expect(isReportableClientError("script error")).toBe(false);
    expect(isReportableClientError("ResizeObserver loop limit exceeded")).toBe(false);
    expect(isReportableClientError("ResizeObserver loop completed with undelivered notifications.")).toBe(false);
  });

  it("正常错误放行", () => {
    expect(isReportableClientError("Cannot read properties of undefined (reading 'x')")).toBe(true);
  });
});

describe("createFingerprintThrottle", () => {
  it("同指纹窗口内只放行一次，窗口过后重新放行", () => {
    let t = 1_000;
    const throttle = createFingerprintThrottle({ intervalMs: 60_000, now: () => t });
    expect(throttle.allow("fp1")).toBe(true);
    expect(throttle.allow("fp1")).toBe(false);
    t += 59_999;
    expect(throttle.allow("fp1")).toBe(false);
    t += 1;
    expect(throttle.allow("fp1")).toBe(true);
  });

  it("不同指纹互不影响", () => {
    const throttle = createFingerprintThrottle({ now: () => 1_000 });
    expect(throttle.allow("a")).toBe(true);
    expect(throttle.allow("b")).toBe(true);
    expect(throttle.allow("a")).toBe(false);
    expect(throttle.allow("b")).toBe(false);
  });

  it("条目数硬上限：达上限丢过期项，仍超限丢最老项，不无界增长", () => {
    let t = 1_000;
    const throttle = createFingerprintThrottle({
      intervalMs: 60_000,
      maxEntries: 3,
      now: () => t,
    });
    throttle.allow("a");
    throttle.allow("b");
    t += 61_000; // a、b 均已过期
    throttle.allow("c"); // 触发清理
    expect(throttle.allow("a")).toBe(true); // 过期被清 → 重新放行
    throttle.allow("d");
    throttle.allow("e");
    // 已达 3 条（c/d/e），插入 f 应挤掉最老的 c 而不是无限增长
    throttle.allow("f");
    expect(throttle.allow("c")).toBe(true); // c 被挤出 → 视为新条目放行
    expect(throttle.allow("f")).toBe(false); // f 仍在窗口内
  });
});

describe("parseClientErrorPayload", () => {
  it("合法载荷：字段收口 + 指纹生成", () => {
    const longMsg = "x".repeat(600);
    const parsed = parseClientErrorPayload({
      kind: "unhandledrejection",
      message: longMsg,
      stack: "y".repeat(5_000),
      url: "z".repeat(2_000),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe("unhandledrejection");
    expect(parsed.value.message.length).toBeLessThanOrEqual(CLIENT_ERROR_MESSAGE_MAX);
    expect(parsed.value.stack.length).toBeLessThanOrEqual(CLIENT_ERROR_STACK_MAX);
    expect(parsed.value.url.length).toBeLessThanOrEqual(CLIENT_ERROR_URL_MAX);
    expect(parsed.value.fingerprint).not.toBe("");
  });

  it("kind 缺省归位为 error", () => {
    const parsed = parseClientErrorPayload({ message: "boom" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.kind).toBe("error");
  });

  it("非对象/空消息 → 校验失败", () => {
    expect(parseClientErrorPayload(null).ok).toBe(false);
    expect(parseClientErrorPayload("str").ok).toBe(false);
    expect(parseClientErrorPayload({ message: "  " }).ok).toBe(false);
    expect(parseClientErrorPayload({}).ok).toBe(false);
  });

  it("噪音消息归为 unreportable（端点按 204 静默吞掉）", () => {
    const parsed = parseClientErrorPayload({ message: "Script error." });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("unreportable");
  });
});
