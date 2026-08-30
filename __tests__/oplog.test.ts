import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ afterJobs: [] as Array<() => unknown> }));

vi.mock("@/models/db", () => ({ getSupabaseClient: vi.fn() }));
// after() 只能在请求作用域调用：单测环境捕获回退到微任务执行（runAfterResponse 语义）
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    void Promise.resolve().then(cb);
  },
}));

import { getSupabaseClient } from "@/models/db";
import { recordOpEvent } from "@/lib/oplog";

const mockGetClient = getSupabaseClient as unknown as ReturnType<typeof vi.fn>;
const mockInsert = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockResolvedValue({ error: null });
  mockGetClient.mockReturnValue({ from: () => ({ insert: mockInsert }) });
});

describe("lib/oplog（docs/16 运营事件落库）", () => {
  it("写入 op_events 使用规范化字段", async () => {
    await recordOpEvent({
      event_type: "payment.provider_failure",
      severity: "warn",
      subject_uuid: "stripe",
      detail: { provider: "stripe", fail_counts: 2 },
    });

    expect(mockGetClient).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [payload] = mockInsert.mock.calls[0];
    expect(payload).toMatchObject({
      event_type: "payment.provider_failure",
      severity: "warn",
      source: "app",
      subject_uuid: "stripe",
      detail: { provider: "stripe", fail_counts: 2 },
    });
  });

  it("默认级别与来源为 info/app", async () => {
    await recordOpEvent({ event_type: "payment.provider_success" });
    const [payload] = mockInsert.mock.calls[0];
    expect(payload.severity).toBe("info");
    expect(payload.source).toBe("app");
    expect(payload.subject_uuid).toBe("");
  });

  it("写入失败不抛出（吞错纪律，落库错误只进 console）", async () => {
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

// 让 hoisted 数组被引用（占位：若未来 after job 需要显式 flush，用 mocks.afterJobs 收集）
void mocks;
