"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import moment from "moment";

/**
 * 通知中心（6.14，v1 轮询 30s；SSE 为 v2 优化）
 */
export default function NotificationsList() {
  const t = useTranslations("console.notifications_page");
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    try {
      const resp = await fetch("/api/notifications");
      const { code, data } = await resp.json();
      if (code === 0) {
        setNotifications(data.notifications || []);
        setUnread(data.unread || 0);
      }
    } catch (e) {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  const markAllRead = async () => {
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setUnread(0);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, is_read: true }))
      );
    } catch (e) {
      // 静默
    }
  };

  useEffect(() => {
    fetchNotifications();
    // v1 轮询 30s
    const timer = setInterval(fetchNotifications, 30 * 1000);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">
          {t("title")}
          {unread > 0 && (
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              {unread} {t("unread")}
            </span>
          )}
        </h3>
        {unread > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead}>
            {t("mark_all_read")}
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : notifications.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("no_notifications")}</p>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.uuid}
              className={`rounded-lg border p-4 ${
                n.is_read ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{n.title}</span>
                <span className="text-xs text-muted-foreground">
                  {moment(n.created_at).fromNow()}
                </span>
              </div>
              {n.content && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {n.content}
                </p>
              )}
              <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-xs">
                {n.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
