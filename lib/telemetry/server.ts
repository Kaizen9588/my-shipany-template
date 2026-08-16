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
