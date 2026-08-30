import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));

vi.mock("@/models/db", () => ({
  getSupabaseClient: mocks.client,
  serverClient: mocks.client,
  userClient: mocks.client,
}));

import {
  CreditsAmount,
  CreditsTransType,
  InsufficientCreditsError,
  decreaseCredits,
} from "@/services/credit";
import { getSupabaseClient } from "@/models/db";

const mockGetClient = getSupabaseClient as unknown as ReturnType<
  typeof vi.fn
>;

describe("services/credit decreaseCredits（P-1.2 原子扣减 RPC 契约）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("调用 decrease_credits 存储过程并传入正确参数", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    mockGetClient.mockReturnValue({ rpc });

    const transNo = await decreaseCredits({
      user_uuid: "user-1",
      trans_type: CreditsTransType.Ping,
      credits: CreditsAmount.PingCost,
    });

    expect(transNo).toBeTruthy();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("decrease_credits", {
      p_user_uuid: "user-1",
      p_trans_type: "ping",
      p_credits: 1,
      p_trans_no: transNo,
    });
  });

  it("余额不足时抛出 InsufficientCreditsError 并携带余额", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "insufficient credits: 3" } });
    mockGetClient.mockReturnValue({ rpc });

    await expect(
      decreaseCredits({
        user_uuid: "user-1",
        trans_type: CreditsTransType.Ping,
        credits: 10,
      })
    ).rejects.toBeInstanceOf(InsufficientCreditsError);

    try {
      await decreaseCredits({
        user_uuid: "user-1",
        trans_type: CreditsTransType.Ping,
        credits: 10,
      });
    } catch (e) {
      expect((e as InsufficientCreditsError).balance).toBe(3);
    }
  });

  it("其他 RPC 错误原样抛出", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("db down") });
    mockGetClient.mockReturnValue({ rpc });

    await expect(
      decreaseCredits({
        user_uuid: "user-1",
        trans_type: CreditsTransType.Ping,
        credits: 1,
      })
    ).rejects.toThrow("db down");
  });
});

// ---------- H1 对抗性测试回归：admin 手动加积分 ----------
describe("services/credit adjustCreditsByAdmin（H1 回归）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("正数加积分 expired_at 必须为 NULL（此前传 \"\" 导致 timestamptz 解析失败）", async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: null });
    mockGetClient.mockReturnValue({ from: vi.fn().mockReturnValue({ insert }) });

    const { adjustCreditsByAdmin } = await import("@/services/credit");
    await adjustCreditsByAdmin({
      user_uuid: "user-1",
      credits: 100,
      remark: "test grant",
    });

    expect(insert).toHaveBeenCalledTimes(1);
    const payload = insert.mock.calls[0][0];
    expect(payload.credits).toBe(100);
    expect(payload.expired_at).toBeNull();
    expect(payload.expired_at).not.toBe("");
  });

  it("负数扣减 expired_at 为 NULL（永久消费语义不变）", async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: null });
    mockGetClient.mockReturnValue({ from: vi.fn().mockReturnValue({ insert }) });

    const { adjustCreditsByAdmin } = await import("@/services/credit");
    await adjustCreditsByAdmin({ user_uuid: "user-1", credits: -50 });

    const payload = insert.mock.calls[0][0];
    expect(payload.credits).toBe(-50);
    expect(payload.expired_at).toBeNull();
  });
});
