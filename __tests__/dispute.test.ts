import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  trackCriticalEvent: vi.fn(),
}));

vi.mock("@/models/db", () => ({
  getSupabaseClient: mocks.client,
  serverClient: mocks.client,
  userClient: mocks.client,
}));
vi.mock("@/lib/oplog", () => ({ trackCriticalEvent: mocks.trackCriticalEvent }));

import { handleDisputeEvent } from "@/services/dispute";
import { serverClient } from "@/models/db";

const mockClient = serverClient as unknown as ReturnType<typeof vi.fn>;
const mockTrack = mocks.trackCriticalEvent;

/** 构造 from(table).update(patch).eq(col,val)... 的链式 mock，返回包装 */
function makeDb() {
  const tables: Record<string, { update: ReturnType<typeof vi.fn> }> = {};
  // N-13 剩余：dispute_lost 会走 supabase.schema("private").rpc("reverse_affiliate_reward")
  const rpc = vi.fn().mockResolvedValue({ data: 0, error: null });
  const from = vi.fn((table: string) => {
    if (!tables[table]) {
      const update = vi.fn();
      // update(patch).eq(a).eq(b)...：eq 链可任意延续，最终 resolve { error: null }
      const eqChain = () =>
        new Proxy(Promise.resolve({ error: null }), {
          get(target, prop, receiver) {
            if (prop === "then") return target.then.bind(target);
            if (prop === "eq") return () => eqChain();
            return Reflect.get(target, prop, receiver);
          },
        });
      update.mockReturnValue({ eq: () => eqChain() });
      tables[table] = { update };
    }
    return tables[table];
  });
  mockClient.mockReturnValue({ from, schema: () => ({ rpc }) });
  return { from, tables, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("services/dispute handleDisputeEvent（N-13 争议/拒付链路）", () => {
  it("dispute_opened 将订单置 disputed 并告警（冻结消费，保留余额）", async () => {
    const db = makeDb();

    await handleDisputeEvent({
      order_no: "o1",
      user_uuid: "u1",
      type: "dispute_opened",
      amount: 1000,
    });

    expect(db.tables.orders.update).toHaveBeenCalledWith({ status: "disputed" });
    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "payment.dispute_opened" })
    );
  });

  it("dispute_won 解冻订单回 paid", async () => {
    const db = makeDb();

    await handleDisputeEvent({
      order_no: "o1",
      user_uuid: "u1",
      type: "dispute_won",
    });

    expect(db.tables.orders.update).toHaveBeenCalledWith({ status: "paid" });
    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "payment.dispute_won" })
    );
  });

  it("dispute_lost 订单置 charged_back 并账号 restricted（拒付成立，防重复作恶）", async () => {
    const db = makeDb();

    await handleDisputeEvent({
      order_no: "o1",
      user_uuid: "u1",
      type: "dispute_lost",
      amount: 1000,
    });

    expect(db.tables.orders.update).toHaveBeenCalledWith({ status: "charged_back" });
    expect(db.tables.users.update).toHaveBeenCalledWith({ status: "restricted" });
    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "payment.dispute_lost", severity: "critical" })
    );
  });

  it("dispute_lost 同步冲销联盟佣金（N-13 剩余，结果进埋点 detail）", async () => {
    const db = makeDb();
    db.rpc.mockResolvedValue({ data: 2000, error: null });

    await handleDisputeEvent({
      order_no: "o1",
      user_uuid: "u1",
      type: "dispute_lost",
      amount: 1000,
    });

    expect(db.rpc).toHaveBeenCalledWith(
      "reverse_affiliate_reward",
      expect.objectContaining({ p_order_no: "o1" })
    );
    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ reversed_affiliate_reward: 2000 }),
      })
    );
  });

  it("dispute_opened/won 不触发联盟佣金冲销（仅拒付成立时回收）", async () => {
    const db = makeDb();

    await handleDisputeEvent({
      order_no: "o1",
      user_uuid: "u1",
      type: "dispute_opened",
      amount: 1000,
    });
    await handleDisputeEvent({
      order_no: "o2",
      user_uuid: "u1",
      type: "dispute_won",
    });

    expect(db.rpc).not.toHaveBeenCalled();
  });
});