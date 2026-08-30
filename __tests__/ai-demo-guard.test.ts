import { APICallError } from "@ai-sdk/provider";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    rpc: vi.fn(),
    from: vi.fn(),
    rateLimit: vi.fn(),
    getClientIp: vi.fn(),
    generateText: vi.fn(),
    getModelProvider: vi.fn(),
  };
});

vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("@/lib/ip", () => ({ getClientIp: mocks.getClientIp }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/ai/registry", () => ({ getModelProvider: mocks.getModelProvider }));
vi.mock("@/models/db", () => ({
  getSupabaseClient: vi.fn(() => ({
    rpc: mocks.rpc,
    from: mocks.from,
  })),
}));

import { POST } from "@/app/api/v1/ai/demo/route";

function mockRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/ai/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** anonymous_usage 表的内存模拟（from().select().eq().eq().maybeSingle() 读失败计数） */
function setupDb({ incrementResults, failCount = 0 }: {
  incrementResults: Array<number | null>;
  failCount?: number;
}) {
  let call = 0;
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "increment_anonymous_usage") {
      const v = incrementResults[Math.min(call, incrementResults.length - 1)];
      call += 1;
      return { data: v, error: null };
    }
    if (fn === "decrement_anonymous_usage") {
      return { data: 0, error: null };
    }
    return { data: null, error: null };
  });
  const eq = vi.fn().mockReturnThis();
  const maybeSingle = vi.fn().mockResolvedValue({
    data: failCount > 0 ? { count: failCount } : null,
  });
  mocks.from.mockReturnValue({
    select: vi.fn().mockReturnValue({ eq, maybeSingle }),
  });
  return () => call;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEMO_MODEL = "deepseek-chat";
  process.env.ANONYMOUS_DAILY_LIMIT = "3";
  delete process.env.DEMO_MAX_PROMPT_BYTES;
  delete process.env.DEMO_FAILURE_DAILY_LIMIT;
  delete process.env.DEMO_RATELIMIT_PER_MIN;

  mocks.getClientIp.mockResolvedValue("1.2.3.4");
  mocks.rateLimit.mockResolvedValue({ ok: true, remaining: 29 });
  mocks.getModelProvider.mockReturnValue({
    createModel: vi.fn().mockReturnValue({}),
  });
});

describe("P0-4：匿名 demo 输入硬限制与失败计次（docs/14 §2.5）", () => {
  it("字段白名单：携带未知字段的请求 400，不消耗次数", async () => {
    const getIncCalls = setupDb({ incrementResults: [1] });

    const resp = await POST(mockRequest({ prompt: "hi", model: "gpt-4o" }));
    expect(resp.status).toBe(400);
    expect(getIncCalls()).toBe(0);
  });

  it("prompt 超过字节上限返回 413 且照常消耗次数（校验不构成免费重试通道）", async () => {
    const getIncCalls = setupDb({ incrementResults: [1] });

    const bigPrompt = "a".repeat(8193);
    const resp = await POST(mockRequest({ prompt: bigPrompt }));

    expect(resp.status).toBe(413);
    expect(getIncCalls()).toBe(1); // 已消耗
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("正常请求消耗次数并返回结果", async () => {
    setupDb({ incrementResults: [1] });
    mocks.generateText.mockResolvedValue({ text: "hello" });

    const resp = await POST(mockRequest({ prompt: "hi" }));
    const body = await resp.json();

    expect(resp.status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data.text).toBe("hello");
    expect(body.data.remaining).toBe(2);
  });

  it("provider 4xx（内容策略等）计次不退还", async () => {
    setupDb({ incrementResults: [1] });
    const apiError = new APICallError({
      message: "content policy",
      statusCode: 400,
      url: "https://api.test",
      requestBodyValues: {},
    });
    mocks.generateText.mockRejectedValue(apiError);

    const resp = await POST(mockRequest({ prompt: "hi" }));
    expect(resp.status).toBe(500);

    // 只调用了 increment（主计数 + 失败计数），没有 decrement 退还
    const fns = mocks.rpc.mock.calls.map((c) => c[0]);
    expect(fns.filter((f: string) => f === "increment_anonymous_usage").length).toBe(2);
    expect(fns).not.toContain("decrement_anonymous_usage");
  });

  it("本地异常（provider 缺失等）退还次数，同时累计当日失败次数", async () => {
    setupDb({ incrementResults: [1, 1] });
    mocks.getModelProvider.mockReturnValue(null); // 本地配置错误 → 无上游费用

    const resp = await POST(mockRequest({ prompt: "hi" }));
    expect(resp.status).toBe(500);

    const fns = mocks.rpc.mock.calls.map((c) => c[0]);
    expect(fns).toContain("decrement_anonymous_usage");
    expect(fns.filter((f: string) => f === "increment_anonymous_usage").length).toBe(2);
  });

  it("当日失败次数达到上限（默认 10）后直接 429，不再进入生成", async () => {
    setupDb({ incrementResults: [1], failCount: 10 });

    const resp = await POST(mockRequest({ prompt: "hi" }));
    expect(resp.status).toBe(429);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("分钟级限流不通过时 429，且不消耗每日次数", async () => {
    const getIncCalls = setupDb({ incrementResults: [1] });
    mocks.rateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 30 });

    const resp = await POST(mockRequest({ prompt: "hi" }));
    expect(resp.status).toBe(429);
    expect(getIncCalls()).toBe(0);
  });
});
