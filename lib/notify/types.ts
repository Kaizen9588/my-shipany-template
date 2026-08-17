import type { Severity } from "@/models/notify";

/**
 * Notifier 抽象（docs/16-observability-alerting.md §5）
 * - isConfigured()：webhook 未配置 -> false，静默跳过
 * - send()：fire-and-forget，单个渠道失败不影响其他
 */
export interface NotifyMessage {
  title: string; // 短标题（群列表预览）
  body: string; // markdown（飞书/企微都支持）
  severity: Severity;
  subject?: string; // 订单号/渠道 id，用于去重抑制
  eventType?: string; // 对应 NOTIFY_EVENTS 的 event_type，事件级开关/级别过滤用
}

export interface Notifier {
  id: "feishu" | "wecom" | "email";
  isConfigured(): boolean;
  send(message: NotifyMessage): Promise<void>;
}
