import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getPaymentProducts: vi.fn(),
  updatePaymentProduct: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/audit", () => ({ fireAndForgetAudit: vi.fn() }));
vi.mock("@/models/payment", () => ({
  getPaymentProducts: mocks.getPaymentProducts,
  updatePaymentProduct: mocks.updatePaymentProduct,
}));

import { PUT } from "@/app/api/admin/payment-products/route";

function putReq(products: unknown[]) {
  return new Request("http://localhost/api/admin/payment-products", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      products,
      reason: "季度调价，运营复核通过",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ uuid: "admin-1" });
  mocks.updatePaymentProduct.mockResolvedValue(undefined);
});

describe("P1-定价-1：admin payment-products 写入不变量校验（真相源=payment_products）", () => {
  it("正常价格（amount/credits 均合法）放行并写库", async () => {
    const res = await PUT(
      putReq([{ product_id: "starter", amount: 9900, credits: 100, valid_months: 1 }])
    );
    expect((await res.json()).code).toBe(0);
    expect(mocks.updatePaymentProduct).toHaveBeenCalledWith("starter", {
      amount: 9900,
      credits: 100,
      valid_months: 1,
    });
  });

  it("金额超上限被拒绝", async () => {
    const res = await PUT(putReq([{ product_id: "p", amount: 9999999, credits: 1 }]));
    expect((await res.json()).message).toMatch(/amount must not exceed/);
    expect(mocks.updatePaymentProduct).not.toHaveBeenCalled();
  });

  it("积分≤金额：拒绝赠送定价（1 分卖 10000 积分）", async () => {
    const res = await PUT(putReq([{ product_id: "p", amount: 1, credits: 10000 }]));
    expect((await res.json()).message).toMatch(/giveaway pricing/);
    expect(mocks.updatePaymentProduct).not.toHaveBeenCalled();
  });

  it("非 USD 币种被拒绝（v1 单一货币）", async () => {
    const res = await PUT(
      putReq([{ product_id: "p", amount: 9900, credits: 100, currency: "EUR" }])
    );
    expect((await res.json()).message).toMatch(/only supports USD/);
    expect(mocks.updatePaymentProduct).not.toHaveBeenCalled();
  });

  it("未通过 requireAdmin('admin') 时返回 403 且不写库", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("no admin access"));
    const res = await PUT(putReq([{ product_id: "p", amount: 9900, credits: 100 }]));
    expect(res.status).toBe(403);
    expect(mocks.updatePaymentProduct).not.toHaveBeenCalled();
  });

  it("缺 reason 时拒绝写库（N-6 高风险操作强制理由）", async () => {
    const res = await PUT(
      new Request("http://localhost/api/admin/payment-products", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ products: [{ product_id: "p", amount: 9900 }] }),
      })
    );
    expect((await res.json()).message).toMatch(/reason required/);
    expect(mocks.updatePaymentProduct).not.toHaveBeenCalled();
  });
});