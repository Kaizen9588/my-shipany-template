import { defineConfig, devices } from "@playwright/test";

/**
 * API 接口测试配置（独立于 e2e/ 浏览器测试）
 *
 * - 端口 3100：与日常 dev(3000)/e2e 隔离，env 走 .env.api-test（本地 Supabase 栈）
 * - globalSetup：truncate + seed（干净库起步，e2e-cleanup 从必需品降级为保险丝）
 * - workers=1：内存限流/登录锁定是进程级单例，串行避免互相污染（与 e2e 同策略）
 * - 报告：list（控制台）+ json（供自定义汇总 reporter 消化）+ junit（CI 消化）
 *
 * 运行：pnpm api-test（见 package.json）
 */
export default defineConfig({
  testDir: "./api-tests/suites",
  globalSetup: "./api-tests/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "api-tests/output/results.json" }],
    ["junit", { outputFile: "api-tests/output/junit.xml" }],
    ["./api-tests/summary-reporter.ts"],
  ],
  outputDir: "api-tests/output/artifacts",
  use: {
    baseURL: "http://localhost:3100",
    screenshot: "off",
    trace: "off",
    extraHTTPHeaders: {
      // middleware 的 Origin 校验仅拦"带 Origin 头"的请求（无 Origin 放行）；
      // 显式带同源 Origin 更贴近浏览器真实行为，也让 Origin 伪造用例可测
      Origin: "http://localhost:3100",
    },
  },
  projects: [{ name: "api", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm api-test:server",
    url: "http://localhost:3100/api/health",
    reuseExistingServer: false, // API 测试必须独占环境（限流状态干净）
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
