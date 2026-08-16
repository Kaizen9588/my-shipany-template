import { describe, expect, it } from "vitest";
import { getNonceStr, getUniSeq } from "@/lib/hash";

describe("lib/hash 补充（getUniSeq / getNonceStr）", () => {
  it("getUniSeq 带前缀且唯一", () => {
    const a = getUniSeq("ord_");
    const b = getUniSeq("ord_");
    expect(a.startsWith("ord_")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("getUniSeq 无前缀时直接返回", () => {
    expect(getUniSeq()).toBeTruthy();
  });

  it("getNonceStr 指定长度且字符集正确", () => {
    const s = getNonceStr(16);
    expect(s).toMatch(/^[A-Za-z0-9]{16}$/);
  });

  it("getNonceStr 不同调用结果不同", () => {
    expect(getNonceStr(6)).not.toBe(getNonceStr(6));
  });
});
