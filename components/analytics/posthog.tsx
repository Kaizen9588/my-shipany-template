"use client";

import posthog from "posthog-js";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { CONSENT_KEY } from "@/components/cookie-consent";

/** 6.17：Cookie 同意后才初始化（GDPR） */
function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "accepted";
  } catch (e) {
    return false;
  }
}

/**
 * PostHog 客户端初始化（6.5）
 * - 配置 NEXT_PUBLIC_POSTHOG_KEY 后启用
 * - 登录后自动 identify(user_uuid)（身份缝合）
 * - 隐私：输入框内容默认遮盖
 */
export default function PostHogAnalytics() {
  const { data: session } = useSession();

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) {
      return;
    }

    if (!hasConsent()) {
      // 同意后由 CookieConsent 派发事件触发初始化
      const onAccept = () => {
        if (!posthog.__loaded) {
          posthog.init(key, {
            api_host:
              process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
            capture_pageview: true,
            session_recording: {
              maskAllInputs: true,
            },
          });
        }
        const uuid = session?.user?.uuid;
        if (uuid) {
          posthog.identify(uuid);
        }
      };
      window.addEventListener("cookie-consent-accepted", onAccept);
      return () => window.removeEventListener("cookie-consent-accepted", onAccept);
    }

    if (!posthog.__loaded) {
      posthog.init(key, {
        api_host:
          process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
        capture_pageview: true,
        session_recording: {
          maskAllInputs: true,
        },
      });
    }

    const uuid = session?.user?.uuid;
    if (uuid) {
      posthog.identify(uuid);
    }
  }, [session]);

  return null;
}
