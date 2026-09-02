/**
 * 服务端埋点（6.5，docs/11）
 * 服务端事件是真相源（webhook/API 事实），客户端事件仅辅助。
 * ⚠️ 必须 try-catch 吞错，不阻塞主流程；webhook/事务后调用。
 */
import { PostHog } from "posthog-node";
import { TelemetryEvent, TelemetryEvents } from "./types";

export { TelemetryEvents };

let client: PostHog | null = null;

function getClient(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    return null;
  }
  if (!client) {
    client = new PostHog(key, {
      host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    });
  }
  return client;
}

export function trackServer(event: TelemetryEvent): void {
  try {
    const c = getClient();
    if (!c) {
      return;
    }
    void c.capture({
      distinctId: event.distinctId || "server",
      event: event.name,
      properties: event.properties || {},
    });
  } catch (e) {
    // 埋点失败静默，绝不阻塞主流程
    console.error("[telemetry] trackServer failed:", e);
  }
}

export function identifyServer(
  distinctId: string,
  props?: Record<string, unknown>
): void {
  try {
    const c = getClient();
    if (!c) {
      return;
    }
    void c.identify({ distinctId, properties: props || {} });
  } catch (e) {
    console.error("[telemetry] identifyServer failed:", e);
  }
}

/**
 * GDPR 删除联动（docs/04 §8 待补 1）：账号删除时请求 PostHog 删除该用户数据。
 * posthog-node v5 已移除 deletePerson API，官方替代是发送 `$delete_person`
 * 事件（capture 路径，PostHog 服务端按事件消费并删除对应 person profile）。
 * 吞错不阻塞账号删除主流程；未配置 PostHog 时静默跳过。
 */
export function deleteTelemetryUser(distinctId: string): void {
  try {
    const c = getClient();
    if (!c) {
      return;
    }
    void c.capture({
      distinctId,
      event: "$delete_person",
    });
  } catch (e) {
    console.error("[telemetry] deleteUser failed:", e);
  }
}
