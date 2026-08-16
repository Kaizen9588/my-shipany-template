import { beforeEach, describe, expect, it, vi } from "vitest";

// mock 依赖，避免连真实 Supabase
vi.mock("@/models/db", () => ({ getSupabaseClient: vi.fn() }));
vi.mock("@/models/credit", () => ({
  findCreditByOrderNo: vi.fn(),
  getUserValidCredits: vi.fn(),
  insertCredit: vi.fn(),
}));
vi.mock("@/models/order", () => ({
  getFirstPaidOrderByUserUuid: vi.fn(),
}));
vi.mock("@/lib/time", () => ({
  getIsoTimestr: vi.fn(() => "2026-01-01T00:00:00.000Z"),
}));
vi.mock("@/lib/hash", () => ({
  getSnowId: vi.fn(() => "snow-1"),
}));
vi.mock("@/lib/email", () => ({
  fireAndForgetEmail: vi.fn(),
  shouldSendToday: vi.fn(() => true),
}));
vi.mock("@/models/notification", () => ({
  createNotification: vi.fn(),
}));
vi.mock("@/lib/telemetry/server", () => ({
  trackServer: vi.fn(),
  TelemetryEvents: { CreditsExhausted: "credits.exhausted" },
}));

import {
  CreditsAmount,
  CreditsTransType,
  adjustCreditsByAdmin,
  increaseCredits,
  updateCreditForOrder,
} from "@/services/credit";
import { findCreditByOrderNo, insertCredit } from "@/models/credit";

const mockInsertCredit = insertCredit as unknown as ReturnType<typeof vi.fn>;
const mockFindByOrderNo = findCreditByOrderNo as unknown as ReturnType<
  typeof vi.fn
>;

describe("services/credit 补充", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increaseCredits 插入积分记录", async () => {
    mockInsertCredit.mockResolvedValueOnce([]);
    await increaseCredits({
      user_uuid: "u1",
      trans_type: CreditsTransType.NewUser,
      credits: CreditsAmount.NewUserGet,
      expired_at: "2027-01-01T00:00:00.000Z",
    });

    expect(mockInsertCredit).toHaveBeenCalledTimes(1);
    const credit = mockInsertCredit.mock.calls[0][0];
    expect(credit.user_uuid).toBe("u1");
    expect(credit.trans_type).toBe("new_user");
    expect(credit.credits).toBe(10);
    expect(credit.trans_no).toBeTruthy();
  });

  it("increaseCredits 失败时抛出", async () => {
    mockInsertCredit.mockRejectedValueOnce(new Error("db down"));
    await expect(
      increaseCredits({
        user_uuid: "u1",
        trans_type: "new_user",
        credits: 10,
      })
    ).rejects.toThrow("db down");
  });

  it("updateCreditForOrder 已存在记录时跳过", async () => {
    mockFindByOrderNo.mockResolvedValueOnce({ trans_no: "x" });
    await updateCreditForOrder({ order_no: "o1" } as any);
    expect(mockInsertCredit).not.toHaveBeenCalled();
  });

  it("updateCreditForOrder 无记录时插入", async () => {
    mockFindByOrderNo.mockResolvedValueOnce(undefined);
    mockInsertCredit.mockResolvedValueOnce([]);
    await updateCreditForOrder({
      order_no: "o1",
      user_uuid: "u1",
      credits: 100,
      expired_at: "2027-01-01T00:00:00.000Z",
    } as any);

    expect(mockInsertCredit).toHaveBeenCalledTimes(1);
    const credit = mockInsertCredit.mock.calls[0][0];
    expect(credit.order_no).toBe("o1");
    expect(credit.trans_type).toBe("order_pay");
    expect(credit.credits).toBe(100);
  });

  it("adjustCreditsByAdmin credits=0 拒绝", async () => {
    await expect(
      adjustCreditsByAdmin({ user_uuid: "u1", credits: 0 })
    ).rejects.toThrow("invalid credits amount");
  });

  it("adjustCreditsByAdmin 负数记录 expired_at 为 null", async () => {
    mockInsertCredit.mockResolvedValueOnce([]);
    await adjustCreditsByAdmin({
      user_uuid: "u1",
      credits: -5,
      remark: "billback",
    });
    const credit = mockInsertCredit.mock.calls[0][0];
    expect(credit.credits).toBe(-5);
    expect(credit.expired_at).toBeNull();
    expect(credit.order_no).toBe("billback");
  });

  it("adjustCreditsByAdmin 正数记录有有效期字段", async () => {
    mockInsertCredit.mockResolvedValueOnce([]);
    await adjustCreditsByAdmin({ user_uuid: "u1", credits: 5 });
    const credit = mockInsertCredit.mock.calls[0][0];
    expect(credit.credits).toBe(5);
    expect(credit.trans_type).toBe("system_add");
  });
});
