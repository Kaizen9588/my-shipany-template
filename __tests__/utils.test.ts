import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("lib/utils cn", () => {
  it("合并类名", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("过滤假值", () => {
    expect(cn("a", false && "b", null, undefined, "c")).toBe("a c");
  });

  it("tailwind-merge 去重冲突类", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
