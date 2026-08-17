import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { fireAndForgetAudit } from "@/lib/audit";
import {
  getNotifyConfig,
  getNotifyEventRules,
  setNotifyEventRules,
  setSystemSetting,
} from "@/models/notify";
import { sendTestNotification } from "@/lib/notify";

const VALID_SEVERITIES = ["info", "warn", "error", "critical"];

/**
 * GET/PUT /api/admin/notify-settings —— 后台告警通知配置（飞书/企微）
 * POST ?action=test —— 发送一条测试告警
 */
export async function GET() {
  try {
    await requireAdmin();
    const [config, eventRules] = await Promise.all([
      getNotifyConfig(),
      getNotifyEventRules(),
    ]);
    return respData({ ...config, eventRules });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/notify-settings] GET failed:", e);
    return respErr("get notify settings failed");
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin("admin");
    const body = await req.json();
    const {
      feishuWebhookUrl = "",
      feishuSecret = "",
      wecomWebhookUrl = "",
      notifyMinSeverity = "warn",
      eventRules,
    } = body || {};

    if (!VALID_SEVERITIES.includes(notifyMinSeverity)) {
      return respErr("invalid severity");
    }

    await Promise.all([
      setSystemSetting("feishu_webhook_url", String(feishuWebhookUrl || "").trim()),
      setSystemSetting("feishu_secret", String(feishuSecret || "").trim()),
      setSystemSetting("wecom_webhook_url", String(wecomWebhookUrl || "").trim()),
      setSystemSetting("notify_min_severity", notifyMinSeverity),
    ]);

    if (eventRules && typeof eventRules === "object") {
      await setNotifyEventRules(eventRules);
    }

    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.notify_settings.update",
      target_type: "config",
      target_uuid: "",
      detail: JSON.stringify({
        feishu: !!feishuWebhookUrl,
        wecom: !!wecomWebhookUrl,
        notifyMinSeverity,
        eventRuleCount: eventRules ? Object.keys(eventRules).length : 0,
      }),
    });

    return respData({ updated: true });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/notify-settings] PUT failed:", e);
    return respErr("update notify settings failed");
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("admin");
    await sendTestNotification();
    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.notify_settings.test",
      target_type: "config",
      target_uuid: "",
      detail: "test alert",
    });
    return respData({ sent: true });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/notify-settings] test failed:", e);
    return respErr(e?.message || "send test notification failed", 400);
  }
}
