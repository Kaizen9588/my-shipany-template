import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getNotifyConfig: vi.fn(),
  getNotifyEventRules: vi.fn(),
}));

vi.mock("@/models/notify", () => ({
  getNotifyConfig: mocks.getNotifyConfig,
  getNotifyEventRules: mocks.getNotifyEventRules,
}));

import { notifyChannel, sendTestNotification } from "@/lib/notify";

const baseConfig = {
  feishuWebhookUrl: "https://feishu.test/hook/xxx",
  feishuSecret: "",
  wecomWebhookUrl: "",
  notifyMinSeverity: "warn" as const,
};

const defaultRules: Record<string, { enabled: boolean; severity: any }> = {
  "payment.provider_unhealthy": { enabled: true, severity: "critical" },
  "payment.amount_mismatch": { enabled: true, severity: "critical" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getNotifyConfig.mockResolvedValue(baseConfig);
  mocks.getNotifyEventRules.mockResolvedValue({ ...defaultRules });
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ code: 0 }), { status: 200 })
  ) as unknown as typeof fetch;
});

describe("lib/notify（docs/16 §5 告警通知）", () => {
  it("未配置任何 Webhook 时测试发送明确报错", async () => {
    mocks.getNotifyConfig.mockResolvedValue({
      ...baseConfig,
      feishuWebhookUrl: "",
      wecomWebhookUrl: "",
    });
    await expect(sendTestNotification()).rejects.toThrow(/请先配置至少一个机器人 Webhook/);
  });

  it("事件级开关：关闭的事件即使达到全局级别也不会推送", async () => {
    mocks.getNotifyEventRules.mockResolvedValue({
      "payment.amount_mismatch": { enabled: false, severity: "critical" },
    });
    await notifyChannel({
      title: "金额不匹配",
      body: "test",
      severity: "critical",
      subject: "o1",
      eventType: "payment.amount_mismatch",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("全局最低级别过滤：低于配置级别不推送", async () => {
    mocks.getNotifyConfig.mockResolvedValue({
      ...baseConfig,
      notifyMinSeverity: "critical",
    });
    await notifyChannel({
      title: "warn",
      body: "test",
      severity: "warn",
      subject: "o2",
      eventType: "payment.provider_failure",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("事件级最低级别可单独收紧：低于事件级别不推送", async () => {
    mocks.getNotifyEventRules.mockResolvedValue({
      "payment.amount_mismatch": { enabled: true, severity: "critical" },
    });
    await notifyChannel({
      title: "warn不足",
      body: "test",
      severity: "warn",
      subject: "o3",
      eventType: "payment.amount_mismatch",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("正例：事件启用且满足级别时发送到已配置 Webhook", async () => {
    mocks.getNotifyEventRules.mockResolvedValue({
      "payment.amount_mismatch": { enabled: true, severity: "info" },
    });
    await notifyChannel({
      title: "金额不匹配",
      body: "test",
      severity: "warn",
      subject: `o4-${Date.now()}`, // 避免抑制冲突
      eventType: "payment.amount_mismatch",
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
