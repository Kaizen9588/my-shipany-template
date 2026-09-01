"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const CONSENT_KEY = "cookie_consent";

/**
 * Cookie 同意横幅（6.17 GDPR）
 * 同意后才允许加载 GA/PostHog/OpenPanel 追踪（analytics 组件读取同一标记）。
 *
 * 存储：JSON（analytics / recording 两个布尔位）。
 * 兼容旧值：历史纯字符串 "accepted"/"declined" 按旧语义读（accepted=全允许）。
 * 仅必要（Reject All / 关掉 analytics）时两者均为 false——analytics 组件只在
 * analytics=true 时加载，与旧契约一致；recording 目前预留（未接入会话录制服务）。
 */
type ConsentValue = {
  analytics: boolean;
  recording: boolean;
};

function readConsent(): ConsentValue | null {
  try {
    const saved = localStorage.getItem(CONSENT_KEY);
    if (!saved) {
      return null;
    }
    if (saved === "accepted") {
      return { analytics: true, recording: true };
    }
    if (saved === "declined") {
      return { analytics: false, recording: false };
    }
    const parsed = JSON.parse(saved) as Partial<ConsentValue>;
    return {
      analytics: parsed.analytics === true,
      recording: parsed.recording === true,
    };
  } catch (e) {
    return null;
  }
}

function writeConsent(value: ConsentValue) {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(value));
  } catch (e) {
    // ignore
  }
}

export default function CookieConsent() {
  const t = useTranslations("cookie_consent");
  const [visible, setVisible] = useState(false);
  const [customising, setCustomising] = useState(false);
  const [prefs, setPrefs] = useState<ConsentValue>({
    analytics: true,
    recording: true,
  });

  useEffect(() => {
    if (readConsent() === null) {
      setVisible(true);
    }
  }, []);

  const save = (value: ConsentValue) => {
    writeConsent(value);
    setVisible(false);
    setCustomising(false);
    // 兼容旧契约：仅当 analytics 同意时广播，analytics 组件据此初始化
    if (value.analytics) {
      window.dispatchEvent(new Event("cookie-consent-accepted"));
    }
  };

  if (!visible) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-label={t("title")}
      className="fixed bottom-4 left-4 right-4 z-50 rounded-lg border bg-background p-4 shadow-lg md:left-auto md:max-w-md"
    >
      <p className="text-sm font-medium">{t("title")}</p>
      <p className="mt-1.5 text-sm text-muted-foreground">{t("description")}</p>

      {customising && (
        <div className="mt-4 space-y-3 rounded-md border bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{t("necessary_title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("necessary_desc")}
              </p>
            </div>
            <Switch checked disabled aria-readonly />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{t("analytics_title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("analytics_desc")}
              </p>
            </div>
            <Switch
              checked={prefs.analytics}
              onCheckedChange={(checked) =>
                setPrefs((p) => ({ ...p, analytics: checked }))
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{t("recording_title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("recording_desc")}
              </p>
            </div>
            <Switch
              checked={prefs.recording}
              onCheckedChange={(checked) =>
                setPrefs((p) => ({ ...p, recording: checked }))
              }
            />
          </div>
        </div>
      )}

      <p className="mt-2.5 text-xs text-muted-foreground">
        <a
          href="/privacy-policy"
          target="_blank"
          rel="noopener"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {t("privacy_link")}
        </a>
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {customising ? (
          <>
            <Button size="sm" variant="outline" onClick={() => save({ analytics: false, recording: false })}>
              {t("reject_all")}
            </Button>
            <Button size="sm" onClick={() => save(prefs)}>
              {t("save_prefs")}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => setCustomising(true)}>
              {t("customise")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => save({ analytics: false, recording: false })}>
              {t("reject_all")}
            </Button>
            <Button size="sm" onClick={() => save({ analytics: true, recording: true })}>
              {t("accept_all")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export { CONSENT_KEY };
