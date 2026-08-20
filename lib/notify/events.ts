/**
 * 告警通知事件清单（纯常量/类型，可安全被客户端组件引用）。
 * docs/16-observability-alerting.md §5.4 的 v1 事件 + 已接入的支付健康事件。
 */

export const SEVERITY_ORDER = ["info", "warn", "error", "critical"] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

export type NotifyEventRule = {
  enabled: boolean;
  severity: Severity;
};

export interface NotifyEventDefinition {
  eventType: string;
  label: string;
  description: string;
  defaultSeverity: Severity;
  /** 当前模板里的接入状态：已接入 / 仅日志（事件落库但不推送）/ 预留（后续接入） */
  status: "已接入" | "仅日志" | "预留";
}

export const NOTIFY_EVENTS: NotifyEventDefinition[] = [
  {
    eventType: "payment.provider_unhealthy",
    label: "支付渠道自动摘除",
    description: "连续 5 次失败被标记 unhealthy（30 分钟），路由自动切换",
    defaultSeverity: "critical",
    status: "已接入",
  },
  {
    eventType: "payment.provider_failure",
    label: "支付渠道单次失败",
    description: "同一渠道 checkout 调用失败（用于尽早发现渠道波动）",
    defaultSeverity: "warn",
    status: "仅日志",
  },
  {
    eventType: "payment.amount_mismatch",
    label: "支付金额/币种不匹配",
    description: "实付金额与本地订单不一致，疑似攻击或调价未同步",
    defaultSeverity: "critical",
    status: "已接入",
  },
  {
    eventType: "payment.webhook_invalid_signature",
    label: "Webhook 签名校验失败",
    description: "收到签名无效的 webhook 请求，疑似伪造/配置错误",
    defaultSeverity: "critical",
    status: "已接入",
  },
  {
    eventType: "payment.refund_processed",
    label: "退款已处理",
    description: "退款成功并已扣回积分（资金流出，管理员须知）",
    defaultSeverity: "warn",
    status: "已接入",
  },
  {
    eventType: "payment.provider_recovered",
    label: "支付渠道恢复",
    description: "渠道健康检测判定失败后恢复可用",
    defaultSeverity: "info",
    status: "已接入",
  },
  {
    eventType: "system.env_or_migration_failed",
    label: "启动/迁移失败",
    description: "环境变量或数据库迁移失败，服务可能无法正常启动",
    defaultSeverity: "critical",
    status: "预留",
  },
  {
    eventType: "auth.login_failed_burst",
    label: "登录失败激增",
    description: "短时间内多次登录失败，疑似撞库/爆破",
    defaultSeverity: "warn",
    status: "预留",
  },
];
