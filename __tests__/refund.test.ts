import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models/db", () => ({ getSupabaseClient: vi.fn() }));
vi.mock("@/lib/time", () => ({ getIsoTimestr: vi.fn(() => "2026-01-01T00:00:00.000Z") }));
vi.mock("@/lib/audit", () => ({ fireAndForgetAudit: vi.fn() }));

import { processRefund } from "@/services/refund";
import { getSupabaseClient } from "@/models/db";
import { fireAndForgetAudit } from "@/lib/audit";

const mockGetClient = getSupabaseClient as unknown as ReturnType<typeof vi.fn>;
const mockAudit = fireAndForgetAudit as unknown as ReturnType<typeof vi.fn>;

function mockRpc(
  data: unknown,
  error: unknown = null
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({ data, error });
}

describe("services/refund processRefund（R3 原子化 RPC 契约）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("调用 process_order_refund 存储过程并返回扣减积分", async () => {
    const rpc = mockRpc(80);
    mockGetClient.mockReturnValue({ rpc });

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
    mockGetClient.mockReturnValue({ rpc });

    await expect(processRefund({ order_no: "o1" })).rejects.toThrow(
      "order is not paid"
    );
  });

  it("已 refunded 的订单幂等返回 0（并发双调用方重试安全）", async () => {
    const rpc = mockRpc(0);
    mockGetClient.mockReturnValue({ rpc });

    const result = await processRefund({ order_no: "o1" });
    expect(result.deducted_credits).toBe(0);
  });

  it("带退款金额时写入 refund_note", async () => {
    const rpc = mockRpc(10);
    mockGetClient.mockReturnValue({ rpc });

    await processRefund({ order_no: "o1", amount: 500 });
    const [, params] = rpc.mock.calls[0];
    expect(params.p_refund_note).toContain("amount=500");
  });

  it("管理员操作时记录审计", async () => {
    const rpc = mockRpc(10);
    mockGetClient.mockReturnValue({ rpc });

    await processRefund({ order_no: "o1", admin_uuid: "admin-1" });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        admin_uuid: "admin-1",
        action: "admin.order.refund",
        target_uuid: "o1",
      })
    );
  });
});
