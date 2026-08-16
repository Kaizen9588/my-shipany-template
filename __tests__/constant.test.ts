import { describe, expect, it } from "vitest";
import {
  AffiliateRewardAmount,
  AffiliateRewardPercent,
  AffiliateStatus,
  CacheKey,
} from "@/services/constant";

describe("services/constant", () => {
  it("缓存 key 常量", () => {
    expect(CacheKey.Theme).toBe("THEME");
    expect(CacheKey.InviteCode).toBe("INVITE_CODE");
  });

  it("联盟状态值", () => {
    expect(AffiliateStatus.Pending).toBe("pending");
    expect(AffiliateStatus.Completed).toBe("completed");
  });

  it("联盟奖励比例与封顶金额", () => {
    expect(AffiliateRewardPercent.Invited).toBe(0);
    expect(AffiliateRewardPercent.Paid).toBe(20);
    expect(AffiliateRewardAmount.Paid).toBe(5000);
  });
});
