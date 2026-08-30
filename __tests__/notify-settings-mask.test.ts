import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getNotifyConfig: vi.fn(),
  getNotifyEventRules: vi.fn(),
  setNotifyEventRules: vi.fn(),
  setSystemSetting: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/models/notify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/models/notify")>();
  return {
    ...actual,
    getNotifyConfig: mocks.getNotifyConfig,
    getNotifyEventRules: mocks.getNotifyEventRules,
    setNotifyEventRules: mocks.setNotifyEventRules,
    setSystemSetting: mocks.setSystemSetting,
  };
});
vi.mock("@/lib/audit", () => ({ fireAndForgetAudit: vi.fn() }));
vi.mock("@/lib/notify", () => ({ sendTestNotification: vi.fn() }));

import { GET, PUT } from "@/app/api/admin/notify-settings/route";
import { toNotifyConfigView } from "@/models/notify";

const fullConfig = {
  feishuWebhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/abc123-xyz9",
  feishuSecret: "topsecretvalue-77ab",
  wecomWebhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=kkkk-9999",
  notifyMinSeverity: "warn" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ uuid: "admin-1" });
  mocks.getNotifyConfig.mockResolvedValue(fullConfig);
  mocks.getNotifyEventRules.mockResolvedValue({});
  mocks.setSystemSetting.mockResolvedValue(undefined);
});

describe("N-1：notify-settings API 密钥脱敏出口", () => {
  it("toNotifyConfigView 只含 set 标志与末四位掩码，不含任何原文", () => {
    const view = toNotifyConfigView(fullConfig);

    expect(view.feishuWebhookUrlSet).toBe(true);
    expect(view.feishuWebhookUrlMasked).toBe("****xyz9");
    expect(view.feishuSecretSet).toBe(true);
    expect(view.feishuSecretMasked).toBe("****77ab");
    expect(view.wecomWebhookUrlSet).toBe(true);
    expect(view.wecomWebhookUrlMasked).toBe("****9999");

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("abc123-xyz9");
    expect(serialized).not.toContain("topsecretvalue");
    expect(serialized).not.toContain("kkkk-9999");
  });

  it("GET 不回显 webhook URL / secret 原文", async () => {
    const resp = await GET();
    const body = await resp.json();

    expect(body.code).toBe(0);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("abc123-xyz9");
    expect(serialized).not.toContain("topsecretvalue");
    expect(serialized).not.toContain("kkkk-9999");
    expect(body.data.feishuSecretSet).toBe(true);
    expect(body.data.feishuSecretMasked).toBe("****77ab");
  });

  it("PUT 留空表示保留现值，不覆盖已配置的密钥", async () => {
    const req = new Request("http://localhost/api/admin/notify-settings", {
      method: "PUT",
      body: JSON.stringify({
        notifyMinSeverity: "error",
        eventRules: {},
        reason: "调整告警最低级别，值班复核通过",
      }),
    });
    const resp = await PUT(req);
    const body = await resp.json();

    expect(body.code).toBe(0);
    const keys = mocks.setSystemSetting.mock.calls.map((c) => c[0]);
    expect(keys).toContain("notify_min_severity");
    expect(keys).not.toContain("feishu_webhook_url");
    expect(keys).not.toContain("feishu_secret");
    expect(keys).not.toContain("wecom_webhook_url");
  });

  it("PUT 提交新值时写入，掩码占位串被忽略", async () => {
    const req = new Request("http://localhost/api/admin/notify-settings", {
      method: "PUT",
      body: JSON.stringify({
        feishuWebhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/new-url",
        feishuSecret: "****77ab",
        notifyMinSeverity: "warn",
        reason: "更换飞书机器人地址，旧 webhook 轮换",
      }),
    });
    const resp = await PUT(req);
    expect((await resp.json()).code).toBe(0);

    const calls = Object.fromEntries(
      mocks.setSystemSetting.mock.calls.map((c) => [c[0], c[1]])
    );
    expect(calls["feishu_webhook_url"]).toBe(
      "https://open.feishu.cn/open-apis/bot/v2/hook/new-url"
    );
    // 掩码占位串不是新密钥，不得覆盖现值
    expect(calls["feishu_secret"]).toBeUndefined();
  });

  it("PUT 显式 null 清空对应配置", async () => {
    const req = new Request("http://localhost/api/admin/notify-settings", {
      method: "PUT",
      body: JSON.stringify({
        feishuSecret: null,
        notifyMinSeverity: "warn",
        reason: "轮换泄露风险的飞书签名密钥",
      }),
    });
    const resp = await PUT(req);
    expect((await resp.json()).code).toBe(0);

    const calls = Object.fromEntries(
      mocks.setSystemSetting.mock.calls.map((c) => [c[0], c[1]])
    );
    expect(calls["feishu_secret"]).toBe("");
  });
});
