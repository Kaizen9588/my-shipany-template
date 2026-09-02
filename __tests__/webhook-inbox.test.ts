import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P1 支付事件 inbox（迁移 0031）服务层单测：
 * - inboxPaymentEvent：幂等键 UNIQUE(provider, provider_event_id) 命中 = duplicate，
 *   provider_event_id 缺省走 sha256(raw) fallback
 * - markInboxProcessed：成功 → processed；失败 → pending + retry_count+1
 * - eventFromInboxRow：raw.____normalized 摘要重建归一化事件
 * - replayPendingEvents：重放 pending/failed、无摘要行置 ignored
 * - reconcilePayments：三规则（漏单/失败积压/金额抽核）计数与告警触发条件
 */

const mocks = vi.hoisted(() => {
  const chain = () => {
    const c: any = {
      select: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: undefined,
    };
    c.then = (_res: any, _rej: any) =>
      Promise.resolve(c.__awaitResult).then(_res, _rej);
    c.__awaitResult = { data: null, error: null };
    return c;
  };
  return {
    clientFrom: vi.fn(),
    chain,
    trackCriticalEvent: vi.fn(),
    handlePaymentEvent: vi.fn(),
  };
});

vi.mock("@/models/db", () => ({
  serverClient: () => ({ from: mocks.clientFrom }),
}));

vi.mock("@/lib/oplog", () => ({ trackCriticalEvent: mocks.trackCriticalEvent }));
vi.mock("@/lib/payment", () => ({ handlePaymentEvent: mocks.handlePaymentEvent }));

import {
  eventFromInboxRow,
  fallbackEventId,
  inboxPaymentEvent,
  markInboxProcessed,
  reconcilePayments,
  replayPendingEvents,
  type PaymentEventRow,
} from "@/lib/webhook-inbox";
import { processWebhookEvent } from "@/lib/webhook-process";

function stubChain(
  opts: { awaitResult?: any; maybeRows?: any[]; maybeResult?: any } = {}
) {
  const c = mocks.chain();
  const maybeRows = opts.maybeRows && opts.maybeRows.length ? [...opts.maybeRows] : [];
  c.maybeSingle = vi.fn().mockImplementation(async () => {
    if (opts.maybeResult) {
      return opts.maybeResult;
    }
    return {
      data: maybeRows.length > 1 ? maybeRows.shift() : maybeRows[0] ?? null,
      error: null,
    };
  });
  if (opts.awaitResult) {
    c.__awaitResult = opts.awaitResult;
  }
  mocks.clientFrom.mockReturnValue(c);
  return c;
}

function makeRow(over: Record<string, unknown> = {}): PaymentEventRow {
  return {
    id: 11,
    provider: "stripe",
    provider_event_id: "evt_1",
    event_type: "payment_succeeded",
    order_no: "P20260901001",
    amount_cents: 1990,
    currency: "usd",
    raw_body: {},
    signature_verified: true,
    status: "pending",
    retry_count: 0,
    last_error: "",
    processed_at: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  } as PaymentEventRow;
}

const normPayload = (over: Record<string, unknown> = {}) => ({
  object: "stripe-original",
  ____normalized: {
    type: "payment_succeeded",
    order_no: "P20260901001",
    user_uuid: "u-1",
    credits: 100,
    amount: 1990,
    currency: "usd",
  },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.trackCriticalEvent.mockReturnValue(undefined);
});

describe("fallbackEventId", () => {
  it("同 raw 输出稳定、跨 raw 不同、带 sha- 前缀且为 40 位", () => {
    const raw = { id: "evt_x", type: "checkout.session.completed" };
    const a = fallbackEventId(raw);
    const b = fallbackEventId({ id: "evt_x", type: "checkout.session.completed" });
    const c = fallbackEventId({ id: "evt_y" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^sha-[0-9a-f]{40}$/);
  });

  it("对象与其 JSON 序列化是同一 digest 输入路径（渠道 payload 均为对象）", () => {
    expect(fallbackEventId({ a: 1 })).toBe(fallbackEventId('{"a":1}'));
  });
});

describe("inboxPaymentEvent", () => {
  it("新事件落库：返回行 id，duplicate=false，字段规范化", async () => {
    const c = stubChain({ maybeResult: { data: makeRow({ id: 42 }), error: null } });

    const { id, duplicate } = await inboxPaymentEvent({
      provider: "stripe",
      event_type: "payment_succeeded",
      order_no: "P1",
      amount_cents: 19.991, // 应四舍五入为分
      currency: "usd",
      raw: { id: "evt_1" },
    });

    expect(id).toBe(42);
    expect(duplicate).toBe(false);
    const row = c.upsert.mock.calls[0][0];
    expect(row.amount_cents).toBe(20);
    expect(row.status).toBe("pending");
    expect(row.signature_verified).toBe(true);
  });

  it("已 processed 的重放：duplicate=true（渠道重试不应重复处理）", async () => {
    stubChain({
      maybeResult: {
        data: makeRow({ id: 7, processed_at: "2026-09-01T01:00:00Z" }),
        error: null,
      },
    });
    const { id, duplicate } = await inboxPaymentEvent({
      provider: "stripe",
      event_type: "payment_succeeded",
      raw: { id: "evt_1" },
    });
    expect(id).toBe(7);
    expect(duplicate).toBe(true);
  });

  it("pending（尚未处理成功）的重放不算 duplicate，重新走业务处理", async () => {
    stubChain({ maybeResult: { data: makeRow({ id: 7 }), error: null } });
    const { duplicate } = await inboxPaymentEvent({
      provider: "stripe",
      event_type: "payment_succeeded",
      raw: { id: "evt_1" },
    });
    expect(duplicate).toBe(false);
  });

  it("未知 provider 拒绝落库", async () => {
    await expect(
      inboxPaymentEvent({ provider: "paypal", event_type: "x", raw: {} })
    ).rejects.toThrow("unknown payment provider");
  });

  it("upsert 失败抛错（由路由转 500 让渠道重试）", async () => {
    stubChain({ maybeResult: { data: null, error: { message: "db down" } } });
    await expect(
      inboxPaymentEvent({ provider: "stripe", event_type: "x", raw: {} })
    ).rejects.toThrow("inbox insert failed");
  });

  it("provider_event_id 缺省时用 sha256(raw) fallback 作幂等键", async () => {
    const c = stubChain({ maybeResult: { data: makeRow(), error: null } });
    const raw = { hello: "world" };
    await inboxPaymentEvent({
      provider: "waffo",
      event_type: "payment_succeeded",
      raw,
    });
    expect(c.upsert.mock.calls[0][0].provider_event_id).toBe(fallbackEventId(raw));
  });
});

describe("markInboxProcessed", () => {
  it("成功：status=processed + processed_at + 清空 last_error + 回填 order_no", async () => {
    const c = stubChain({ awaitResult: { data: null, error: null } });
    await markInboxProcessed(11, { order_no: "P20260901001" });
    const patch = c.update.mock.calls[0][0];
    expect(patch.status).toBe("processed");
    expect(patch.processed_at).toBeTruthy();
    expect(patch.last_error).toBe("");
    expect(patch.order_no).toBe("P20260901001");
    expect(patch.retry_count).toBeUndefined();
  });

  it("失败：status 回 pending + last_error 截断 500 + retry_count+1", async () => {
    const c = stubChain();
    c.maybeSingle.mockResolvedValue({ data: { retry_count: 2 }, error: null });
    await markInboxProcessed(11, { error: "x".repeat(600) });
    const patch = c.update.mock.calls[0][0];
    expect(patch.status).toBe("pending");
    expect(patch.last_error.length).toBe(500);
    expect(patch.retry_count).toBe(3);
    expect(patch.processed_at).toBeUndefined();
  });
});

describe("eventFromInboxRow", () => {
  it("从 raw.____normalized 重建归一化事件", () => {
    const ev = eventFromInboxRow(
      makeRow({ raw_body: normPayload(), amount_cents: 1990 })
    );
    expect(ev).toMatchObject({
      type: "payment_succeeded",
      order_no: "P20260901001",
      user_uuid: "u-1",
      credits: 100,
      amount: 1990,
    });
  });

  it("无摘要（历史行/非对象 payload）→ null（重放时置 ignored）", () => {
    expect(eventFromInboxRow(makeRow({ raw_body: { only: "raw" } }))).toBeNull();
    expect(eventFromInboxRow(makeRow({ raw_body: "not-json" }))).toBeNull();
  });
});

describe("replayPendingEvents", () => {
  it("pending/failed 超 5 分钟被重放：成功 processed、失败留错计数", async () => {
    const rows = [
      makeRow({ id: 1, raw_body: normPayload() }),
      makeRow({ id: 2, raw_body: normPayload() }),
    ];
    const c = stubChain({ awaitResult: { data: rows, error: null } });
    // 第一次 replay 查询消费 __awaitResult；后续 markInboxProcessed 的 update 走 then 收尾
    mocks.handlePaymentEvent
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("rpc boom"));

    const { replayed, processed, failed } = await replayPendingEvents(20);

    expect(replayed).toBe(2);
    expect(processed).toBe(1);
    expect(failed).toBe(1);
    expect(c.__awaitResult).toBeTruthy();
  });

  it("查询条件：只取 pending/failed 且 updated_at 早于 5 分钟前", async () => {
    const c = stubChain({ awaitResult: { data: [], error: null } });
    await replayPendingEvents(20);
    expect(c.in).toHaveBeenCalledWith("status", ["pending", "failed"]);
    const [field, before] = c.lt.mock.calls[0];
    expect(field).toBe("updated_at");
    expect(new Date(before).getTime()).toBeLessThanOrEqual(Date.now() - 5 * 60 * 1000);
  });

  it("无归一化摘要的行 → 置 ignored，不进 processed/failed 计数", async () => {
    const rows = [makeRow({ id: 3, raw_body: { legacy: true } })];
    stubChain({ awaitResult: { data: rows, error: null } });
    const { replayed, processed, failed } = await replayPendingEvents(20);
    expect(replayed).toBe(1);
    expect(processed).toBe(0);
    expect(failed).toBe(0);
  });
});

describe("processWebhookEvent（webhook 路由共用链）", () => {
  const event = {
    type: "payment_succeeded" as const,
    order_no: "P20260901001",
    user_uuid: "u-1",
    credits: 100,
    amount: 1990,
    currency: "usd",
    provider_event_id: "evt_abc",
    raw: { id: "evt_abc", data: { object: {} } },
  };

  it("新事件：落 inbox（raw 顶层冗余 ____normalized）→ handlePaymentEvent → markProcessed", async () => {
    const c = stubChain({ maybeResult: { data: makeRow({ id: 9 }), error: null } });
    mocks.handlePaymentEvent.mockResolvedValueOnce(undefined);

    const { skipped } = await processWebhookEvent(event, "stripe");

    expect(skipped).toBe(false);
    const row = c.upsert.mock.calls[0][0];
    expect(row.provider_event_id).toBe("evt_abc");
    expect(row.raw_body.____normalized.type).toBe("payment_succeeded");
    expect(mocks.handlePaymentEvent).toHaveBeenCalledTimes(1);
  });

  it("duplicate（已 processed 重放）直接跳过，不再触发业务处理", async () => {
    stubChain({
      maybeResult: {
        data: makeRow({ id: 9, processed_at: "2026-09-01T01:00:00Z" }),
        error: null,
      },
    });
    const { skipped } = await processWebhookEvent(event, "stripe");
    expect(skipped).toBe(true);
    expect(mocks.handlePaymentEvent).not.toHaveBeenCalled();
  });

  it("业务处理失败：inbox 留 pending+错误并向上抛错（路由转 500 让渠道重试）", async () => {
    stubChain({ maybeResult: { data: makeRow({ id: 9 }), error: null } });
    mocks.handlePaymentEvent.mockRejectedValueOnce(new Error("order not found"));

    await expect(processWebhookEvent(event, "stripe")).rejects.toThrow(
      "order not found"
    );
    expect(mocks.handlePaymentEvent).toHaveBeenCalledTimes(1);
  });
});

describe("reconcilePayments 三规则", () => {
  function stubReconcile({
    paidOrders,
    events,
    stuck,
  }: {
    paidOrders?: any[];
    events?: any[];
    stuck?: any[];
  }) {
    const queries: any[] = [];
    const mk = (result: any) => {
      const c = mocks.chain();
      c.__awaitResult = { data: result, error: null };
      queries.push(c);
      return c;
    };
    // from() 调用顺序：orders / payment_events(succeeded) / payment_events(stuck)
    let call = 0;
    mocks.clientFrom.mockImplementation((table: string) => {
      if (table === "orders") return mk(paidOrders || []);
      call += 1;
      if (call === 1) return mk(events || []);
      return mk(stuck || []);
    });
    return queries;
  }

  it("规则1+3：paid 订单无事件计 missing；事件金额≠订单金额计 mismatch", async () => {
    stubReconcile({
      paidOrders: [
        { order_no: "OK1", amount: 1990, created_at: "2026-08-31T00:00:00Z" },
        { order_no: "MISS", amount: 990, created_at: "2026-08-31T00:00:00Z" },
        { order_no: "BAD", amount: 1000, created_at: "2026-08-31T00:00:00Z" },
      ],
      events: [
        { order_no: "OK1", amount_cents: 1990, status: "processed" },
        { order_no: "BAD", amount_cents: 500, status: "processed" },
      ],
    });

    const report = await reconcilePayments({ notify: false });

    expect(report.checked_paid_orders).toBe(3);
    expect(report.missing_events).toBe(1);
    expect(report.amount_mismatches).toBe(1);
  });

  it("规则2：pending/failed 且 retry>=3 计入 failed_events", async () => {
    stubReconcile({
      paidOrders: [],
      events: [],
      stuck: [
        { id: 1, retry_count: 3 },
        { id: 2, retry_count: 5 },
      ],
    });
    const report = await reconcilePayments({ notify: false });
    expect(report.failed_events).toBe(2);
  });

  it("有异常 → 发 payment.reconcile_anomaly 告警（含样本）；干净 → 不发", async () => {
    stubReconcile({
      paidOrders: [{ order_no: "MISS", amount: 990, created_at: "2026-08-31T00:00:00Z" }],
      events: [],
    });
    const report = await reconcilePayments();
    expect(report.missing_events).toBe(1);
    expect(mocks.trackCriticalEvent).toHaveBeenCalledTimes(1);
    const arg = mocks.trackCriticalEvent.mock.calls[0][0];
    expect(arg.event_type).toBe("payment.reconcile_anomaly");
    expect(arg.severity).toBe("warn");
    expect(arg.source).toBe("cron");
    expect(arg.detail.missing_sample).toEqual(["MISS"]);

    mocks.trackCriticalEvent.mockClear();
    stubReconcile({
      paidOrders: [{ order_no: "OK", amount: 1000, created_at: "2026-08-31T00:00:00Z" }],
      events: [{ order_no: "OK", amount_cents: 1000, status: "processed" }],
      stuck: [],
    });
    const clean = await reconcilePayments();
    expect(clean.missing_events + clean.failed_events + clean.amount_mismatches).toBe(0);
    expect(mocks.trackCriticalEvent).not.toHaveBeenCalled();
  });
});
