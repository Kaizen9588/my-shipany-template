import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ip", () => ({ getClientIp: vi.fn(async () => "9.9.9.9") }));

import {
  WEBHOOK_MAX_BODY_BYTES,
  guardWebhookRequest,
  requestWithRawBody,
} from "@/lib/webhook-guard";

describe("lib/webhook-guard（N-5 body 上限防护）", () => {
  it("正常小 body 放行", async () => {
    const req = new Request("http://localhost/api/stripe-notify", {
      method: "POST",
      headers: { "content-length": "100" },
      body: "{}",
    });
    const r = await guardWebhookRequest(req);
    expect(r.ok).toBe(true);
  });

  it("超过 64KB 的 body 被 413 拒绝", async () => {
    const req = new Request("http://localhost/api/creem-notify", {
      method: "POST",
      headers: { "content-length": String(WEBHOOK_MAX_BODY_BYTES + 1) },
      body: new Uint8Array(WEBHOOK_MAX_BODY_BYTES + 1),
    });
    const r = await guardWebhookRequest(req);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(413);
  });

  it("无 content-length 头时按 body 实际大小放行（不误伤正常渠道请求）", async () => {
    const req = new Request("http://localhost/api/waffo-notify", {
      method: "POST",
      body: JSON.stringify({ eventType: "order.completed", data: {} }),
    });
    const r = await guardWebhookRequest(req);
    expect(r.ok).toBe(true);
    expect(r.rawBody).toContain("order.completed");
  });

  it("谎报小 content-length 的超大 body 仍被流式截断 413（审查修复回归）", async () => {
    const req = new Request("http://localhost/api/stripe-notify", {
      method: "POST",
      // 谎报 10 字节，实际 64KB+1
      headers: { "content-length": "10" },
      body: new Uint8Array(WEBHOOK_MAX_BODY_BYTES + 1),
    });
    const r = await guardWebhookRequest(req);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(413);
  });

  it("requestWithRawBody 重建的请求保留 headers 且 body 可再读（验签依赖）", async () => {
    const req = new Request("http://localhost/api/creem-notify", {
      method: "POST",
      headers: { "creem-signature": "sig123" },
      body: "payload",
    });
    const r = await guardWebhookRequest(req);
    const rebuilt = requestWithRawBody(req, r.rawBody || "");
    expect(rebuilt.headers.get("creem-signature")).toBe("sig123");
    await expect(rebuilt.text()).resolves.toBe("payload");
  });
});