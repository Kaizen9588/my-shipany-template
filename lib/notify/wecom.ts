import { Notifier, NotifyMessage } from "./types";
import { NotifyConfig } from "@/models/notify";

/**
 * 企业微信机器人（docs/16-observability-alerting.md §5.2）
 * POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key={key}
 * 注意：企微 markdown 不支持标题红色，用 <font color="warning"> 高亮。
 */
export class WecomNotifier implements Notifier {
  id = "wecom" as const;
  constructor(private config: NotifyConfig) {}

  isConfigured(): boolean {
    return !!this.config.wecomWebhookUrl;
  }

  async send(message: NotifyMessage): Promise<void> {
    const color = message.severity === "critical" ? "warning" : "comment";
    const content = `## <font color="${color}">${message.title}</font>\n${message.body}`;

    const resp = await fetch(this.config.wecomWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { content } }),
    });
    const text = await resp.text();
    let json: Record<string, any> | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!resp.ok) {
      throw new Error(`wecom webhook failed: ${resp.status} ${resp.statusText}${json?.errmsg ? ` (msg: ${json.errmsg})` : ""}`);
    }
    if (json && json.errcode !== undefined && json.errcode !== 0) {
      throw new Error(`wecom webhook rejected: ${json.errmsg || JSON.stringify(json)}`);
    }
  }
}
