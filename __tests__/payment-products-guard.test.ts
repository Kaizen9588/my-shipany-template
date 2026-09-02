import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getPaymentProducts: vi.fn(),
  updatePaymentProduct: vi.fn(),
  submitApproval: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/audit", () => ({ fireAndForgetAudit: vi.fn() }));
vi.mock("@/models/payment", () => ({
  getPaymentProducts: mocks.getPaymentProducts,
  updatePaymentProduct: mocks.updatePaymentProduct,
}));
vi.mock("@/lib/admin-approval", () => ({
  submitApproval: mocks.submitApproval,
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
  mocks.requireAdmin.mockResolvedValue({ uuid: "admin-1", email: "a@example.com" });
  mocks.updatePaymentProduct.mockResolvedValue(undefined);
  // N-6：定价写入落审批单（双人复核），路由不再直写
  mocks.submitApproval.mockResolvedValue({
    approval: { id: 77, status: "pending" },
    single_admin: false,
  });
});

describe("P1-定价-1：admin payment-products 写入不变量校验（真相源=payment_products）", () => {
  it("正常价格（amount/credits 均合法）→ 落审批单（含 payload 快照）", async () => {
    const res = await PUT(
      putReq([{ product_id: "starter", amount: 9900, credits: 100, valid_months: 1 }])
    );
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.approval_required).toBe(true);
    expect(body.data.approval_id).toBe(77);
    expect(mocks.submitApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "payment_settings",
        target_uuid: "",
        payload: { products: [{ product_id: "starter", amount: 9900, credits: 100, valid_months: 1 }] },
      })
    );
    expect(mocks.updatePaymentProduct).not.toHaveBeenCalled();
  });

  it("金额超上限被拒绝", async () => {
    const res = await PUT(putReq([{ product_id: "p", amount: 9999999, credits: 1 }]));
    expect((await res.json()).message).toMatch(/amount must not exceed/);
    expect(mocks.submitApproval).not.toHaveBeenCalled();
  });

  it("积分≤金额：拒绝赠送定价（1 分卖 10000 积分）", async () => {
    const res = await PUT(putReq([{ product_id: "p", amount: 1, credits: 10000 }]));
    expect((await res.json()).message).toMatch(/giveaway pricing/);
    expect(mocks.submitApproval).not.toHaveBeenCalled();
  });

  it("非 USD 币种被拒绝（v1 单一货币）", async () => {
    const res = await PUT(
      putReq([{ product_id: "p", amount: 9900, credits: 100, currency: "EUR" }])
    );
    expect((await res.json()).message).toMatch(/only supports USD/);
    expect(mocks.submitApproval).not.toHaveBeenCalled();
  });

  it("未通过 requireAdmin('admin') 时返回 403 且不提交审批", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("no admin access"));
    const res = await PUT(putReq([{ product_id: "p", amount: 9900, credits: 100 }]));
    expect(res.status).toBe(403);
    expect(mocks.submitApproval).not.toHaveBeenCalled();
  });

  it("缺 reason 时拒绝提交审批（N-6 高风险操作强制理由）", async () => {
    const res = await PUT(
      new Request("http://localhost/api/admin/payment-products", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ products: [{ product_id: "p", amount: 9900 }] }),
      })
    );
    expect((await res.json()).message).toMatch(/reason required/);
    expect(mocks.submitApproval).not.toHaveBeenCalled();
  });
});