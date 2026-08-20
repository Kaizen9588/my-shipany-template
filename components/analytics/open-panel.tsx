"use client";

import { useEffect, useState } from "react";
import { OpenPanelComponent } from "@openpanel/nextjs";
import { CONSENT_KEY } from "@/components/cookie-consent";

/** 与 PostHog/GA4 一致：Cookie 同意后才加载（GDPR） */
function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "accepted";
  } catch (e) {
    return false;
  }
}

export default function OpenPanel() {
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    if (hasConsent()) {
      setConsented(true);
      return;
    }
    // 同意后由 CookieConsent 派发事件触发加载
    const onAccept = () => setConsented(true);
    window.addEventListener("cookie-consent-accepted", onAccept);
    return () => window.removeEventListener("cookie-consent-accepted", onAccept);
  }, []);

  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  const clientId = process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID;
  if (!clientId || !consented) {
    return null;
  }

  return (
    <OpenPanelComponent
      clientId={clientId}
      trackScreenViews={true}
      trackAttributes={true}
      trackOutgoingLinks={true}
    />
  );
}
