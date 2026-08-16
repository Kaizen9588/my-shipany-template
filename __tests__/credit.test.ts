import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models/db", () => ({
  getSupabaseClient: vi.fn(),
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
