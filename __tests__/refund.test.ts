import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));

vi.mock("@/models/db", () => ({
  getSupabaseClient: mocks.client,
  serverClient: mocks.client,
  userClient: mocks.client,
}));
vi.mock("@/lib/time", () => ({ getIsoTimestr: vi.fn(() => "2026-01-01T00:00:00.000Z") }));
vi.mock("@/lib/audit", () => ({ fireAndForgetAudit: vi.fn() }));
vi.mock("@/lib/oplog", () => ({ trackCriticalEvent: vi.fn() }));
vi.mock("@/models/order", () => ({ findOrderByOrderNo: vi.fn() }));

import { processRefund, registerRefundRequest } from "@/services/refund";
import { getSupabaseClient } from "@/models/db";
import { findOrderByOrderNo } from "@/models/order";
import { fireAndForgetAudit } from "@/lib/audit";
import { trackCriticalEvent } from "@/lib/oplog";

const mockGetClient = getSupabaseClient as unknown as ReturnType<typeof vi.fn>;
const mockAudit = fireAndForgetAudit as unknown as ReturnType<typeof vi.fn>;
const mockFindOrder = findOrderByOrderNo as unknown as ReturnType<typeof vi.fn>;
const mockTrack = trackCriticalEvent as unknown as ReturnType<typeof vi.fn>;

function mockRpc(
  data: unknown,
  error: unknown = null
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({ data, error });
}

describe("services/refund processRefund（R3 原子化 RPC 契约）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认订单查询返回 undefined，债务化分支短路，保持既有 RPC 契约断言纯净
    mockFindOrder.mockResolvedValue(undefined);
  });

  it("调用 process_order_refund 存储过程并返回扣减积分", async () => {
    const rpc = mockRpc(80);
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    const result = await processRefund({ order_no: "o1" });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, params] = rpc.mock.calls[0];
    expect(fnName).toBe("process_order_refund");
    expect(params.p_order_no).toBe("o1");
    expect(params.p_refund_note).toContain("refunded at");
    expect(result.deducted_credits).toBe(80);
  });

  it("存储过程报错时向上抛出（RPC 错误不吞）", async () => {
    const rpc = mockRpc(
      null,
      new Error('order is not paid: created')
    );
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    await expect(processRefund({ order_no: "o1" })).rejects.toThrow(
      "order is not paid"
    );
  });

  it("已 refunded 的订单幂等返回 0（并发双调用方重试安全）", async () => {
    const rpc = mockRpc(0);
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    const result = await processRefund({ order_no: "o1" });
    expect(result.deducted_credits).toBe(0);
  });

  it("带退款金额时写入 refund_note", async () => {
    const rpc = mockRpc(10);
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    await processRefund({ order_no: "o1", amount: 500 });
    const [, params] = rpc.mock.calls[0];
    expect(params.p_refund_note).toContain("amount=500");
  });

  it("管理员操作时不直接写审计（审计由 admin 路由层落一条带 reason 的记录）", async () => {
    const rpc = mockRpc(10);
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    await processRefund({
      order_no: "o1",
      admin_uuid: "admin-1",
      reason: "用户申请退款",
    });

    // 服务层不再写 admin.order.refund：避免同一操作出现两条审计、其中一条缺 reason
    expect(mockAudit).not.toHaveBeenCalled();
    // 资金埋点仍要带上 reason，供告警侧核对操作依据
    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "payment.refund_processed",
        detail: expect.objectContaining({
          admin_uuid: "admin-1",
          reason: "用户申请退款",
        }),
      })
    );
  });

  it("扣回量 < 订单发放积分时触发债务化（P0-1，防白嫖）", async () => {
    // 订单发放 300 积分，RPC 只扣回 0（已消费），应调用 debt_regulate_order_refund
    mockFindOrder.mockResolvedValue({
      order_no: "o1",
      user_uuid: "u1",
      credits: 300,
      status: "paid",
    });
    const rpc = mockRpc(0);
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    await processRefund({ order_no: "o1", amount: 1000 });

    const calls = rpc.mock.calls;
    expect(calls[0][0]).toBe("process_order_refund");
    // 债务化 RPC 被调用，且携带正确的差额参数
    const debtCall = calls.find((c) => c[0] === "debt_regulate_order_refund");
    expect(debtCall).toBeTruthy();
    expect(debtCall![1]).toEqual(
      expect.objectContaining({
        p_order_no: "o1",
        p_user_uuid: "u1",
        p_order_credits: 300,
        p_refunded_credits: 0,
      })
    );
  });

  it("全额扣回（无已消费缺口）时不触发债务化", async () => {
    mockFindOrder.mockResolvedValue({
      order_no: "o1",
      user_uuid: "u1",
      credits: 300,
      status: "paid",
    });
    const rpc = mockRpc(300);
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    await processRefund({ order_no: "o1" });

    const debtCall = rpc.mock.calls.find(
      (c) => c[0] === "debt_regulate_order_refund"
    );
    expect(debtCall).toBeUndefined();
  });
});

describe("services/refund registerRefundRequest（P0-1 webhook 登记中间态）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("调用 register_order_refund_request 存储过程并返回退款单号", async () => {
    const rpc = mockRpc("ref-abc");
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    const result = await registerRefundRequest({
      order_no: "o1",
      user_uuid: "u1",
      provider: "stripe",
      provider_refund_id: "re_123",
      amount: 9900,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, params] = rpc.mock.calls[0];
    expect(fnName).toBe("register_order_refund_request");
    expect(params).toEqual(
      expect.objectContaining({
        p_order_no: "o1",
        p_user_uuid: "u1",
        p_provider: "stripe",
        p_provider_refund_id: "re_123",
        p_amount_cents: 9900,
        p_initiated_by: "customer",
      })
    );
    expect(result.refund_no).toBe("ref-abc");
  });

  it("登记即告警（warn）：终态需人工/回收流程闭合", async () => {
    const rpc = mockRpc("ref-abc");
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    await registerRefundRequest({
      order_no: "o1",
      user_uuid: "u1",
      provider: "creem",
    });

    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "payment.refund_requested",
        severity: "warn",
        subject_uuid: "o1",
      })
    );
  });

  it("存储过程报错时向上抛出（登记失败 webhook 返回 5xx，渠道会重试）", async () => {
    const rpc = mockRpc(null, new Error("order not found: o1"));
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

    await expect(
      registerRefundRequest({ order_no: "o1", user_uuid: "u1", provider: "creem" })
    ).rejects.toThrow("order not found");
  });
});
