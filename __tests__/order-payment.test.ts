import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));

vi.mock("@/models/db", () => ({
  getSupabaseClient: mocks.client,
  serverClient: mocks.client,
  userClient: mocks.client,
}));

import { handleOrderSession } from "@/services/order";
import { getSupabaseClient } from "@/models/db";

const mockGetClient = getSupabaseClient as unknown as ReturnType<
  typeof vi.fn
>;

function buildPaidSession(overrides: Record<string, unknown> = {}) {
  return {
    metadata: {
      order_no: "order-1",
      ...(overrides.metadata || {}),
    },
    payment_status: "paid",
    customer_details: { email: "buyer@example.com" },
    customer_email: "",
    amount_total: 9900,
    currency: "usd",
    ...overrides,
  } as any;
}

describe("services/order handleOrderSession（P-1.3 事务化 RPC 契约）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("支付成功调用 handle_order_payment 存储过程", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "created", error: null });
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    const session = buildPaidSession();
    await handleOrderSession(session);

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, params] = rpc.mock.calls[0];
    expect(fnName).toBe("handle_order_payment");
    expect(params.p_order_no).toBe("order-1");
    expect(params.p_paid_email).toBe("buyer@example.com");
    expect(params.p_paid_at).toBeTruthy();
    expect(params.p_paid_detail).toContain("order-1");
    // R1：渠道实付金额/币种必须传入存储过程比对
    expect(params.p_amount_cents).toBe(9900);
    expect(params.p_currency).toBe("usd");
  });

  it("金额比对返回 mismatch：不抛错（避免渠道无限重试）、跳过支付成功邮件", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "mismatch", error: null });
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    const session = buildPaidSession();
    const result = await handleOrderSession(session);
    expect(result).toBe("mismatch");
  });

  it("非 paid 状态的 session 直接拒绝，不调用存储过程", async () => {
    const rpc = vi.fn();
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    const session = buildPaidSession({ payment_status: "unpaid" });
    await expect(handleOrderSession(session)).rejects.toThrow("invalid session");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("缺 metadata.order_no 的 session 拒绝", async () => {
    const rpc = vi.fn();
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    const session = buildPaidSession({ metadata: undefined });
    await expect(handleOrderSession(session)).rejects.toThrow("invalid session");
    expect(rpc).not.toHaveBeenCalled();
  });
});
