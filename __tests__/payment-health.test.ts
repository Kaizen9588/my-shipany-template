import { beforeEach, describe, expect, it } from "vitest";
import {
  isProviderHealthy,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/payment/health";

describe("lib/payment/health（6.1 failover）", () => {
  beforeEach(() => {
    // 清空内部状态：通过 recordProviderSuccess 触发 delete
    recordProviderSuccess("stripe");
    recordProviderSuccess("creem");
    recordProviderSuccess("waffo");
  });

  it("初始健康", () => {
    expect(isProviderHealthy("stripe")).toBe(true);
  });

  it("连续失败 5 次后标记 unhealthy", () => {
    for (let i = 0; i < 5; i++) {
      expect(isProviderHealthy("stripe")).toBe(true);
      recordProviderFailure("stripe");
    }
    expect(isProviderHealthy("stripe")).toBe(false);
  });

  it("成功调用恢复健康", () => {
    for (let i = 0; i < 5; i++) {
      recordProviderFailure("creem");
    }
    expect(isProviderHealthy("creem")).toBe(false);
    recordProviderSuccess("creem");
    expect(isProviderHealthy("creem")).toBe(true);
  });

  it("不同渠道相互独立", () => {
    for (let i = 0; i < 5; i++) {
      recordProviderFailure("waffo");
    }
    expect(isProviderHealthy("waffo")).toBe(false);
    expect(isProviderHealthy("stripe")).toBe(true);
  });
});
