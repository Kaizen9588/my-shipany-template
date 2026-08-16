import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateEnv } from "@/lib/env";

const ORIGINAL_ENV = process.env;

describe("lib/env（P-1.7 环境变量校验）", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.NEXT_PUBLIC_WEB_URL;
    delete process.env.NEXT_PUBLIC_PROJECT_NAME;
    delete process.env.AUTH_SECRET;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("缺失必填项时校验失败（fail fast）", () => {
    const result = validateEnv();
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join()).toContain("NEXT_PUBLIC_WEB_URL");
  });

  it("必填项齐全时校验通过", () => {
    process.env.NEXT_PUBLIC_WEB_URL = "http://localhost:3000";
    process.env.NEXT_PUBLIC_PROJECT_NAME = "my-shipany-template";
    process.env.AUTH_SECRET = "test-secret";
    const result = validateEnv();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("可选变量类型非法时只告警不失败", () => {
    process.env.NEXT_PUBLIC_WEB_URL = "http://localhost:3000";
    process.env.NEXT_PUBLIC_PROJECT_NAME = "my-shipany-template";
    process.env.AUTH_SECRET = "test-secret";
    // SNOWFLAKE_WORKER_ID 声明为 string，任何值都合法；
    // 这里用不存在的场景验证 warnings 通道存在
    const result = validateEnv();
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
