import { getSupabaseClient } from "@/models/db";
import {
  NOTIFY_EVENTS,
  SEVERITY_ORDER,
  type NotifyEventRule,
  type Severity,
} from "@/lib/notify/events";

export { NOTIFY_EVENTS, SEVERITY_ORDER };
export type { NotifyEventRule, Severity };

/**
 * 通知配置模型（后台 /admin/notify 热更新）
 *
 * 优先级：数据库 system_settings 为主；值为空时回退环境变量，
 * 这样既支持“后台免部署配置”，也兼容旧的环境变量部署方式。
 */
export interface NotifyConfig {
  feishuWebhookUrl: string;
  feishuSecret: string;
  wecomWebhookUrl: string;
  notifyMinSeverity: "info" | "warn" | "error" | "critical";
}

export async function getSystemSetting(key: string): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.error(`[notify] getSystemSetting(${key}) failed:`, error.message);
    return "";
  }
  return data?.value || "";
}

export async function setSystemSetting(key: string, value: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("system_settings")
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) {
    throw error;
  }
}

function normalizeSeverity(v: string | undefined): Severity {
  return SEVERITY_ORDER.includes(v as Severity) ? (v as Severity) : "warn";
}

export async function getNotifyConfig(): Promise<NotifyConfig> {
  const [feishuWebhookUrl, feishuSecret, wecomWebhookUrl, minSeverity] =
    await Promise.all([
      getSystemSetting("feishu_webhook_url"),
      getSystemSetting("feishu_secret"),
      getSystemSetting("wecom_webhook_url"),
      getSystemSetting("notify_min_severity"),
    ]);

  return {
    feishuWebhookUrl:
      feishuWebhookUrl || process.env.FEISHU_WEBHOOK_URL || "",
    feishuSecret: feishuSecret || process.env.FEISHU_SECRET || "",
    wecomWebhookUrl:
      wecomWebhookUrl || process.env.WECOM_WEBHOOK_URL || "",
    notifyMinSeverity: normalizeSeverity(
      minSeverity || process.env.NOTIFY_MIN_SEVERITY
    ),
  };
}

// ---- N-1：密钥脱敏出口 ----

/**
 * 对外展示视图：只含「是否已配置」和末四位掩码，绝不回显原文。
 * webhook URL 本身内嵌机器人 token，与 secret 同级对待。
 */
export interface NotifySecretView {
  set: boolean;
  masked: string;
}

function toSecretView(value: string): NotifySecretView {
  const v = (value || "").trim();
  return {
    set: v.length > 0,
    masked: v.length > 0 ? `****${v.slice(-4)}` : "",
  };
}

/** GET /api/admin/notify-settings 与后台页面的统一脱敏出口 */
export function toNotifyConfigView(config: NotifyConfig): {
  feishuWebhookUrlSet: boolean;
  feishuWebhookUrlMasked: string;
  feishuSecretSet: boolean;
  feishuSecretMasked: string;
  wecomWebhookUrlSet: boolean;
  wecomWebhookUrlMasked: string;
  notifyMinSeverity: NotifyConfig["notifyMinSeverity"];
} {
  const feishuUrl = toSecretView(config.feishuWebhookUrl);
  const feishuSecret = toSecretView(config.feishuSecret);
  const wecomUrl = toSecretView(config.wecomWebhookUrl);
  return {
    feishuWebhookUrlSet: feishuUrl.set,
    feishuWebhookUrlMasked: feishuUrl.masked,
    feishuSecretSet: feishuSecret.set,
    feishuSecretMasked: feishuSecret.masked,
    wecomWebhookUrlSet: wecomUrl.set,
    wecomWebhookUrlMasked: wecomUrl.masked,
    notifyMinSeverity: config.notifyMinSeverity,
  };
}

// ---- 事件级通知规则（6.23：可配置哪些事件触发机器人告警） ----

const DEFAULT_RULES: Record<string, NotifyEventRule> = Object.fromEntries(
  NOTIFY_EVENTS.map((e) => [
    e.eventType,
    { enabled: true, severity: e.defaultSeverity },
  ])
);

/** 读取事件级通知规则（system_settings key=notify_event_rules，JSON） */
export async function getNotifyEventRules(): Promise<
  Record<string, NotifyEventRule>
> {
  const raw = await getSystemSetting("notify_event_rules");
  if (!raw) {
    return { ...DEFAULT_RULES };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<NotifyEventRule>>;
    const out: Record<string, NotifyEventRule> = {};

    for (const def of NOTIFY_EVENTS) {
      const item = parsed[def.eventType];
      out[def.eventType] = {
        enabled: typeof item?.enabled === "boolean" ? item.enabled : true,
        severity: SEVERITY_ORDER.includes((item?.severity || "") as Severity)
          ? (item.severity as Severity)
          : def.defaultSeverity,
      };
    }
    return out;
  } catch (e) {
    console.error("[notify] parse notify_event_rules failed:", e);
    return { ...DEFAULT_RULES };
  }
}

/** 保存事件级通知规则（以完整事件清单为准，缺失项用默认值补齐） */
export async function setNotifyEventRules(
  rules: Record<string, NotifyEventRule>
): Promise<void> {
  const merged: Record<string, NotifyEventRule> = {};
  for (const def of NOTIFY_EVENTS) {
    const r = rules[def.eventType];
    merged[def.eventType] = {
      enabled: typeof r?.enabled === "boolean" ? r.enabled : true,
      severity: SEVERITY_ORDER.includes((r?.severity || "") as Severity)
        ? (r.severity as Severity)
        : def.defaultSeverity,
    };
  }
  await setSystemSetting("notify_event_rules", JSON.stringify(merged));
}
