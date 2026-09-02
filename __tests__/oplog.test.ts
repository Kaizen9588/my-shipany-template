import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ afterJobs: [] as Array<() => unknown> }));

vi.mock("@/models/db", () => ({
  getSupabaseClient: vi.fn(),
  serverClient: vi.fn(),
}));
// after() 只能在请求作用域调用：单测环境捕获回退到微任务执行（runAfterResponse 语义）
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    void Promise.resolve().then(cb);
  },
}));
vi.mock("@/lib/notify", () => ({ notifyChannel: vi.fn(async () => {}) }));

import { getSupabaseClient, serverClient } from "@/models/db";
import { recordOpEvent, dispatchOutboxEvents, outboxMaintenance } from "@/lib/oplog";
import { notifyChannel } from "@/lib/notify";

const mockGetClient = getSupabaseClient as unknown as ReturnType<typeof vi.fn>;
const mockServerClient = serverClient as unknown as ReturnType<typeof vi.fn>;
const mockInsert = vi.fn();
const mockRpc = vi.fn();
const mockNotify = notifyChannel as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockResolvedValue({ error: null });
  mockGetClient.mockReturnValue({ from: () => ({ insert: mockInsert }) });
  mockServerClient.mockReturnValue({
    rpc: mockRpc,
    schema: () => ({ rpc: mockRpc }),
  });
  mockRpc.mockResolvedValue({ data: null, error: null });
});

describe("lib/oplog（docs/16 运营事件落库 + N-4 outbox）", () => {
  it("info 级直插 op_events（规范化字段，不走 outbox）", async () => {
    await recordOpEvent({
      event_type: "payment.provider_success",
    });

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockRpc).not.toHaveBeenCalled();
    const [payload] = mockInsert.mock.calls[0];
    expect(payload).toMatchObject({
      event_type: "payment.provider_success",
      severity: "info",
      source: "app",
      subject_uuid: "",
    });
  });

  it("warn/error/critical 入 outbox 队列（enqueue RPC），info 不入", async () => {
    await recordOpEvent({
      event_type: "payment.refund_processed",
      severity: "warn",
      subject_uuid: "o1",
      detail: { amount: 1 },
    });
    expect(mockRpc).toHaveBeenCalledWith(
      "op_event_outbox_enqueue",
      expect.objectContaining({
        p_event_type: "payment.refund_processed",
        p_severity: "warn",
        p_subject_uuid: "o1",
      })
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("关键事件入队成功后外呼告警（持久化先行，渠道失败只丢告警）", async () => {
    await recordOpEvent({
      event_type: "payment.amount_mismatch",
      severity: "critical",
      subject_uuid: "o1",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "payment.amount_mismatch",
        severity: "critical",
      })
    );
  });

  it("入队失败退回直插路径（不因 outbox 故障丢事件）", async () => {
    mockRpc.mockRejectedValue(new Error("enqueue down"));
    await recordOpEvent({
      event_type: "payment.webhook_invalid_signature",
      severity: "critical",
      subject_uuid: "o2",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [payload] = mockInsert.mock.calls[0];
    expect(payload.event_type).toBe("payment.webhook_invalid_signature");
  });

  it("直插失败不抛出（吞错纪律，错误只进 console）", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInsert.mockRejectedValue(new Error("boom"));
    expect(() =>
      recordOpEvent({ event_type: "payment.provider_failure" })
    ).not.toThrow();

    // 等待后台微任务执行完（吞错分支）
    await new Promise((r) => setTimeout(r, 0));
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("recordOpEvent 同步返回（不阻塞主流程，落库在 after 后台进行）", async () => {
    let resolveInsert: (v: unknown) => void = () => {};
    mockInsert.mockReturnValue(
      new Promise((resolve) => {
        resolveInsert = resolve;
      })
    );

    const ret = recordOpEvent({ event_type: "payment.provider_success" });
    expect(ret).toBeUndefined(); // void：主流程无等待

    resolveInsert({ error: null });
  });
});

describe("lib/oplog dispatchOutboxEvents（N-4 outbox 投递）", () => {
  it("领取→幂等落库→ack；deliver 返回 false 记为 dedup", async () => {
    // 区分两次 deliver 的返回值：ev-1 新插入（true）；ev-2 幂等命中（false）
    let deliverCount = 0;
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "op_event_outbox_claim") {
        return Promise.resolve({
          data: [
            {
              id: 1,
              event_id: "ev-1",
              event_type: "payment.refund_processed",
              severity: "warn",
              source: "app",
              subject_uuid: "o1",
              detail: { amount: 5 },
              attempts: 1,
            },
            {
              id: 2,
              event_id: "ev-2",
              event_type: "payment.dispute_lost",
              severity: "critical",
              source: "webhook",
              subject_uuid: "o2",
              detail: {},
              attempts: 3,
            },
          ],
          error: null,
        });
      }
      if (fn === "op_event_deliver") {
        deliverCount += 1;
        return Promise.resolve({ data: deliverCount === 1, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const result = await dispatchOutboxEvents();

    expect(result.delivered).toBe(1);
    expect(result.deduped).toBe(1);
    expect(result.failed).toBe(0);
    // 每行都 ack
    const ackCalls = mockRpc.mock.calls.filter((c) => c[0] === "op_event_outbox_ack");
    expect(ackCalls.map((c) => c[1].p_id)).toEqual([1, 2]);
  });

  it("deliver 失败走 fail 退避重试（不中断整批）", async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "op_event_outbox_claim") {
        return Promise.resolve({
          data: [
            {
              id: 9,
              event_id: "ev-9",
              event_type: "payment.refund_processed",
              severity: "warn",
              source: "app",
              subject_uuid: "o1",
              detail: {},
              attempts: 1,
            },
          ],
          error: null,
        });
      }
      if (fn === "op_event_deliver") {
        return Promise.resolve({ data: null, error: new Error("db flash") });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await dispatchOutboxEvents();

    expect(result.failed).toBe(1);
    expect(result.delivered).toBe(0);
    const failCall = mockRpc.mock.calls.find(
      (c) => c[0] === "op_event_outbox_fail"
    );
    expect(failCall?.[1]).toEqual(
      expect.objectContaining({ p_id: 9, p_error: "db flash" })
    );
    errSpy.mockRestore();
  });
});

describe("lib/oplog outboxMaintenance（每日 cron 兜底）", () => {
  it("投递 + 清理 dead 死信（cleanup 返回值透传）", async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "op_event_outbox_claim") {
        return Promise.resolve({ data: [], error: null });
      }
      if (fn === "op_event_outbox_cleanup") {
        return Promise.resolve({ data: 3, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const result = await outboxMaintenance();

    expect(result).toEqual({ delivered: 0, deduped: 0, failed: 0, cleaned_dead: 3 });
  });
});

// 让 hoisted 数组被引用（占位：若未来 after job 需要显式 flush，用 mocks.afterJobs 收集）
void mocks;
