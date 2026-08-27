import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models/payment", () => ({ getPaymentSettings: vi.fn() }));
vi.mock("@/lib/payment/health", () => ({
  isProviderHealthy: vi.fn(() => true),
}));

import { getPaymentSettings } from "@/models/payment";
import { isProviderHealthy } from "@/lib/payment/health";
import {
  getEnabledProviders,
  routePaymentProvider,
} from "@/lib/payment";

const mockSettings = getPaymentSettings as unknown as ReturnType<typeof vi.fn>;
const mockHealthy = isProviderHealthy as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_ENV = process.env;

describe("lib/payment 路由（6.1）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.STRIPE_PRIVATE_KEY = "sk_test";
    process.env.STRIPE_PUBLIC_KEY = "pk_test";
    process.env.CREEM_API_KEY = "creem_key";
    // Waffo Pancake：凭据收敛为 MERCHANT_ID + PRIVATE_KEY（旧 API_KEY/PUBLIC_KEY 已废弃）
    process.env.WAFFO_PRIVATE_KEY = "private";
    process.env.WAFFO_MERCHANT_ID = "merchant";
    mockHealthy.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("按 priority 排序返回启用渠道", async () => {
    mockSettings.mockResolvedValue({
      creem: { provider: "creem", enabled: true, priority: 10 },
      waffo: { provider: "waffo", enabled: true, priority: 20 },
      stripe: { provider: "stripe", enabled: true, priority: 30 },
    });

    const enabled = await getEnabledProviders();
    expect(enabled.map((p) => p.id)).toEqual(["creem", "waffo", "stripe"]);
  });

  it("禁用的渠道被过滤，未配置渠道默认启用", async () => {
    mockSettings.mockResolvedValue({
      creem: { provider: "creem", enabled: false, priority: 10 },
      waffo: { provider: "waffo", enabled: true, priority: 20 },
      stripe: { provider: "stripe", enabled: false, priority: 30 },
    });

    const enabled = await getEnabledProviders();
    expect(enabled.map((p) => p.id)).toEqual(["waffo"]);
  });

  it("unhealthy 渠道被跳过", async () => {
    mockSettings.mockResolvedValue({});
    mockHealthy.mockImplementation((id: string) => id !== "waffo");
    const enabled = await getEnabledProviders();
    expect(enabled.map((p) => p.id)).not.toContain("waffo");
  });

  it("routePaymentProvider 按 method 匹配", async () => {
    mockSettings.mockResolvedValue({});
    const p = await routePaymentProvider("alipay");
    expect(p).toBeDefined();
    expect(p!.supported_methods).toContain("alipay");
  });

  it("routePaymentProvider 不传 method 返回默认渠道", async () => {
    mockSettings.mockResolvedValue({});
    const p = await routePaymentProvider();
    expect(p).toBeDefined();
  });

  it("routePaymentProvider 无匹配渠道返回 undefined", async () => {
    mockSettings.mockResolvedValue({});
    const p = await routePaymentProvider("paypal");
    expect(p).toBeUndefined();
  });
});
