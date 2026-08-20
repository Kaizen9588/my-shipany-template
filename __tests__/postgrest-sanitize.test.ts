import { describe, expect, it } from "vitest";
import { safeLikeValue, likeFilter } from "@/lib/postgrest";

describe("lib/postgrest .or() 注入防护（docs/17 T1 修复）", () => {
  it("剥离 PostgREST 过滤语法分隔符", () => {
    expect(safeLikeValue("a,b(c)d\"e'f`g\\h")).toBe("a b c d e f g h");
  });

  it("剥离 ILIKE 通配符，避免一次匹配全表", () => {
    expect(safeLikeValue("50%_off")).toBe("50 off");
    expect(safeLikeValue("%")).toBe("");
  });

  it("保留字母/数字/点/空格等常见搜索词", () => {
    expect(safeLikeValue("Next.js AI SaaS 2024")).toBe("Next.js AI SaaS 2024");
  });

  it("likeFilter 清洗为空时返回空串", () => {
    expect(likeFilter("title", "%,( ")).toBe("");
  });

  it("likeFilter 产出 ilike 模式片段且不含原始注入字符", () => {
    const f = likeFilter("title", "a,b()");
    expect(f).toBe("title.ilike.%a b%");
    expect(f).not.toContain("(");
    expect(f).not.toContain(",");
  });
});
