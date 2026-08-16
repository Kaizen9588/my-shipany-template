/**
 * 客户端埋点入口（6.5，docs/11）
 * 业务代码只调 track()，不 import 任何工具 SDK。
 * posthog-js 动态加载，避免打入服务端 bundle；未配置时静默跳过。
 */
import { TelemetryEvent, TelemetryEvents } from "./types";

export { TelemetryEvents };

let initPromise: Promise<PostHogLike> | null = null;

// posthog-js 实例的最小类型（避免在服务端 bundle 中静态引用其类型）
interface PostHogLike {
  __loaded: boolean;
  init(token: string, config?: Record<string, unknown>): void;
  capture(event: string, properties?: Record<string, unknown>): void;
  identify(userId: string): void;
  isInitialized?(): boolean;
}

function ensureInit(): Promise<PostHogLike> {
  if (initPromise) {
    return initPromise;
  }
  initPromise = import("posthog-js").then(({ default: posthog }) => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) {
      return posthog as unknown as PostHogLike;
    }
    const loaded = (posthog as unknown as PostHogLike).__loaded;
    if (!loaded) {
      posthog.init(key, {
        api_host:
          process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
        capture_pageview: true,
        // 隐私内置：会话回放遮盖输入框内容（docs/11 §九）
        session_recording: {
          maskAllInputs: true,
        },
      });
    }
    return posthog as unknown as PostHogLike;
  });
  return initPromise;
}

export function track(event: TelemetryEvent): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    void ensureInit().then((posthog) => {
      if (!posthog.__loaded) {
        return;
      }
      posthog.capture(event.name, event.properties || {});
    });
  } catch (e) {
    // 埋点失败静默
  }
}

/** 登录后绑定 user_uuid（身份缝合：匿名 ID → 登录后同一人） */
export function identify(userId: string): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    void ensureInit().then((posthog) => {
      if (!posthog.__loaded) {
        return;
      }
      posthog.identify(userId);
    });
  } catch (e) {
    // 静默
  }
}
