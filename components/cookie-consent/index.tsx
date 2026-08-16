"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const CONSENT_KEY = "cookie_consent";

/**
 * Cookie 同意横幅（6.17 GDPR）
 * 同意后才允许加载 GA/PostHog 追踪（analytics 组件读取同一标记）。
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const saved = localStorage.getItem(CONSENT_KEY);
      if (!saved) {
        setVisible(true);
      }
    } catch (e) {
      setVisible(true);
    }
  }, []);

  const accept = () => {
    try {
      localStorage.setItem(CONSENT_KEY, "accepted");
    } catch (e) {
      // ignore
    }
    setVisible(false);
    // 同意后触发 analytics 初始化
    window.dispatchEvent(new Event("cookie-consent-accepted"));
  };

  const decline = () => {
    try {
      localStorage.setItem(CONSENT_KEY, "declined");
    } catch (e) {
      // ignore
    }
    setVisible(false);
  };

  if (!visible) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 rounded-lg border bg-background p-4 shadow-lg md:left-auto md:max-w-md">
      <p className="text-sm">
        We use cookies to improve your experience and analyze site traffic.
        Analytics (Google Analytics / PostHog) only load after you accept.
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={accept}>
          Accept
        </Button>
        <Button size="sm" variant="outline" onClick={decline}>
          Decline
        </Button>
      </div>
    </div>
  );
}

export { CONSENT_KEY };
