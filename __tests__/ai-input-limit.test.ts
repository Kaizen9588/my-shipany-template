import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AI generate 输入硬限制（docs/13 v1.5，与 demo 路由同规）：
 * - prompt/messages 字节上限 -> 413
 * - messages 条数上限 -> 413
 * - 字段白名单：messages 项仅 {role: system|user|assistant, content: string} -> 400
 * - 校验在扣费之前（已过限流），413 不构成计费/免费重试通道
 */

const mocks = vi.hoisted(() => {
  return {
    getUserUuid: vi.fn(),
    getClientIp: vi.fn(),
    rateLimit: vi.fn(),
    rateLimitUser: vi.fn(),
    getUserCredits: vi.fn(),
    decreaseCredits: vi.fn(),
    generateText: vi.fn(),
    getModelProvider: vi.fn(),
    // ai_requests 链式桩（from() 队列弹出，同 ai-request.test.ts）
    clientFrom: vi.fn(),
    chainQueue: [] as any[],
  };
});

function makeChain(opts: { maybeResult?: any; awaitResult?: any } = {}) {
  const c: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: undefined,
  };
  c.then = (_res: any, _rej: any) =>
    Promise.resolve(c.__awaitResult).then(_res, _rej);
  c.__awaitResult = opts.awaitResult || { data: null, error: null };
  c.maybeSingle = vi
    .fn()
    .mockImplementation(async () => opts.maybeResult || { data: null, error: null });
  return c;
}

function stubChain(opts: { maybeResult?: any; awaitResult?: any } = {}) {
  const c = makeChain(opts);
  mocks.chainQueue.push(c);
  return c;
}

vi.mock("@/services/user", () => ({ getUserUuid: mocks.getUserUuid }));
vi.mock("@/lib/ip", () => ({ getClientIp: mocks.getClientIp }));
vi.mock("@/lib/ratelimit", () => ({
  rateLimit: mocks.rateLimit,
  rateLimitUser: mocks.rateLimitUser,
}));
vi.mock("@/services/credit", () => ({
  CreditsTransType: { AiGenerate: "ai_generate", AiRefund: "ai_refund" },
  InsufficientCreditsError: class extends Error {
    balance: number;
    constructor(balance: number) {
      super("insufficient");
      this.balance = balance;
    }
  },
  decreaseCredits: mocks.decreaseCredits,
  getUserCredits: mocks.getUserCredits,
  increaseCredits: vi.fn(),
}));
vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("@/lib/ai/registry", () => ({ getModelProvider: mocks.getModelProvider }));
vi.mock("@/models/db", () => ({
  serverClient: () => ({ from: mocks.clientFrom }),
}));

import { POST } from "@/app/api/v1/ai/generate/route";

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const validBody = { model: "deepseek-chat", prompt: "hi" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chainQueue.length = 0;
  mocks.clientFrom.mockReset();
  mocks.clientFrom.mockImplementation(() => {
    const c = mocks.chainQueue.shift();
    if (!c) throw new Error("no more stubbed chains");
    return c;
  });
  delete process.env.AI_MAX_PROMPT_BYTES;
  delete process.env.AI_MAX_MESSAGES;
  // 定价用 data/model-pricing.ts 真实常量（MODEL_PRICING 硬编码，不读 env）：
  // deepseek-chat = { provider: "deepseek", credits_per_1k_tokens: 0.14, max_output_tokens: 4096 }
  mocks.getUserUuid.mockResolvedValue("u-1");
  mocks.getClientIp.mockResolvedValue("1.2.3.4");
  mocks.rateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 60 });
  mocks.rateLimitUser.mockResolvedValue({ ok: true, retryAfterSeconds: 60 });
  mocks.getUserCredits.mockResolvedValue({ left_credits: 1000 });
  mocks.getModelProvider.mockReturnValue({ createModel: vi.fn() });
});

describe("generate 输入硬限制（413 / 白名单 400）", () => {
  it("prompt 超过默认 32KB 上限 -> 413，未扣费", async () => {
    const big = "a".repeat(32769);
    const resp = await POST(req({ ...validBody, prompt: big }));
    expect(resp.status).toBe(413);
    const j = await resp.json();
    expect(j.data.max_prompt_bytes).toBe(32768);
    expect(mocks.decreaseCredits).not.toHaveBeenCalled();
  });

  it("AI_MAX_PROMPT_BYTES 环境变量可调小", async () => {
    process.env.AI_MAX_PROMPT_BYTES = "100";
    const resp = await POST(req({ ...validBody, prompt: "a".repeat(101) }));
    expect(resp.status).toBe(413);
    expect((await resp.json()).data.max_prompt_bytes).toBe(100);
  });

  it("messages 总字节超限 -> 413", async () => {
    const resp = await POST(
      req({
        model: "deepseek-chat",
        messages: [
          { role: "user", content: "a".repeat(20000) },
          { role: "assistant", content: "b".repeat(20000) },
        ],
      })
    );
    expect(resp.status).toBe(413);
  });

  it("messages 条数超过默认 50 -> 413", async () => {
    const messages = Array.from({ length: 51 }, (_, i) => ({
      role: "user",
      content: `m${i}`,
    }));
    const resp = await POST(req({ model: "deepseek-chat", messages }));
    expect(resp.status).toBe(413);
    expect((await resp.json()).data.max_messages).toBe(50);
  });

  it("白名单：messages 项缺 content / role 非法 -> 400", async () => {
    const bad1 = await POST(
      req({ model: "deepseek-chat", messages: [{ role: "user" }] })
    );
    expect(bad1.status).toBe(400);

    const bad2 = await POST(
      req({
        model: "deepseek-chat",
        messages: [{ role: "tool", content: "x" }],
      })
    );
    expect(bad2.status).toBe(400);
    expect(mocks.decreaseCredits).not.toHaveBeenCalled();
  });

  it("messages 非数组 / prompt 非字符串 -> 400", async () => {
    const bad1 = await POST(req({ model: "deepseek-chat", messages: "hi" }));
    expect(bad1.status).toBe(400);
    const bad2 = await POST(req({ model: "deepseek-chat", prompt: 123 }));
    expect(bad2.status).toBe(400);
  });

  it("合法 messages 输入（≤50 条、≤32KB）正常放行到扣费", async () => {
    // 两条链：beginAiRequest INSERT running + markAiRequestSucceeded 条件流转
    stubChain({ maybeResult: { data: { id: 1, status: "running" }, error: null } });
    stubChain({ maybeResult: { data: { id: 1, status: "succeeded" }, error: null } });
    mocks.decreaseCredits.mockResolvedValue(1);
    mocks.generateText.mockResolvedValue({
      text: "ok",
      usage: { promptTokens: 1, completionTokens: 1 },
    });

    const resp = await POST(
      req({
        model: "deepseek-chat",
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
          { role: "user", content: "bye" },
        ],
      })
    );
    expect(resp.status).toBe(200);
    expect(mocks.decreaseCredits).toHaveBeenCalledTimes(1);
  });
});
