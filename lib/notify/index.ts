import {
  getNotifyConfig,
  getNotifyEventRules,
  type NotifyConfig,
  type NotifyEventRule,
} from "@/models/notify";
import { FeishuNotifier } from "./feishu";
import { WecomNotifier } from "./wecom";
import { Notifier, NotifyMessage } from "./types";

/**
 * 告警通知统一出口（docs/16-observability-alerting.md §5）
 * - severity 过滤（NOTIFY_MIN_SEVERITY / system_settings.notify_min_severity，默认 warn）
 * - 事件级开关与级别（system_settings.notify_event_rules）
 * - 抑制：同 eventType + subject + title 30 分钟只发一次（内存 Map，多实例升级 Redis）
 * - 遍历已配置的 notifier 并行 send，单渠道失败不影响其他
 */
const suppression = new Map<string, number>();
const SUPPRESS_MS = 30 * 60 * 1000;
const SEVERITY_ORDER = ["info", "warn", "error", "critical"] as const;

function severityRank(s: NotifyMessage["severity"]): number {
  return SEVERITY_ORDER.indexOf(s);
}

/** 事件是否允许推送：先按全局最低级别，再按事件级开关/级别 */
function shouldNotify(
  config: NotifyConfig,
  rules: Record<string, NotifyEventRule>,
  message: NotifyMessage
): boolean {
  if (severityRank(message.severity) < severityRank(config.notifyMinSeverity)) {
    return false;
  }
  const rule = message.eventType ? rules[message.eventType] : undefined;
  if (rule) {
    if (!rule.enabled) {
      return false;
    }
    if (severityRank(message.severity) < severityRank(rule.severity)) {
      return false;
    }
  }
  return true;
}

function buildNotifiers(
  config: NotifyConfig
): Array<Notifier> {
  return [
    new FeishuNotifier(config),
    new WecomNotifier(config),
  ].filter((n) => n.isConfigured());
}

export async function notifyChannel(message: NotifyMessage): Promise<void> {
  try {
    const [config, rules] = await Promise.all([
      getNotifyConfig(),
      getNotifyEventRules(),
    ]);

    if (!shouldNotify(config, rules, message)) {
      return; // 全局级别或事件级开关/级别不过，静默跳过
    }

    const key = `${message.eventType || ""}:${message.subject || ""}:${message.title}`;
    const now = Date.now();
    const last = suppression.get(key);
    if (last && now - last < SUPPRESS_MS) {
      return;
    }
    suppression.set(key, now);

    const notifiers = buildNotifiers(config);
    if (notifiers.length === 0) {
      return; // 业务链路静默跳过（未配置机器人不算错误）
    }

    await Promise.allSettled(
      notifiers.map((n) =>
        n.send(message).catch((e) => {
          console.error(`[notify] ${n.id} send failed:`, e);
        })
      )
    );
  } catch (e) {
    // 通知链路永远不阻塞业务
    console.error("[notify] notifyChannel failed:", e);
  }
}

/** 供后台“测试发送”使用：必须已配置至少一个 Webhook，否则明确报错 */
export async function sendTestNotification(): Promise<void> {
  const config = await getNotifyConfig();
  const notifiers = buildNotifiers(config);

  if (notifiers.length === 0) {
    throw new Error(
      "请先配置至少一个机器人 Webhook（飞书或企业微信）再发送测试消息"
    );
  }

  const message: NotifyMessage = {
    title: "✅ 通知测试（告警通道已配置）",
    body: "这是一条后台手动发送的测试消息。\n- 当前级别：`warn`",
    severity: "warn",
    subject: "test",
    eventType: "system.test_alert",
  };

  const results = await Promise.allSettled(
    notifiers.map((n) => n.send(message))
  );

  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => String(r.reason?.message || r.reason));

  if (errors.length > 0) {
    throw new Error(`测试消息发送失败：${errors.join("；")}`);
  }
}
