import { describe, expect, it } from "vitest";
import {
  PRICING_PRODUCTS,
  getPricingProduct,
} from "@/data/pricing";

describe("data/pricing（P-1.1 服务端定价单一真相源）", () => {
  it("所有产品金额/积分/有效期合法", () => {
    expect(PRICING_PRODUCTS.length).toBeGreaterThan(0);

    for (const p of PRICING_PRODUCTS) {
      expect(p.amount).toBeGreaterThan(0);
      expect(p.credits).toBeGreaterThan(0);
      expect(p.valid_months).toBeGreaterThan(0);
      expect(p.currency).toBe("USD");
      expect(p.interval).toBe("one-time"); // v1 只做一次性积分包
      expect(p.product_id).toBeTruthy();
      expect(p.product_name).toBeTruthy();
    }
  });

  it("product_id 唯一", () => {
    const ids = PRICING_PRODUCTS.map((p) => p.product_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getPricingProduct 命中已知产品", () => {
    const starter = getPricingProduct("starter");
    expect(starter).toBeDefined();
    expect(starter!.amount).toBe(9900);
    expect(starter!.credits).toBe(100);
  });

  it("getPricingProduct 对未知产品返回 undefined（Checkout 拒绝）", () => {
    expect(getPricingProduct("hacker-0-cost")).toBeUndefined();
    expect(getPricingProduct("")).toBeUndefined();
  });

  it("金额与积分匹配（防止改价改量不一致）", () => {
    const byId = Object.fromEntries(
      PRICING_PRODUCTS.map((p) => [p.product_id, p])
    );
    expect(byId.starter.amount).toBe(9900);
    expect(byId.standard.amount).toBe(19900);
    expect(byId.premium.amount).toBe(29900);
  });
});
