import type { PaymentEvent } from "@/lib/payment/types";
import { inboxPaymentEvent, markInboxProcessed } from "@/lib/webhook-inbox";

/**
 * 三渠道 webhook 共用的 inbox 处理链（P1，迁移 0031）：
 * 1. ingestEvent —— 验签后的归一化事件落 payment_events（raw 存档 + ____normalized
 *    摘要冗余，cron 重放据此重建）；UNIQUE(provider, provider_event_id) 幂等，
 *    已 processed 的事件（渠道重放）直接跳过业务处理；
 * 2. processInboxedEvent —— handlePaymentEvent + 成败标记（失败留错等重试/cron）。
 *
 * 返回 { skipped }：skipped=true 表示该事件此前已成功处理过，本次只 ack。
 */
export async function processWebhookEvent(
  event: PaymentEvent,
  provider: string
): Promise<{ skipped: boolean }> {
  const { id, duplicate } = await inboxPaymentEvent({
    provider,
    event_type: event.type,
    order_no: event.order_no,
    amount_cents: event.amount,
    currency: event.currency,
    raw: withNormalized(event),
    provider_event_id: event.provider_event_id || "",
    signature_verified: true,
  });
  if (duplicate) {
    return { skipped: true };
  }
  try {
    const { handlePaymentEvent } = await import("@/lib/payment");
    await handlePaymentEvent(event);
    await markInboxProcessed(id, { order_no: event.order_no });
    return { skipped: false };
  } catch (e: any) {
    // inbox 行保留 pending + last_error：渠道重试（幂等键命中）与每日 cron 重放双路兜底
    await markInboxProcessed(id, { error: String(e?.message || e) });
    throw e;
  }
}

/** 归一化摘要冗余：raw_body 顶层挂 ____normalized，cron 重放据此重建事件 */
function withNormalized(event: PaymentEvent): Record<string, unknown> {
  const normalized = {
    type: event.type,
    order_no: event.order_no,
    user_uuid: event.user_uuid,
    credits: event.credits,
    amount: event.amount,
    currency: event.currency,
    provider: event.provider,
    provider_ref_id: event.provider_ref_id,
  };
  const raw = event.raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>), ____normalized: normalized };
  }
  return { payload: raw ?? null, ____normalized: normalized };
}
