/**
 * 支付渠道健康检测（6.1 阶段 3 failover，docs/payment/provider-abstraction.md §6.2）
 *
 * - createCheckout 连续失败 5 次 / 10 分钟 → 标记 unhealthy（TTL 30 分钟）
 * - 同支付方式请求自动路由下一优先级渠道
 * - 告警记录日志，人工决定永久禁用（payment_settings）
 *
 * v1 内存级实现（单实例）；多实例需 Redis（与 6.18 限流同一升级路径）。
 */
const FAIL_THRESHOLD = 5;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const UNHEALTHY_TTL_MS = 30 * 60 * 1000;

interface ProviderHealth {
  fails: number;
  firstFailAt: number;
  unhealthyUntil: number; // 0 = 从未被标记 unhealthy
}

const healthMap = new Map<string, ProviderHealth>();

import { notifyChannel } from "@/lib/notify";
import { fireAndForgetOpEvent } from "@/lib/oplog";

export function isProviderHealthy(providerId: string): boolean {
  const h = healthMap.get(providerId);
  if (!h) {
    return true;
  }
  if (h.unhealthyUntil > Date.now()) {
    return false;
  }
  // 仅当曾被标记 unhealthy 且 TTL 到期时才清除并恢复；
  // 仍在累计失败次数（unhealthyUntil === 0）时不得删除，否则计数被重置。
  if (h.unhealthyUntil > 0) {
    healthMap.delete(providerId);
  }
  return true;
}

export function recordProviderFailure(providerId: string): void {
  const now = Date.now();
  const h = healthMap.get(providerId);

  if (!h || now - h.firstFailAt > FAIL_WINDOW_MS) {
    healthMap.set(providerId, {
      fails: 1,
      firstFailAt: now,
      unhealthyUntil: 0,
    });
    return;
  }

  h.fails += 1;
  // 失败事件落库（24h 成败统计底座）
  fireAndForgetOpEvent({
    event_type: "payment.provider_failure",
    severity: "warn",
    subject_uuid: providerId,
    detail: { provider: providerId, fail_counts: h.fails },
  });

  if (h.fails >= FAIL_THRESHOLD) {
    h.unhealthyUntil = now + UNHEALTHY_TTL_MS;
    h.fails = 0;
    console.warn(
      `[payment] provider ${providerId} marked unhealthy for 30min (${FAIL_THRESHOLD} consecutive failures)`
    );
    // 6.23：渠道摘除即时告警（飞书/企微；fire-and-forget，不阻塞路由）
    fireAndForgetOpEvent({
      event_type: "payment.provider_unhealthy",
      severity: "critical",
      subject_uuid: providerId,
      detail: { provider: providerId, threshold: FAIL_THRESHOLD, ttl_minutes: 30 },
    });
    void notifyChannel({
      title: `🚨 支付渠道 [${providerId}] 已自动摘除`,
      body: `连续 ${FAIL_THRESHOLD} 次失败，自动设为 unhealthy 30 分钟。\n`
        + `处置：先到渠道后台确认是否风控/封禁；若短期无法恢复，`
        + `建议在后台「支付渠道」中将 ${providerId} 设为禁用。`,
      severity: "critical",
      subject: providerId,
      eventType: "payment.provider_unhealthy",
    });
  }
}

export function recordProviderSuccess(providerId: string): void {
  const wasUnhealthy = healthMap.get(providerId)?.unhealthyUntil || 0;
  healthMap.delete(providerId);

  // 成功事件落库（24h 成败统计底座）
  fireAndForgetOpEvent({
    event_type: "payment.provider_success",
    severity: "info",
    subject_uuid: providerId,
    detail: { provider: providerId },
  });

  if (wasUnhealthy > Date.now()) {
    console.log(`[payment] provider ${providerId} recovered`);
    fireAndForgetOpEvent({
      event_type: "payment.provider_recovered",
      severity: "info",
      subject_uuid: providerId,
      detail: { provider: providerId },
    });
    // 6.23：恢复通知（info 级别，低于默认 warn 会被过滤器跳过）
    void notifyChannel({
      title: `✅ 支付渠道 [${providerId}] 已恢复`,
      body: `渠道健康检测已恢复，路由重新启用该渠道。`,
      severity: "info",
      subject: providerId,
      eventType: "payment.provider_recovered",
    });
  }
}


/** 后台 /admin/payment 展示：渠道健康状态快照（内存级，单实例） */
export function getProviderHealthSnapshot(): Record<
  string,
  { fails: number; firstFailAt: number; unhealthyUntil: number }
> {
  const out: Record<
    string,
    { fails: number; firstFailAt: number; unhealthyUntil: number }
  > = {};
  healthMap.forEach((h, providerId) => {
    out[providerId] = { ...h };
  });
  return out;
}
