import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N-6 审批队列（迁移 0030）服务层单测：
 * - 双人复核核心不变量：requester === approver 拒绝
 * - 单管理员部署自动降级 approved 留痕
 * - 批准即执行（executed）/ 执行失败置 failed 可重试
 * - 取消仅限发起人本人、仅 pending
 */

const mocks = vi.hoisted(() => {
  const chain = () => {
    const c: any = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      // await 链末端：update()/select() 直接收尾时读取 __awaitResult
      then: undefined,
    };
    c.then = (_res: any, _rej: any) =>
      Promise.resolve(c.__awaitResult).then(_res, _rej);
    c.__awaitResult = { data: null, error: null };
    return c;
  };
  return {
    schemaFrom: vi.fn(),
    clientFrom: vi.fn(),
    chain,
    hasAdminLevel: vi.fn(),
    processRefund: vi.fn(),
    adjustCreditsByAdmin: vi.fn(),
    updateUserByAdmin: vi.fn(),
    findUserByUuid: vi.fn(),
    findOrderByOrderNo: vi.fn(),
    getPaymentProvider: vi.fn(),
    updatePaymentProduct: vi.fn(),
    updatePaymentSettingDetail: vi.fn(),
    validatePricingFields: vi.fn(),
    trackCriticalEvent: vi.fn(),
  };
});

vi.mock("@/models/db", () => ({
  serverClient: () => ({
    schema: (...args: unknown[]) => {
      const c = mocks.chain();
      // 同一条链同时服务 schema("private").from("admin_approvals") 与 from("users")
      mocks.schemaFrom(...args);
      c.from = mocks.clientFrom;
      return c;
    },
    from: mocks.clientFrom,
  }),
}));

vi.mock("@/lib/auth", () => ({ hasAdminLevel: mocks.hasAdminLevel }));

vi.mock("@/lib/oplog", () => ({ trackCriticalEvent: mocks.trackCriticalEvent }));
vi.mock("@/services/refund", () => ({ processRefund: mocks.processRefund }));
vi.mock("@/services/credit", () => ({ adjustCreditsByAdmin: mocks.adjustCreditsByAdmin }));
vi.mock("@/models/user", () => ({
  findUserByUuid: mocks.findUserByUuid,
  updateUserByAdmin: mocks.updateUserByAdmin,
}));
vi.mock("@/models/order", () => ({ findOrderByOrderNo: mocks.findOrderByOrderNo }));
vi.mock("@/lib/payment", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/models/payment", () => ({
  updatePaymentProduct: mocks.updatePaymentProduct,
  updatePaymentSettingDetail: mocks.updatePaymentSettingDetail,
}));
vi.mock("@/lib/pricing-guard", () => ({
  validatePricingFields: mocks.validatePricingFields,
}));

import {
  cancelApproval,
  decideApproval,
  submitApproval,
  _internal,
} from "@/lib/admin-approval";

function makeRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    action: "adjust_credits",
    required_level: "admin",
    target_type: "user",
    target_uuid: "user-1",
    payload: { user_uuid: "user-1", credits: 100 },
    reason: "客诉补偿 工单#1",
    status: "pending",
    requester_uuid: "admin-a",
    requester_email: "a@example.com",
    approver_uuid: "",
    approver_email: "",
    approve_reason: "",
    exec_error: "",
    created_at: "2026-09-01T00:00:00Z",
    decided_at: null,
    executed_at: null,
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  } as any;
}

/**
 * 单据读写桩：
 * - maybeSingle 依次返回 maybeRows（getApprovalById 每次读一行）
 * - 其余 await 链收尾（update/select/limit 终端）返回 __awaitResult（可改写）
 */
function stubTable(row: any, opts: { maybeRows?: any[]; awaitResult?: any } = {}) {
  const c = mocks.chain();
  const maybeRows = opts.maybeRows && opts.maybeRows.length ? [...opts.maybeRows] : [row];
  c.maybeSingle = vi.fn().mockImplementation(async () => ({
    data: maybeRows.length > 1 ? maybeRows.shift() : maybeRows[0],
    error: null,
  }));
  if (opts.awaitResult) {
    c.__awaitResult = opts.awaitResult;
  }
  c.limit.mockReturnValue(c);
  mocks.schemaFrom.mockReturnValue(c);
  mocks.clientFrom.mockReturnValue(c);
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasAdminLevel.mockReturnValue(true);
  mocks.findUserByUuid.mockResolvedValue({ uuid: "user-1", role: "user" });
  mocks.adjustCreditsByAdmin.mockResolvedValue(undefined);
  mocks.trackCriticalEvent.mockReturnValue(undefined);
});

describe("N-6 审批队列：提交（lib/admin-approval submitApproval）", () => {
  it("存在其他活跃管理员 → 单据 pending，等待复核", async () => {
    // from("users").select().in().eq().neq().limit(1) 走 then 收尾 -> data 非空 = 有其他管理员
    const c = stubTable(makeRow(), { awaitResult: { data: [{ uuid: "other" }], error: null } });

    const { approval, single_admin } = await submitApproval({
      action: "adjust_credits",
      requester: { uuid: "admin-a", email: "a@example.com" },
      reason: "客诉补偿 工单#1",
      target_uuid: "user-1",
      payload: { user_uuid: "user-1", credits: 100 },
    });

    expect(single_admin).toBe(false);
    expect(approval.status).toBe("pending");
    // insert 的行不得预置批准人
    const inserted = c.insert.mock.calls[0][0];
    expect(inserted.status).toBe("pending");
    expect(inserted.approver_uuid).toBe("");
  });

  it("单管理员部署（无其他活跃管理员）→ 自动降级 approved 留痕", async () => {
    // users 计数查询返回空 -> 单管理员
    const c = stubTable(makeRow({ status: "approved" }), { awaitResult: { data: [], error: null } });

    const { approval, single_admin } = await submitApproval({
      action: "refund",
      requester: { uuid: "admin-a", email: "a@example.com" },
      reason: "客诉退款 工单#2",
      target_uuid: "order-1",
      payload: { order_no: "order-1" },
    });

    expect(single_admin).toBe(true);
    expect(approval.status).toBe("approved");
    const inserted = c.insert.mock.calls[0][0];
    expect(inserted.status).toBe("approved");
    expect(inserted.approve_reason).toContain("single-admin");
  });
});

describe("N-6 审批队列：复核（decideApproval）", () => {
  it("发起人不得复核自己的单据（双人复核核心不变量）", async () => {
    stubTable(makeRow({ requester_uuid: "admin-a" }));
    await expect(
      decideApproval({
        id: 1,
        approver: { uuid: "admin-a", email: "a@example.com", role: "admin" },
        decision: "approve",
      })
    ).rejects.toThrow("requester cannot review own approval");
  });

  it("批准人级别不足 → 拒绝", async () => {
    stubTable(makeRow({ required_level: "super_admin" }));
    mocks.hasAdminLevel.mockReturnValue(false);
    await expect(
      decideApproval({
        id: 1,
        approver: { uuid: "admin-b", email: "b@example.com", role: "admin" },
        decision: "approve",
      })
    ).rejects.toThrow("insufficient level");
  });

  it("非 pending/failed 单据不可复核", async () => {
    stubTable(makeRow({ status: "executed" }));
    await expect(
      decideApproval({
        id: 1,
        approver: { uuid: "admin-b", email: "b@example.com", role: "admin" },
        decision: "approve",
      })
    ).rejects.toThrow("not decidable");
  });

  it("批准即执行：pending → executing → adjust_credits 落账 → executed", async () => {
    const c = stubTable(makeRow(), {
      maybeRows: [makeRow(), makeRow({ status: "executing" })],
      awaitResult: { data: [makeRow({ status: "executing" })], error: null },
    });

    const result = await decideApproval({
      id: 1,
      approver: { uuid: "admin-b", email: "b@example.com", role: "admin" },
      decision: "approve",
    });

    expect(result.executed).toBe(true);
    expect(result.status).toBe("executed");
    expect(mocks.adjustCreditsByAdmin).toHaveBeenCalledWith({
      user_uuid: "user-1",
      credits: 100,
      remark: "客诉补偿 工单#1",
    });
    expect(mocks.trackCriticalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "admin.approval.executed" })
    );
  });

  it("并发抢占失败（另一复核人已处理）→ 报错不执行", async () => {
    const c = stubTable(makeRow(), { awaitResult: { data: [], error: null } });
    await expect(
      decideApproval({
        id: 1,
        approver: { uuid: "admin-b", email: "b@example.com", role: "admin" },
        decision: "approve",
      })
    ).rejects.toThrow("just decided by another reviewer");
    expect(mocks.adjustCreditsByAdmin).not.toHaveBeenCalled();
  });

  it("执行失败 → 单据置 failed 且带错误（可重试）", async () => {
    const c = stubTable(makeRow(), {
      maybeRows: [makeRow(), makeRow({ status: "executing" })],
      awaitResult: { data: [makeRow({ status: "executing" })], error: null },
    });
    mocks.adjustCreditsByAdmin.mockRejectedValue(new Error("ledger insert failed"));

    const result = await decideApproval({
      id: 1,
      approver: { uuid: "admin-b", email: "b@example.com", role: "admin" },
      decision: "approve",
    });

    expect(result.executed).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.exec_error).toContain("ledger insert failed");
  });

  it("驳回：pending → rejected，记录批准人", async () => {
    const c = stubTable(makeRow());
    // reject 路径走 update().eq().eq()，无 select 消费（await 收尾返回 __awaitResult）
    const result = await decideApproval({
      id: 1,
      approver: { uuid: "admin-b", email: "b@example.com", role: "admin" },
      decision: "reject",
      approve_reason: "证据不足",
    });
    expect(result).toEqual({ executed: false, status: "rejected" });
    expect(mocks.trackCriticalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "admin.approval.rejected" })
    );
  });
});

describe("N-6 审批队列：执行分发（dispatchApprovalAction）", () => {
  it("refund：refund_requested 订单只本地闭合，不触达渠道", async () => {
    mocks.findOrderByOrderNo.mockResolvedValue({ status: "refund_requested", order_no: "o1" });
    mocks.processRefund.mockResolvedValue({ deducted_credits: 10 });
    stubTable(makeRow());
    mocks.getPaymentProvider.mockReturnValue({ capabilities: { refund_api: true }, refund: vi.fn() });

    await _internal.dispatchForTest(
      makeRow({
        action: "refund",
        target_uuid: "o1",
        payload: { order_no: "o1", close_only: true },
      })
    );

    expect(mocks.processRefund).toHaveBeenCalled();
    expect(mocks.getPaymentProvider).not.toHaveBeenCalled();
  });

  it("refund：paid 订单走渠道退款 + 本地闭合", async () => {
    mocks.findOrderByOrderNo.mockResolvedValue({
      status: "paid",
      order_no: "o1",
      payment_provider: "stripe",
    });
    const providerRefund = vi.fn().mockResolvedValue(undefined);
    mocks.getPaymentProvider.mockReturnValue({
      capabilities: { refund_api: true },
      refund: providerRefund,
    });
    mocks.processRefund.mockResolvedValue({ deducted_credits: 10 });

    await _internal.dispatchForTest(
      makeRow({
        action: "refund",
        target_uuid: "o1",
        payload: { order_no: "o1", close_only: false },
      })
    );

    expect(providerRefund).toHaveBeenCalled();
    expect(mocks.processRefund).toHaveBeenCalled();
  });

  it("user_status：不得通过审批队列修改 super_admin", async () => {
    mocks.findUserByUuid.mockResolvedValue({ uuid: "u1", role: "super_admin" });
    await expect(
      _internal.dispatchForTest(
        makeRow({ action: "user_status", payload: { user_uuid: "u1", status: "banned" } })
      )
    ).rejects.toThrow("cannot modify super_admin");
  });

  it("user_role：不得通过审批队列降级 super_admin", async () => {
    mocks.findUserByUuid.mockResolvedValue({ uuid: "u1", role: "super_admin" });
    await expect(
      _internal.dispatchForTest(
        makeRow({ action: "user_role", payload: { user_uuid: "u1", role: "admin" } })
      )
    ).rejects.toThrow("cannot demote super_admin");
  });

  it("adjust_credits：payload 形状非法 → 报错", async () => {
    await expect(
      _internal.dispatchForTest(
        makeRow({ action: "adjust_credits", payload: { user_uuid: "u1", credits: 0 } })
      )
    ).rejects.toThrow("invalid adjust_credits payload");
  });

  it("payment_settings：定价不变量在执行时重验（防快照绕过）", async () => {
    mocks.validatePricingFields.mockReturnValue("amount too large");
    await expect(
      _internal.dispatchForTest(
        makeRow({
          action: "payment_settings",
          payload: { products: [{ product_id: "p1", amount: 99999999 }] },
        })
      )
    ).rejects.toThrow("amount too large");
    expect(mocks.updatePaymentProduct).not.toHaveBeenCalled();
  });
});

describe("N-6 审批队列：撤回（cancelApproval）", () => {
  it("仅 pending 且仅发起人本人可撤回（条件更新由 eq 链表达）", async () => {
    const c = stubTable(makeRow());
    await cancelApproval(1, { uuid: "admin-a" });
    // update(...).eq(id).eq(status=pending).eq(requester)
    const updateArg = c.update.mock.calls[0][0];
    expect(updateArg.status).toBe("cancelled");
    expect(c.eq).toHaveBeenCalledWith("id", 1);
    expect(c.eq).toHaveBeenCalledWith("status", "pending");
    expect(c.eq).toHaveBeenCalledWith("requester_uuid", "admin-a");
  });
});
