import { createHash } from "crypto";
import { serverClient } from "@/models/db";
import { trackCriticalEvent } from "@/lib/oplog";
import type { PaymentEvent } from "@/lib/payment/types";

/**
 * 支付事件 Inbox（P1，迁移 0031，docs/03 §payment_events 目标方案）
 *
 * 三渠道 webhook 在 parseWebhook（验签）之后、handlePaymentEvent（业务）之前
 * 先落 payment_events（原始 payload 存档）：
 * - UNIQUE (provider, provider_event_id) 幂等：渠道重试同事件 INSERT 冲突即
 *   返回已存在行（不重复处理）；provider_event_id 缺省时 fallback = sha256(raw) 前 40 位
 * - 处理成功 → processed；失败 → 保留 pending + retry_count/last_error
 *   （渠道重试与每日 cron 双路兜底）
 * - reconcilePayments：每日对账三规则（漏单嫌疑 / 失败积压 / 金额抽核）
 */

export type PaymentEventStatus =
  | "pending"
  | "processing"
  | "processed"
  | "failed"
  | "ignored";

export interface PaymentEventRow {
  id: number;
  provider: string;
  provider_event_id: string;
  event_type: string;
  order_no: string;
  amount_cents: number | null;
  currency: string | null;
  raw_body: unknown;
  signature_verified: boolean;
  status: PaymentEventStatus;
  retry_count: number;
  last_error: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

const PROVIDER_IDS = new Set(["stripe", "creem", "waffo"]);

export function fallbackEventId(raw: unknown): string {
  const s = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
  return `sha-${createHash("sha256").update(s).digest("hex").slice(0, 40)}`;
}

function table() {
  return serverClient().from("payment_events");
}

/**
 * 渠道事件归一化结果落 inbox（先持久化，后处理）。
 * @returns inbox 行 id；duplicate=true 表示该事件此前已落过（渠道重放），不应重复处理
 */
export async function inboxPaymentEvent(input: {
  provider: string;
  event_type: string;
  order_no?: string;
  amount_cents?: number | null;
  currency?: string | null;
  raw: unknown;
  provider_event_id?: string;
  signature_verified?: boolean;
}): Promise<{ id: number; duplicate: boolean }> {
  const provider = String(input.provider || "");
  if (!PROVIDER_IDS.has(provider)) {
    throw new Error(`unknown payment provider: ${provider}`);
  }
  const row = {
    provider,
    provider_event_id: input.provider_event_id || fallbackEventId(input.raw),
    event_type: input.event_type || "unknown",
    order_no: input.order_no || "",
    amount_cents:
      typeof input.amount_cents === "number" ? Math.round(input.amount_cents) : null,
    currency: input.currency || null,
    raw_body: (input.raw ?? {}) as object,
    signature_verified: input.signature_verified !== false,
    status: "pending" as const,
  };
  // ON CONFLICT 幂等：渠道重试返回已存在行，不重复处理
  const { data, error } = await table()
    .upsert(row, { onConflict: "provider,provider_event_id", ignoreDuplicates: false })
    .select()
    .maybeSingle();
  if (error) {
    throw new Error(`inbox insert failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("inbox insert returned no row");
  }
  const existing = data as PaymentEventRow;
  // 幂等判定：已处理过（processed_at 落了）= 渠道重放，调用方跳过重复处理
  const duplicate = existing.processed_at !== null;
  return { id: existing.id, duplicate };
}

/** 标记处理结果：成功 processed / 失败 pending+错误（保留给渠道重试与 cron 重放） */
export async function markInboxProcessed(
  id: number,
  opts: { order_no?: string; error?: string } = {}
): Promise<void> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (opts.error) {
    patch.status = "pending";
    patch.last_error = String(opts.error).slice(0, 500);
    patch.retry_count = (await getRetryCount(id)) + 1;
  } else {
    patch.status = "processed";
    patch.processed_at = new Date().toISOString();
    patch.last_error = "";
  }
  if (opts.order_no) {
    patch.order_no = opts.order_no;
  }
  const { error } = await table().update(patch).eq("id", id);
  if (error) {
    console.error("[webhook-inbox] mark processed failed:", error.message);
  }
}

async function getRetryCount(id: number): Promise<number> {
  const { data } = await table().select("retry_count").eq("id", id).maybeSingle();
  return (data as { retry_count: number } | null)?.retry_count || 0;
}

/**
 * 从 inbox 行重建归一化事件（cron 重放用）。raw_body 存的是归一化前的
 * 渠道原始 payload，重放走同一 handlePaymentEvent 语义需要归一化字段，
 * 因此 raw_body 里冗余存了归一化摘要（见 raw.____normalized）。
 */
export function eventFromInboxRow(row: PaymentEventRow): PaymentEvent | null {
  const raw = (row.raw_body || {}) as Record<string, unknown>;
  const norm = raw.____normalized as
    | {
        type: PaymentEvent["type"];
        order_no: string;
        user_uuid: string;
        credits: number;
        amount: number;
        currency?: string;
        provider?: string;
        provider_ref_id?: string;
      }
    | undefined;
  if (!norm || !norm.type) {
    return null;
  }
  return {
    type: norm.type,
    order_no: norm.order_no || row.order_no,
    user_uuid: norm.user_uuid || "",
    credits: norm.credits || 0,
    amount: typeof norm.amount === "number" ? norm.amount : row.amount_cents || 0,
    currency: norm.currency || row.currency || undefined,
    provider: norm.provider || row.provider,
    provider_ref_id: norm.provider_ref_id,
    raw,
  };
}

/** 每日 cron：重放 pending/failed（超 5 分钟，给渠道重试让路），有界批处理 */
export async function replayPendingEvents(limit = 20): Promise<{
  replayed: number;
  processed: number;
  failed: number;
}> {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, error } = await table()
    .select("*")
    .in("status", ["pending", "failed"])
    .lt("updated_at", staleBefore)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(`replay query failed: ${error.message}`);
  }
  const rows = (data as PaymentEventRow[]) || [];
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    const event = eventFromInboxRow(row);
    if (!event) {
      // 无归一化摘要的历史行/未知行：置 ignored 不再重放
      await table()
        .update({ status: "ignored", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      continue;
    }
    try {
      const { handlePaymentEvent } = await import("@/lib/payment");
      await handlePaymentEvent(event);
      await markInboxProcessed(row.id, { order_no: event.order_no });
      processed += 1;
    } catch (e: any) {
      await markInboxProcessed(row.id, { error: String(e?.message || e) });
      failed += 1;
    }
  }
  return { replayed: rows.length, processed, failed };
}

export interface ReconcileReport {
  checked_paid_orders: number;
  missing_events: number;
  failed_events: number;
  amount_mismatches: number;
}

/**
 * 每日对账（P1 验收核心）：
 * 1. 漏单嫌疑：近 7 天本地 paid 订单，无任何 payment_succeeded inbox 事件
 *    （含 pending——事件落过库即算到达，说明 webhook 从未到达或验签失败）→ 告警；
 * 2. 失败积压：pending/failed 且重试 ≥ 3 的事件 → 告警清单；
 * 3. 金额抽核：已落库事件金额 ≠ 本地订单金额（实时链路由 handle_order_payment
 *    精确比对兜底，此处是事后档案核）→ 告警。
 */
export async function reconcilePayments(
  opts: { windowHours?: number; notify?: boolean } = {}
): Promise<ReconcileReport> {
  const windowHours = opts.windowHours ?? 24 * 7;
  const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();

  // 1. paid 订单 vs payment_succeeded 事件
  const { data: paidOrders, error: paidErr } = await serverClient()
    .from("orders")
    .select("order_no, amount, payment_provider, created_at")
    .eq("status", "paid")
    .gte("created_at", since)
    .limit(500);
  if (paidErr) {
    throw new Error(`reconcile paid orders query failed: ${paidErr.message}`);
  }
  const orders = (paidOrders as Array<Record<string, any>>) || [];

  const { data: succeededEvents, error: evErr } = await table()
    .select("order_no, amount_cents, status")
    .eq("event_type", "payment_succeeded")
    .gte("created_at", since)
    .limit(1000);
  if (evErr) {
    throw new Error(`reconcile events query failed: ${evErr.message}`);
  }
  const evByOrder = new Map<string, { amount_cents: number | null; status: string }>();
  for (const ev of (succeededEvents as Array<Record<string, any>>) || []) {
    if (ev.order_no && !evByOrder.has(ev.order_no)) {
      evByOrder.set(ev.order_no, { amount_cents: ev.amount_cents, status: ev.status });
    }
  }

  const missing: string[] = [];
  const amountMismatch: Array<{ order_no: string; order_amount: number; event_amount: number | null }> = [];
  for (const o of orders) {
    const ev = evByOrder.get(o.order_no);
    if (!ev) {
      missing.push(o.order_no);
      continue;
    }
    if (
      ev.amount_cents !== null &&
      typeof o.amount === "number" &&
      ev.amount_cents !== o.amount
    ) {
      amountMismatch.push({
        order_no: o.order_no,
        order_amount: o.amount,
        event_amount: ev.amount_cents,
      });
    }
  }

  // 2. 失败积压
  const { data: stuck, error: stuckErr } = await table()
    .select("id, provider, event_type, order_no, retry_count, last_error")
    .in("status", ["pending", "failed"])
    .gte("retry_count", 3)
    .limit(50);
  if (stuckErr) {
    throw new Error(`reconcile stuck query failed: ${stuckErr.message}`);
  }
  const failedEvents = ((stuck as Array<Record<string, any>>) || []).length;

  const report: ReconcileReport = {
    checked_paid_orders: orders.length,
    missing_events: missing.length,
    failed_events: failedEvents,
    amount_mismatches: amountMismatch.length,
  };

  // 告警（有任何异常才发；notify=false 时仅返回报告）
  if (opts.notify !== false && (missing.length > 0 || failedEvents > 0 || amountMismatch.length > 0)) {
    trackCriticalEvent({
      event_type: "payment.reconcile_anomaly",
      severity: "warn",
      source: "cron",
      subject_uuid: "",
      detail: {
        ...report,
        missing_sample: missing.slice(0, 5),
        mismatch_sample: amountMismatch.slice(0, 5),
      },
    });
  }
  return report;
}
