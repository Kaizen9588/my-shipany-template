import { describe, expect, it } from "vitest";
import { getTemplateSubject } from "@/emails";

describe("emails 模板主题（6.2）", () => {
  it("支持变量插值", () => {
    const subject = getTemplateSubject("welcome", { project: "MySaaS" });
    expect(subject).toContain("MySaaS");
  });

  it("payment_success 主题不含变量", () => {
    expect(getTemplateSubject("payment_success", {})).toBe("Payment received");
  });

  it("未知模板回退默认", () => {
    const subject = getTemplateSubject("unknown" as any, {});
    expect(subject).toBeTruthy();
  });
});
