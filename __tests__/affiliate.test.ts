import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models/affiliate", () => ({
  findAffiliateByOrderNo: vi.fn(),
  insertAffiliate: vi.fn(),
}));
vi.mock("@/models/user", () => ({ findUserByUuid: vi.fn() }));
vi.mock("@/lib/time", () => ({ getIsoTimestr: vi.fn(() => "2026-01-01T00:00:00.000Z") }));

import { updateAffiliateForOrder } from "@/services/affiliate";
import { findAffiliateByOrderNo, insertAffiliate } from "@/models/affiliate";
import { findUserByUuid } from "@/models/user";

const mockFindAff = findAffiliateByOrderNo as unknown as ReturnType<typeof vi.fn>;
const mockInsertAff = insertAffiliate as unknown as ReturnType<typeof vi.fn>;
const mockFindUser = findUserByUuid as unknown as ReturnType<typeof vi.fn>;

describe("services/affiliate updateAffiliateForOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("无邀请人时不记录", async () => {
    mockFindUser.mockResolvedValueOnce({ uuid: "u1", invited_by: null });
    await updateAffiliateForOrder({ user_uuid: "u1", amount: 9900 } as any);
    expect(mockInsertAff).not.toHaveBeenCalled();
  });

  it("已存在联盟记录时跳过", async () => {
    mockFindUser.mockResolvedValueOnce({
      uuid: "u1",
      invited_by: "inviter",
    });
    mockFindAff.mockResolvedValueOnce({ paid_order_no: "o1" });
    await updateAffiliateForOrder({ user_uuid: "u1", order_no: "o1" } as any);
    expect(mockInsertAff).not.toHaveBeenCalled();
  });

  it("奖励按比例计算并封顶", async () => {
    mockFindUser.mockResolvedValue({
      uuid: "u1",
      invited_by: "inviter",
    });
    mockFindAff.mockResolvedValue(undefined);
    mockInsertAff.mockResolvedValue([]);

    // $29900 → 20% = 5980，超上限 5000 → 封顶
    await updateAffiliateForOrder({ user_uuid: "u1", amount: 29900 } as any);
    expect(mockInsertAff).toHaveBeenCalledTimes(1);
    const aff = mockInsertAff.mock.calls[0][0];
    expect(aff.reward_amount).toBe(5000);
    expect(aff.reward_percent).toBe(20);

    // $9900 → 1980
    await updateAffiliateForOrder({ user_uuid: "u1", amount: 9900 } as any);
    const aff2 = mockInsertAff.mock.calls[1][0];
    expect(aff2.reward_amount).toBe(1980);
  });
});
