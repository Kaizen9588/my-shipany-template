import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { parseReason } from "@/lib/admin-reason";
import { fireAndForgetAudit } from "@/lib/audit";
import {
  getNotifyConfig,
  getNotifyEventRules,
  setNotifyEventRules,
  setSystemSetting,
  toNotifyConfigView,
} from "@/models/notify";
import { sendTestNotification } from "@/lib/notify";

const VALID_SEVERITIES = ["info", "warn", "error", "critical"];

/**
 * GET/PUT /api/admin/notify-settings —— 后台告警通知配置（飞书/企微）
 * POST ?action=test —— 发送一条测试告警
 *
 * N-1：GET 只回「是否已配置 + 末四位掩码」，不回显 webhook URL / secret 原文
 * （会话、抓包、日志都可能泄露）。PUT 对这三个字段采用留空即保留现值的语义，
 * 显式传 null 才清空。
 */
export async function GET() {
  try {
    await requireAdmin();
    const [config, eventRules] = await Promise.all([
      getNotifyConfig(),
      getNotifyEventRules(),
    ]);
    return respData({ ...toNotifyConfigView(config), eventRules });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/notify-settings] GET failed:", e);
    return respErr("get notify settings failed");
  }
}

/** 三个敏感字段的保存语义：undefined / "" 保留现值，null 清空，其余为新值 */
function isSecretCleared(value: unknown): boolean {
  return value === null;
}

function newSecretValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (s === "" || s.startsWith("****")) return null; // 掩码占位串原样回传时忽略
  return s;
}

export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin("admin");
    const body = await req.json();
    const {
      feishuWebhookUrl,
      feishuSecret,
      wecomWebhookUrl,
      notifyMinSeverity = "warn",
      eventRules,
      reason,
    } = body || {};

    // N-6：告警通道/密钥变更影响生产告警可达性，必须带理由
    const parsed = parseReason(reason);
    if (!parsed.ok) {
      return respErr(`notify settings reason required: ${parsed.error}`);
    }

    if (!VALID_SEVERITIES.includes(notifyMinSeverity)) {
      return respErr("invalid severity");
    }

    const updates: Promise<void>[] = [
      setSystemSetting("notify_min_severity", notifyMinSeverity),
    ];
    const feishuUrl = newSecretValue(feishuWebhookUrl);
    const feishuSecretNew = newSecretValue(feishuSecret);
    const wecomUrl = newSecretValue(wecomWebhookUrl);
    if (feishuUrl !== null) {
      updates.push(setSystemSetting("feishu_webhook_url", feishuUrl));
    }
    if (feishuSecretNew !== null) {
      updates.push(setSystemSetting("feishu_secret", feishuSecretNew));
    }
    if (wecomUrl !== null) {
      updates.push(setSystemSetting("wecom_webhook_url", wecomUrl));
    }
    await Promise.all(updates);

    // 显式 null 才清空（留空是「不修改」，脱敏后 UI 不再持有原文）
    if (isSecretCleared(feishuWebhookUrl)) {
      await setSystemSetting("feishu_webhook_url", "");
    }
    if (isSecretCleared(feishuSecret)) {
      await setSystemSetting("feishu_secret", "");
    }
    if (isSecretCleared(wecomWebhookUrl)) {
      await setSystemSetting("wecom_webhook_url", "");
    }

    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.notify_settings.update",
      target_type: "config",
      target_uuid: "",
      detail: JSON.stringify({
        feishu: feishuUrl !== null || isSecretCleared(feishuWebhookUrl),
        wecom: wecomUrl !== null || isSecretCleared(wecomWebhookUrl),
        notifyMinSeverity,
        eventRuleCount: eventRules ? Object.keys(eventRules).length : 0,
        reason: parsed.reason,
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
