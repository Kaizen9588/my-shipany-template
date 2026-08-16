import { describe, expect, it } from "vitest";
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "@/lib/password";

describe("lib/password（6.4 密码安全）", () => {
  it("哈希与验证往返一致", async () => {
    const hash = await hashPassword("abc12345");
    expect(hash).not.toBe("abc12345");
    expect(await verifyPassword("abc12345", hash)).toBe(true);
    expect(await verifyPassword("wrongpass1", hash)).toBe(false);
  });

  it("同一密码两次哈希不同（加盐）", async () => {
    const h1 = await hashPassword("abc12345");
    const h2 = await hashPassword("abc12345");
    expect(h1).not.toBe(h2);
  });

  it("强度校验：长度不足拒绝", () => {
    expect(validatePasswordStrength("a1")).not.toBeNull();
    expect(validatePasswordStrength("12345678")).not.toBeNull(); // 纯数字
    expect(validatePasswordStrength("abcdefgh")).not.toBeNull(); // 纯字母
  });

  it("强度校验：8 位以上字母+数字通过", () => {
    expect(validatePasswordStrength("abc12345")).toBeNull();
    expect(validatePasswordStrength("Password123")).toBeNull();
  });
});
