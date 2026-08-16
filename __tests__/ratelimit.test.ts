import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const store = vi.hoisted(() => ({ limiters: [] as any[] }));

// mock @upstash，捕获每个 Ratelimit 实例用的滑动窗口配置（max/window），
// 用于验证 Upstash 路径是否真的按调用方的 max 限制（回归 S2 半成品 bug）
vi.mock("@upstash/ratelimit", () => {
  class MockRatelimit {
    limiter: any;
    constructor(config: any) {
      this.limiter = config?.limiter;
      store.limiters.push(config?.limiter);
    }
    limit(identifier: string) {
      return this.limiter.limit(identifier);
    }
    static slidingWindow(max: number, window: string) {
      return {
        max,
        window,
        async limit() {
          return {
            success: true,
            remaining: max,
            reset: Date.now() + 1000 * 60,
          };
        },
      };
    }
  }
  return { Ratelimit: MockRatelimit };
});

vi.mock("@upstash/redis", () => ({
  Redis: {
    fromEnv: () => ({}),
  },
}));

import { rateLimit, rateLimitByIp, rateLimitUser } from "@/lib/ratelimit";

function setUpstashEnv() {
  process.env.UPSTASH_REDIS_REST_URL = "https://mock.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "mock-token";
}
function clearUpstashEnv() {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
}

describe("lib/ratelimit（6.0 v1 内存级限流）", () => {
  it("窗口内未超限放行", () => {
    const r1 = rateLimitByIp("1.2.3.4", 3, 60_000);
    const r2 = rateLimitByIp("1.2.3.4", 3, 60_000);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it("窗口内超限拒绝并给出重试秒数", () => {
    const ip = "5.6.7.8";
    rateLimitByIp(ip, 2, 60_000);
    rateLimitByIp(ip, 2, 60_000);
    const r3 = rateLimitByIp(ip, 2, 60_000);
    expect(r3.ok).toBe(false);
    expect(r3.retryAfterSeconds).toBeGreaterThan(0);
    expect(r3.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("不同 IP 相互独立", () => {
    rateLimitByIp("a", 1, 60_000);
    const other = rateLimitByIp("b", 1, 60_000);
    expect(other.ok).toBe(true);
  });
});

describe("lib/ratelimit Upstash 路径（回归：max 生效 + 付费配额）", () => {
  beforeEach(() => {
    store.limiters = [];
    setUpstashEnv();
  });
  afterEach(() => {
    clearUpstashEnv();
  });

  it("rateLimit 把调用方的 max 传给 Upstash（此前被忽略为 DEFAULT_MAX=30）", async () => {
    await rateLimit("verify:email:someone@example.com", 5);
    const windowLimiter = store.limiters.find((l) => l?.window === "60 s");
    expect(windowLimiter).toBeDefined();
    expect(windowLimiter.max).toBe(5);
  });

  it("rateLimitUser 付费用户创建 100/天 的限流器", async () => {
    await rateLimitUser("user-pro", true);
    const daily = store.limiters.find((l) => l?.window === "1 d");
    expect(daily).toBeDefined();
    expect(daily.max).toBe(100);
  });

  it("rateLimitUser 免费用户创建 10/天 的限流器", async () => {
    await rateLimitUser("user-free", false);
    const daily = store.limiters.find((l) => l?.window === "1 d");
    expect(daily).toBeDefined();
    expect(daily.max).toBe(10);
  });
});