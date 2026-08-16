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
  if (h.fails >= FAIL_THRESHOLD) {
    h.unhealthyUntil = now + UNHEALTHY_TTL_MS;
    h.fails = 0;
    console.warn(
      `[payment] provider ${providerId} marked unhealthy for 30min (${FAIL_THRESHOLD} consecutive failures)`
    );
  }
}

export function recordProviderSuccess(providerId: string): void {
  healthMap.delete(providerId);
}
