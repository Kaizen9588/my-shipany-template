import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models/db", () => ({ getSupabaseClient: vi.fn() }));

import { getSupabaseClient } from "@/models/db";
import { getCheckoutProduct } from "@/models/payment";

const mockGetClient = getSupabaseClient as unknown as ReturnType<typeof vi.fn>;

function mockSelect(rows: any[]) {
  // getPaymentProducts 只用到 from().select("*")，返回 thenable 结果
  mockGetClient.mockReturnValue({
    from: () => ({
      select: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("models/payment getCheckoutProduct（后台定价热编辑 + 服务端真相源）", () => {
  it("DB 有定价行时以 DB 为准（后台 /admin/pricing 改价生效）", async () => {
    mockSelect([
      {
        product_id: "starter",
        amount: 1,
        currency: "USD",
        credits: 999,
        valid_months: 2,
        creem_product_id: null,
        stripe_price_id: null,
      },
    ]);

    const product = await getCheckoutProduct("starter");
    expect(product).toBeDefined();
    expect(product!.amount).toBe(1);
    expect(product!.credits).toBe(999);
    expect(product!.valid_months).toBe(2);
    expect(product!.interval).toBe("one-time");
    // 文案仍来自常量
    expect(product!.product_name).toBeTruthy();
  });

  it("DB 无该产品时回退 data/pricing.ts 常量", async () => {
    mockSelect([]);

    const product = await getCheckoutProduct("starter");
    expect(product).toBeDefined();
    expect(product!.amount).toBe(9900);
    expect(product!.credits).toBe(100);
  });

  it("未知 product_id 返回 undefined（Checkout 拒绝）", async () => {
    mockSelect([]);

    expect(await getCheckoutProduct("hacker-0-cost")).toBeUndefined();
  });

  it("DB 异常时回退常量，不抛错（不阻塞 checkout）", async () => {
    mockGetClient.mockReturnValue({
      from: () => {
        throw new Error("db down");
      },
    });

    const product = await getCheckoutProduct("starter");
    expect(product).toBeDefined();
    expect(product!.amount).toBe(9900);
  });
});
