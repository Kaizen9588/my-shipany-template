import { describe, expect, it } from "vitest";
import { getSnowId, getUuid, hashString } from "@/lib/hash";

describe("lib/hash", () => {
  it("hashString 输出 64 位 hex，且确定性", () => {
    const h1 = hashString("sk-test-key");
    const h2 = hashString("sk-test-key");
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });

  it("hashString 不同输入输出不同", () => {
    expect(hashString("sk-a")).not.toBe(hashString("sk-b"));
  });

  it("getUuid 生成标准 UUID", () => {
    const u = getUuid();
    expect(u).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("getSnowId 连续生成不重复", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => getSnowId()));
    expect(ids.size).toBe(1000);
  });
});
