import { describe, expect, it } from "vitest";
import { rowsToCsv } from "@/lib/csv";

describe("lib/csv（6.8 订单导出）", () => {
  it("空数组返回空串", () => {
    expect(rowsToCsv([])).toBe("");
    expect(rowsToCsv([] as any)).toBe("");
  });

  it("普通行输出表头 + 数据", () => {
    const csv = rowsToCsv([
      { order_no: "1", amount: 100 },
      { order_no: "2", amount: 200 },
    ]);
    expect(csv.split("\n")).toEqual([
      "order_no,amount",
      "1,100",
      "2,200",
    ]);
  });

  it("含逗号/引号/换行的字段被正确转义", () => {
    const csv = rowsToCsv([
      { name: 'a,"b"', note: "line1\nline2" },
    ]);
    expect(csv).toContain('"a,""b"""');
    expect(csv).toContain('"line1\nline2"');
  });

  it("null / undefined 转为空串", () => {
    const csv = rowsToCsv([{ a: null, b: undefined, c: 1 }]);
    expect(csv).toContain(",,");
  });

  it("以 = + - @ tab 开头的值前置单引号（CSV 公式注入防护）", () => {
    const csv = rowsToCsv([
      { email: "=cmd|' /C calc'!A0", note: "+SUM(A1)", bal: "@x", neg: "-5" },
    ]);
    expect(csv).toContain("'=cmd|' /C calc'!A0");
    expect(csv).toContain("'+SUM(A1)");
    expect(csv).toContain("'@x");
    expect(csv).toContain("'-5");
  });

  it("正常字段不受影响", () => {
    const csv = rowsToCsv([{ email: "user@example.com", val: "USD" }]);
    expect(csv).not.toContain("'user");
    expect(csv).not.toContain("'USD");
  });
});
