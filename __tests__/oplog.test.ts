import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models/db", () => ({ getSupabaseClient: vi.fn() }));

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

  it("写入失败不抛出（吞错纪律）", async () => {
    mockInsert.mockResolvedValue({ error: new Error("db down") });
    await expect(
      recordOpEvent({ event_type: "payment.provider_failure" })
    ).resolves.toBeUndefined();
  });
});
