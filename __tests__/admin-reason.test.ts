import { describe, expect, it } from "vitest";

import { parseReason, REASON_MAX_LEN } from "@/lib/admin-reason";

describe("lib/admin-reason parseReason（N-6 强制理由）", () => {
  it("合法理由放行并 trim", () => {
    const r = parseReason("  客诉补偿，工单 #1234  ");
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("客诉补偿，工单 #1234");
  });

  it("非字符串与过短被拒绝", () => {
    expect(parseReason(undefined).ok).toBe(false);
    expect(parseReason(null).ok).toBe(false);
    expect(parseReason(123).ok).toBe(false);
    expect(parseReason("abc").ok).toBe(false);
  });

  it("超长被拒绝", () => {
    expect(parseReason("a".repeat(REASON_MAX_LEN + 1)).ok).toBe(false);
    expect(parseReason("a".repeat(REASON_MAX_LEN)).ok).toBe(true);
  });

  it("零宽字符不能绕过长度下限（审查修复回归：U+200B×5 必须拒绝）", () => {
    expect(parseReason("\u200B".repeat(5)).ok).toBe(false);
    expect(parseReason("\u200B\u200Babc\u200B").ok).toBe(false);
    // 合法内容中混入零宽字符：清洗后校验，落库存清洗后的可读理由
    const r = parseReason("客诉补\u200B偿，工单 #1234");
    expect(r.ok).toBe(true);
    expect(r.reason).not.toContain("\u200B");
  });

  it("纯空白与 BOM 清洗后为空被拒绝", () => {
    expect(parseReason("   \t\n  ").ok).toBe(false);
    expect(parseReason("\uFEFF\uFEFF\uFEFF").ok).toBe(false);
  });
});
