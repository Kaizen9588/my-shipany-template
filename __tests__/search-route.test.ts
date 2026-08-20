import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("@/models/db", () => ({ getSupabaseClient: vi.fn() }));
import { getSupabaseClient } from "@/models/db";
import { GET } from "@/app/api/search/route";

const mockGetClient = getSupabaseClient as unknown as ReturnType<typeof vi.fn>;

function makeQuery() {
  const captured: Record<string, unknown> = {};
  let orCalls: string[] = [];
  const resolver = Promise.resolve({ data: [], error: null });
  const chain: any = {
    eq: (f: string, v: unknown) => { captured[f] = v; return chain; },
    or: (f: string) => { orCalls.push(f); return chain; },
    order: () => chain,
    limit: () => chain,
    then: (res: (v: unknown) => unknown) => resolver.then(res),
  };
  const select = vi.fn().mockReturnValue(chain);
  chain.select = select;
  mockGetClient.mockReturnValue({ from: vi.fn().mockReturnValue({ select }) });
  return { captured, orCalls };
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/search", () => {
  it("博客搜索按 online 状态过滤（posts 使用 online 而非 published），且 or 注入被剥离", async () => {
    const { captured, orCalls } = makeQuery();
    const req = new Request(
      "http://localhost/api/search?q=usage%3B%2C%28credits&locale=en"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(captured.status).toBe("online");
    expect(captured.locale).toBe("en");
    expect(orCalls.length).toBe(1);
    // or() 的逗号分隔符是合法的；断言每个值段内不含攻击者注入的括号/逗号
    const segments = orCalls[0].split(",");
    expect(segments.length).toBe(3);
    for (const seg of segments) {
      expect(seg).not.toContain("(");
      expect(seg).not.toContain(")");
      expect(seg).not.toContain("%,");
    }
  });

  it("空 q 直接返回空数组，不触达数据库", async () => {
    const req = new Request("http://localhost/api/search?q=");
    const res = await GET(req);
    expect(await res.json()).toEqual({ code: 0, message: "ok", data: { posts: [] } });
    expect(mockGetClient).not.toHaveBeenCalled();
  });
});
