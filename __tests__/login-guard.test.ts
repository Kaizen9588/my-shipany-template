import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLoginFailure,
  isLoginLocked,
  recordLoginFailure,
} from "@/lib/login-guard";

describe("lib/login-guard（6.4 登录失败锁定）", () => {
  beforeEach(() => {
    clearLoginFailure("test@example.com", "1.2.3.4");
  });

  it("初始状态不锁定", () => {
    expect(isLoginLocked("test@example.com", "1.2.3.4").locked).toBe(false);
  });

  it("邮箱 5 次失败后锁定", () => {
    for (let i = 0; i < 5; i++) {
      expect(
        isLoginLocked("test@example.com", "1.2.3.4").locked
      ).toBe(false);
      recordLoginFailure("test@example.com", "1.2.3.4");
    }
    const r = isLoginLocked("test@example.com", "1.2.3.4");
    expect(r.locked).toBe(true);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it("IP 10 次失败后锁定", () => {
    for (let i = 0; i < 10; i++) {
      recordLoginFailure(`spam${i}@example.com`, "10.0.0.1");
    }
    const r = isLoginLocked("anything@example.com", "10.0.0.1");
    expect(r.locked).toBe(true);
  });

  it("clearLoginFailure 解除锁定", () => {
    for (let i = 0; i < 5; i++) {
      recordLoginFailure("test@example.com", "1.2.3.4");
    }
    clearLoginFailure("test@example.com", "1.2.3.4");
    expect(isLoginLocked("test@example.com", "1.2.3.4").locked).toBe(false);
  });
});
