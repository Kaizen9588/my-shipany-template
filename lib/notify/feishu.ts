import { createHmac } from "node:crypto";
import { Notifier, NotifyMessage } from "./types";
import { NotifyConfig } from "@/models/notify";

/**
 * 飞书自定义机器人（docs/16-observability-alerting.md §5.2）
 * POST https://open.feishu.cn/open-apis/bot/v2/hook/{token}
 * 支持可选 HMAC-SHA256 签名（群设置开启「签名校验」时配置 feishuSecret）。
 */
export class FeishuNotifier implements Notifier {
  id = "feishu" as const;
  constructor(private config: NotifyConfig) {}

  isConfigured(): boolean {
    return !!this.config.feishuWebhookUrl;
  }

  async send(message: NotifyMessage): Promise<void> {
    const payload: Record<string, unknown> = {
      msg_type: "interactive",
      card: {
        header: {
          title: { tag: "plain_text", content: message.title },
          template: message.severity === "critical" ? "red" : "orange",
        },
        elements: [
          { tag: "div", text: { tag: "lark_md", content: message.body } },
        ],
      },
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.feishuSecret) {
      // 飞书签名校验：timestamp\nsecret 的 HMAC-SHA256
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const sign = createHmac("sha256", timestamp + "\n" + this.config.feishuSecret)
        .update("")
        .digest("base64");
      headers["X-Lark-Request-Timestamp"] = timestamp;
      headers["X-Lark-Request-Signature"] = sign;
      (payload as any).timestamp = timestamp;
      (payload as any).sign = sign;
    }

    const resp = await fetch(this.config.feishuWebhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    let json: Record<string, any> | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!resp.ok) {
      throw new Error(`feishu webhook failed: ${resp.status} ${resp.statusText}${json?.msg ? ` (msg: ${json.msg})` : ""}`);
    }
    if (json && json.code !== undefined && json.code !== 0) {
      throw new Error(`feishu webhook rejected: ${json.msg || JSON.stringify(json)}`);
    }
  }
}
