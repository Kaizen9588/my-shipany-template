import { describe, expect, it } from "vitest";
import { sendEmail, shouldSendToday } from "@/lib/email";

describe("lib/email（6.2）", () => {
  it("未配置 provider 时 sendEmail 返回 failed 不抛错", async () => {
    const result = await sendEmail({
      to: "test@example.com",
      template: "welcome",
      variables: {},
      category: "transactional",
    });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("no provider");
  });

  it("shouldSendToday 同 key 同一天只放行一次", () => {
    const key = `test:${Math.random()}`;
    expect(shouldSendToday(key)).toBe(true);
    expect(shouldSendToday(key)).toBe(false);
  });

  it("不同 key 互不影响", () => {
    const k1 = `a:${Math.random()}`;
    const k2 = `b:${Math.random()}`;
    expect(shouldSendToday(k1)).toBe(true);
    expect(shouldSendToday(k2)).toBe(true);
  });
});
