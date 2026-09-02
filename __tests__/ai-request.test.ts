import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P1 AI 请求状态机（迁移 0032）服务层单测：
 * - beginAiRequest：新键落 running / 同键同体 succeeded|running 409 /
 *   同键异体 422 / failed|refunded 条件重占 / 占用 0 行当冲突
 * - markAiRequestSucceeded / markAiRequestFailed：条件流转与退款
 * - compensateStaleAiRequests：running 滞留补偿 + refund_pending 重试
 * - cleanupCompletedAiRequests：24h TTL 清理
 *
 * 桩模式：from() 调用队列弹出（一次流程串多条链，后 stub 不覆盖前 stub）。
 */

const mocks = vi.hoisted(() => {
  const chainQueue: any[] = [];
  const makeChain = (opts: { maybeResult?: any; awaitResult?: any } = {}) => {
    const c: any = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
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
  };
  return {
    chainQueue,
    makeChain,
    clientFrom: vi.fn(),
    increaseCredits: vi.fn(),
  };
});

vi.mock("@/models/db", () => ({
  serverClient: () => ({ from: mocks.clientFrom }),
}));
vi.mock("@/services/credit", () => ({
  CreditsTransType: { AiRefund: "ai_refund" },
  increaseCredits: mocks.increaseCredits,
}));

import {
  beginAiRequest,
  bodyFingerprint,
  cleanupCompletedAiRequests,
  compensateStaleAiRequests,
  isValidRequestId,
  markAiRequestFailed,
  markAiRequestSucceeded,
  type AiRequestRow,
} from "@/lib/ai-request";

/** 按调用顺序排队一条链；lib 里每次 from() 弹出一条 */
function stubChain(opts: { maybeResult?: any; awaitResult?: any } = {}) {
  const c = mocks.makeChain(opts);
  mocks.chainQueue.push(c);
  return c;
}

function makeRow(over: Record<string, unknown> = {}): AiRequestRow {
  return {
    id: 21,
    request_id: "key-1",
    user_uuid: "u-1",
    model: "deepseek-chat",
    provider: "deepseek",
    estimated_credits: 50,
    body_fingerprint: "fp-A",
    status: "running",
    input_tokens: null,
    output_tokens: null,
    error_message: "",
    refund_attempts: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    completed_at: null,
    ...over,
  } as AiRequestRow;
}

const baseInput = {
  request_id: "key-1",
  user_uuid: "u-1",
  model: "deepseek-chat",
  provider: "deepseek",
  estimated_credits: 50,
  fingerprint: "fp-A",
};

beforeEach(() => {
  mocks.chainQueue.length = 0;
  mocks.clientFrom.mockReset();
  mocks.clientFrom.mockImplementation(() => {
    const c = mocks.chainQueue.shift();
    if (!c) {
      throw new Error("test setup error: no more stubbed ai_requests chains");
    }
    return c;
  });
  mocks.increaseCredits.mockReset();
  mocks.increaseCredits.mockResolvedValue(undefined);
});

describe("isValidRequestId", () => {
  it("接受 1~128 位 URL 安全字符，拒绝空串/超长/特殊字符", () => {
    expect(isValidRequestId("abc-123_4.5")).toBe(true);
    expect(isValidRequestId("")).toBe(false);
    expect(isValidRequestId("a".repeat(129))).toBe(false);
    expect(isValidRequestId("has space")).toBe(false);
    expect(isValidRequestId("中文键")).toBe(false);
    expect(isValidRequestId(123)).toBe(false);
  });
});

describe("bodyFingerprint", () => {
  it("同输入稳定、prompt/messages/max_tokens 任一变化指纹变化", () => {
    const a = bodyFingerprint({ model: "m", prompt: "hi", max_tokens: 100 });
    const b = bodyFingerprint({ model: "m", prompt: "hi", max_tokens: 100 });
    expect(a).toBe(b);
    expect(bodyFingerprint({ model: "m", prompt: "hi!", max_tokens: 100 })).not.toBe(a);
    expect(bodyFingerprint({ model: "m", prompt: "hi", max_tokens: 200 })).not.toBe(a);
    expect(
      bodyFingerprint({ model: "m", messages: [{ role: "user", content: "hi" }], max_tokens: 100 })
    ).not.toBe(a);
  });
});

describe("beginAiRequest", () => {
  it("新键：INSERT 成功返回 running 行，无冲突", async () => {
    const c = stubChain({ maybeResult: { data: makeRow(), error: null } });
    const { row, conflict_code } = await beginAiRequest(baseInput);
    expect(conflict_code).toBeNull();
    expect(row?.status).toBe("running");
    expect(c.insert).toHaveBeenCalled();
  });

  it("同键异体（指纹不同）：422，不重占", async () => {
    stubChain({ maybeResult: { data: null, error: { code: "23505", message: "duplicate" } } });
    const c2 = stubChain({ maybeResult: { data: makeRow({ body_fingerprint: "fp-B" }), error: null } });

    const { conflict_code } = await beginAiRequest(baseInput);
    expect(conflict_code).toBe(422);
    expect(c2.update).not.toHaveBeenCalled();
  });

  it("同键同体已成功：409，不重占", async () => {
    stubChain({ maybeResult: { data: null, error: { code: "23505", message: "duplicate" } } });
    const c2 = stubChain({ maybeResult: { data: makeRow({ status: "succeeded" }), error: null } });

    const { conflict_code } = await beginAiRequest(baseInput);
    expect(conflict_code).toBe(409);
    expect(c2.update).not.toHaveBeenCalled();
  });

  it("同键同体 running（在途）：409", async () => {
    stubChain({ maybeResult: { data: null, error: { code: "23505", message: "duplicate" } } });
    stubChain({ maybeResult: { data: makeRow({ status: "running" }), error: null } });

    const { conflict_code } = await beginAiRequest(baseInput);
    expect(conflict_code).toBe(409);
  });

  it("同键同体 failed/refunded：条件重占 running 继续处理", async () => {
    stubChain({ maybeResult: { data: null, error: { code: "23505", message: "duplicate" } } });
    stubChain({ maybeResult: { data: makeRow({ status: "failed" }), error: null } });
    const c3 = stubChain({ maybeResult: { data: makeRow({ status: "running" }), error: null } });

    const { row, conflict_code } = await beginAiRequest(baseInput);
    expect(conflict_code).toBeNull();
    expect(row?.status).toBe("running");
    // 重占条件：in("status", ["failed", "refunded"])
    expect(c3.in).toHaveBeenCalledWith("status", ["failed", "refunded"]);
  });

  it("重占 0 行（补偿并发处理中）：409 不重复扣费", async () => {
    stubChain({ maybeResult: { data: null, error: { code: "23505", message: "duplicate" } } });
    stubChain({ maybeResult: { data: makeRow({ status: "failed" }), error: null } });
    stubChain({ maybeResult: { data: null, error: null } }); // 重占 0 行

    const { conflict_code } = await beginAiRequest(baseInput);
    expect(conflict_code).toBe(409);
  });
});

describe("markAiRequestSucceeded / markAiRequestFailed", () => {
  it("成功：条件流转 running→succeeded 并记 usage", async () => {
    const c = stubChain({ maybeResult: { data: makeRow({ status: "succeeded" }), error: null } });
    await markAiRequestSucceeded(21, { input_tokens: 10, output_tokens: 20 });
    const patch = c.update.mock.calls[0][0];
    expect(patch.status).toBe("succeeded");
    expect(patch.input_tokens).toBe(10);
    expect(patch.completed_at).toBeTruthy();
    expect(c.eq.mock.calls.some((call: unknown[]) => call[1] === "running")).toBe(true);
  });

  it("失败且退款成功：failed 终态", async () => {
    stubChain({ maybeResult: { data: makeRow({ status: "refund_pending" }), error: null } }); // 占用
    stubChain({ awaitResult: { data: null, error: null } }); // 收口 update
    const outcome = await markAiRequestFailed(21, "u-1", 50, "boom");
    expect(outcome).toEqual({ status: "failed", refunded: true });
    expect(mocks.increaseCredits).toHaveBeenCalledWith(
      expect.objectContaining({ user_uuid: "u-1", credits: 50 })
    );
  });

  it("失败且退款抛错：refund_pending + attempts+1（cron 重试）", async () => {
    stubChain({ maybeResult: { data: makeRow({ status: "refund_pending" }), error: null } });
    mocks.increaseCredits.mockRejectedValueOnce(new Error("db flash"));
    const c3 = stubChain({ awaitResult: { data: null, error: null } }); // attempts+1

    const outcome = await markAiRequestFailed(21, "u-1", 50, "boom");
    expect(outcome).toEqual({ status: "refund_pending", refunded: false });
    const patch = c3.update.mock.calls[0][0];
    expect(patch.refund_attempts).toBe(1);
    expect(patch.error_message).toContain("refund failed");
  });

  it("占用 0 行（已被崩溃补偿处理）：不重复退款", async () => {
    stubChain({ maybeResult: { data: null, error: null } }); // 占用 0 行
    const outcome = await markAiRequestFailed(21, "u-1", 50, "boom");
    expect(outcome).toEqual({ status: "refunded", refunded: false });
    expect(mocks.increaseCredits).not.toHaveBeenCalled();
  });
});

describe("compensateStaleAiRequests", () => {
  it("running 滞留：占用→退款→refunded；查询条件为 running 且超 30 分钟", async () => {
    const c1 = stubChain({ awaitResult: { data: [makeRow({ updated_at: "2026-08-31T00:00:00Z" })], error: null } });
    stubChain({ maybeResult: { data: makeRow(), error: null } }); // 占用
    stubChain({ awaitResult: { data: null, error: null } }); // 收口
    stubChain({ awaitResult: { data: [], error: null } }); // pending 查询空

    const report = await compensateStaleAiRequests(20);

    expect(c1.eq).toHaveBeenCalledWith("status", "running");
    const [field, before] = c1.lt.mock.calls[0];
    expect(field).toBe("updated_at");
    expect(new Date(before).getTime()).toBeLessThanOrEqual(Date.now() - 30 * 60 * 1000);
    expect(report.compensated).toBe(1);
    expect(report.refunded).toBe(1);
    expect(mocks.increaseCredits).toHaveBeenCalledTimes(1);
  });

  it("refund_pending 重试：退款仍失败计 still_pending", async () => {
    stubChain({ awaitResult: { data: [], error: null } }); // running 查询空
    const cP = stubChain({ awaitResult: { data: [makeRow({ status: "refund_pending", refund_attempts: 1 })], error: null } });
    mocks.increaseCredits.mockRejectedValueOnce(new Error("still down"));
    stubChain({ awaitResult: { data: null, error: null } }); // attempts+1

    const report = await compensateStaleAiRequests(20);

    expect(cP.eq).toHaveBeenCalledWith("status", "refund_pending");
    expect(report.still_pending).toBe(1);
  });
});

describe("cleanupCompletedAiRequests", () => {
  it("只删 completed 超 TTL 的终态行，返回删除数", async () => {
    const c = stubChain({ awaitResult: { data: [{ id: 1 }, { id: 2 }], error: null } });
    const n = await cleanupCompletedAiRequests(24);
    expect(n).toBe(2);
    expect(c.in).toHaveBeenCalledWith("status", ["succeeded", "failed", "refunded"]);
    const [field, cutoff] = c.lt.mock.calls[0];
    expect(field).toBe("completed_at");
    expect(new Date(cutoff).getTime()).toBeLessThanOrEqual(Date.now() - 24 * 3600 * 1000);
  });
});
