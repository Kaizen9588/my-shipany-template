import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 0037 用户画像采集：UA 解析 / 国家码格式化 / 采集头的信任边界
 */

describe("parseUserAgent", () => {
  // 每用例单独 import，避免模块缓存串扰
  async function parse(ua: string): Promise<string> {
    const mod = await import("@/lib/user-env");
    return mod.parseUserAgent(ua);
  }

  it("Mac 桌面浏览器 → 电脑 · macOS", async () => {
    expect(
      await parse(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
      )
    ).toBe("电脑 · macOS");
  });

  it("Windows → 电脑 · Windows", async () => {
    expect(
      await parse(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
      )
    ).toBe("电脑 · Windows");
  });

  it("iPhone → 手机 · iOS", async () => {
    expect(
      await parse(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
      )
    ).toBe("手机 · iOS");
  });

  it("iPad → 平板 · iPadOS", async () => {
    expect(
      await parse(
        "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"
      )
    ).toBe("平板 · iPadOS");
  });

  it("Android 手机与平板区分（Mobile 关键字）", async () => {
    expect(
      await parse(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36"
      )
    ).toBe("手机 · Android");
    expect(
      await parse(
        "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
      )
    ).toBe("平板 · Android");
  });

  it("脚本/爬虫 UA → 程序", async () => {
    expect(await parse("curl/8.4.0")).toBe("程序");
    expect(await parse("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("程序");
  });

  it("空 UA → 未知", async () => {
    expect(await parse("")).toBe("未知");
  });
});

describe("formatCountry", () => {
  async function fmt(code: string): Promise<string> {
    const mod = await import("@/lib/user-env");
    return mod.formatCountry(code);
  }

  it("合法国家码带中文名（ES · 西班牙）", async () => {
    const out = await fmt("es");
    expect(out).toContain("ES");
    expect(out).toContain("西班牙");
  });

  it("非法/缺失码 → 未知", async () => {
    expect(await fmt("")).toBe("未知");
    expect(await fmt("E")).toBe("未知");
    expect(await fmt("XYZ")).toBe("未知");
  });
});

describe("getLoginEnv 国家头信任边界", () => {
  const headersMock = vi.hoisted(() => ({
    get: vi.fn<(name: string) => string | null>(),
  }));

  vi.mock("next/headers", () => ({
    headers: vi.fn(async () => headersMock),
  }));

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("TRUSTED_PROXY=vercel 只信 x-vercel-ip-country", async () => {
    vi.stubEnv("TRUSTED_PROXY", "vercel");
    headersMock.get.mockImplementation((name: string) =>
      name === "user-agent"
        ? "Mozilla/5.0 (Macintosh) Chrome/126.0"
        : name === "x-vercel-ip-country"
          ? "ES"
          : name === "cf-ipcountry"
            ? "US"
            : null
    );
    const { getLoginEnv } = await import("@/lib/user-env");
    const env = await getLoginEnv();
    expect(env.country).toBe("ES");
    expect(env.device).toBe("电脑 · macOS");
  });

  it("TRUSTED_PROXY=cloudflare 只信 cf-ipcountry", async () => {
    vi.stubEnv("TRUSTED_PROXY", "cloudflare");
    headersMock.get.mockImplementation((name: string) =>
      name === "user-agent" ? "curl/8.4.0" : name === "cf-ipcountry" ? "JP" : null
    );
    const { getLoginEnv } = await import("@/lib/user-env");
    const env = await getLoginEnv();
    expect(env.country).toBe("JP");
    expect(env.device).toBe("程序");
  });

  it("默认 none 不信任任何可伪造国别头", async () => {
    vi.stubEnv("TRUSTED_PROXY", "none");
    headersMock.get.mockImplementation((name: string) =>
      name === "user-agent"
        ? "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0"
        : name === "x-vercel-ip-country"
          ? "US"
          : name === "cf-ipcountry"
            ? "US"
            : null
    );
    const { getLoginEnv } = await import("@/lib/user-env");
    const env = await getLoginEnv();
    expect(env.country).toBe("");
    expect(env.device).toBe("电脑 · Windows");
  });

  it("CF 占位码（Tor/未知）视为未知", async () => {
    vi.stubEnv("TRUSTED_PROXY", "cloudflare");
    headersMock.get.mockImplementation((name: string) =>
      name === "user-agent" ? "curl/8.4.0" : name === "cf-ipcountry" ? "T1" : null
    );
    const { getLoginEnv } = await import("@/lib/user-env");
    const env = await getLoginEnv();
    expect(env.country).toBe("");
  });
});
