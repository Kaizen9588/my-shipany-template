"use client";

import { useEffect, useState } from "react";
import { GoogleAnalytics as NextGoogleAnalytics } from "@next/third-parties/google";
import { CONSENT_KEY } from "@/components/cookie-consent";

/**
 * Google Analytics（6.17：Cookie 同意后才加载）
 * 保留仅做广告归因（docs/11 §七）。
 */
export default function GoogleAnalytics() {
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      setConsented(localStorage.getItem(CONSENT_KEY) === "accepted");
    } catch (e) {
      // ignore
    }
    const onAccept = () => setConsented(true);
    window.addEventListener("cookie-consent-accepted", onAccept);
    return () => window.removeEventListener("cookie-consent-accepted", onAccept);
  }, []);

  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  const analyticsId = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;
  if (!analyticsId || !consented) {
    return null;
  }

  return <NextGoogleAnalytics gaId={analyticsId} />;
}
