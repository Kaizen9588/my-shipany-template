"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  NOTIFY_EVENTS,
  type NotifyEventRule,
} from "@/lib/notify/events";

interface NotifyConfig {
  feishuWebhookUrl: string;
  feishuSecret: string;
  wecomWebhookUrl: string;
  notifyMinSeverity: "info" | "warn" | "error" | "critical";
}

const SEVERITIES: Array<NotifyConfig["notifyMinSeverity"]> = [
  "info",
  "warn",
  "error",
  "critical",
];

export default function NotifySettingsForm({
  initial,
  initialRules,
}: {
  initial: NotifyConfig;
  initialRules: Record<string, NotifyEventRule>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<NotifyConfig>(initial);
  const [rules, setRules] = useState<Record<string, NotifyEventRule>>(
    initialRules
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const set = (key: keyof NotifyConfig, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setRule = (eventType: string, partial: Partial<NotifyEventRule>) => {
    setRules((prev) => ({
      ...prev,
      [eventType]: { ...prev[eventType], ...partial },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const resp = await fetch("/api/admin/notify-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, eventRules: rules }),
      });
      const { code, message } = await resp.json();
      if (code !== 0) {
        toast.error(message);
        return;
      }
      toast.success("告警配置已保存");
      router.refresh();
    } catch (e) {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const testSend = async () => {
    setTesting(true);
    try {
      const resp = await fetch("/api/admin/notify-settings", {
        method: "POST",
      });
      const { code, message } = await resp.json();
      if (code !== 0) {
        toast.error(message);
        return;
      }
      toast.success("测试消息已发送，请查看飞书/企微群");
    } catch (e) {
      toast.error("发送失败");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="feishu-url">飞书机器人 Webhook</Label>
          <Input
            id="feishu-url"
            type="url"
            placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
            value={form.feishuWebhookUrl}
            onChange={(e) => set("feishuWebhookUrl", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="feishu-secret">飞书签名密钥（可留空）</Label>
          <Input
            id="feishu-secret"
            value={form.feishuSecret}
            placeholder="群设置开启签名校验时填"
            onChange={(e) => set("feishuSecret", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="wecom-url">企业微信机器人 Webhook</Label>
          <Input
            id="wecom-url"
            type="url"
            placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
            value={form.wecomWebhookUrl}
            onChange={(e) => set("wecomWebhookUrl", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="severity">默认可通知的最低级别</Label>
          <select
            id="severity"
            value={form.notifyMinSeverity}
            onChange={(e) =>
              set("notifyMinSeverity", e.target.value as NotifyConfig["notifyMinSeverity"])
            }
            className="w-full rounded-md border px-3 py-1.5 text-sm"
          >
            <option value="info">info（全部推送）</option>
            <option value="warn">warn（默认）</option>
            <option value="error">error</option>
            <option value="critical">critical（仅重大事件）</option>
          </select>
        </div>
      </div>

      <div>
        <h4 className="mb-1 font-medium">可通知事件（事件级开关与最低级别）</h4>
        <p className="mb-3 text-sm text-muted-foreground">
          关闭某个事件后，即使全局级别通过也不会推送；事件的最低级别可以单独收紧或放宽。
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">事件</th>
                <th>说明</th>
                <th className="w-28">接入状态</th>
                <th className="w-24">启用</th>
                <th className="w-36">最低级别</th>
              </tr>
            </thead>
            <tbody>
              {NOTIFY_EVENTS.map((ev) => {
                const rule = rules[ev.eventType] || {
                  enabled: true,
                  severity: ev.defaultSeverity,
                };
                return (
                  <tr key={ev.eventType} className="border-b">
                    <td className="p-3">
                      <div className="font-medium">{ev.label}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {ev.eventType}
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{ev.description}</td>
                    <td className="p-3">
                      <span
                        className={
                          ev.status === "已接入"
                            ? "text-green-700"
                            : ev.status === "仅日志"
                            ? "text-amber-600"
                            : "text-muted-foreground"
                        }
                      >
                        {ev.status}
                      </span>
                    </td>
                    <td className="p-3">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(v) =>
                          setRule(ev.eventType, { enabled: v })
                        }
                      />
                    </td>
                    <td className="p-3">
                      <select
                        value={rule.severity}
                        disabled={!rule.enabled}
                        onChange={(e) =>
                          setRule(ev.eventType, {
                            severity: e.target.value as NotifyEventRule["severity"],
                          })
                        }
                        className="w-full rounded-md border px-2 py-1 text-sm disabled:opacity-50"
                      >
                        {SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存配置"}
        </Button>
        <Button variant="outline" onClick={testSend} disabled={testing}>
          {testing ? "发送中…" : "发送测试消息"}
        </Button>
      </div>
    </div>
  );
}
