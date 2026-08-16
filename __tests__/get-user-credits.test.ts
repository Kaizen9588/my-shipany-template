import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models/db", () => ({ getSupabaseClient: vi.fn() }));
vi.mock("@/models/credit", () => ({ getUserValidCredits: vi.fn() }));
vi.mock("@/models/order", () => ({ getFirstPaidOrderByUserUuid: vi.fn() }));
vi.mock("@/lib/time", () => ({ getIsoTimestr: vi.fn(() => "2026-01-01T00:00:00.000Z") }));
vi.mock("@/lib/hash", () => ({ getSnowId: vi.fn(() => "snow-1") }));
vi.mock("@/lib/email", () => ({ fireAndForgetEmail: vi.fn(), shouldSendToday: vi.fn(() => true) }));
vi.mock("@/models/notification", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/telemetry/server", () => ({ trackServer: vi.fn(), TelemetryEvents: {} }));

import { getUserCredits } from "@/services/credit";
import { getUserValidCredits } from "@/models/credit";
import { getFirstPaidOrderByUserUuid } from "@/models/order";

const mockValidCredits = getUserValidCredits as unknown as ReturnType<typeof vi.fn>;
const mockFirstPaid = getFirstPaidOrderByUserUuid as unknown as ReturnType<typeof vi.fn>;

describe("services/credit getUserCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("无积分时返回 0", async () => {
    mockFirstPaid.mockResolvedValueOnce(undefined);
    mockValidCredits.mockResolvedValueOnce([]);
    const r = await getUserCredits("u1");
    expect(r.left_credits).toBe(0);
    expect(r.is_pro).toBeUndefined();
  });

  it("累加有效积分并标记 is_pro", async () => {
    mockFirstPaid.mockResolvedValueOnce(undefined);
    mockValidCredits.mockResolvedValueOnce([
      { credits: 100, expired_at: "2027-01-01" },
      { credits: 50, expired_at: "2027-01-01" },
      { credits: -10, expired_at: null },
    ]);
    const r = await getUserCredits("u1");
    expect(r.left_credits).toBe(140);
    expect(r.is_pro).toBe(true);
  });

  it("首次付费标记 is_recharged", async () => {
    mockFirstPaid.mockResolvedValueOnce({ order_no: "o1" });
    mockValidCredits.mockResolvedValueOnce([]);
    const r = await getUserCredits("u1");
    expect(r.is_recharged).toBe(true);
  });

  it("查询异常时返回 0", async () => {
    mockFirstPaid.mockRejectedValueOnce(new Error("db down"));
    const r = await getUserCredits("u1");
    expect(r.left_credits).toBe(0);
  });
});
