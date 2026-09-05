import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 配置（smoke + 全链路）
 *
 * - 独立端口 3101，加载 .env.e2e-test（本地 Supabase 栈 54321/54322），
 *   与 .env.local（云测试项目）完全隔离，不写线上/云上任何数据
 * - webServer 由 scripts/test-server.mjs 拉起：env 文件缺失直接拒绝启动
 * - reuseExistingServer=false：防止误连日常 dev server（那是 .env.local 环境）
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 全链路用例有顺序依赖（注册→登录→登出），单 worker 串行跑，避免限流误伤
  fullyParallel: false,
  workers: 1,
  // 复用 API 测试的汇总 reporter（同 schemaVersion 契约），输出到独立目录，
  // 供内网报告门户 e2e 类型消费；组名加 e2e: 前缀与 API 报告区分。
  // junit.xml 与 API 侧产物对齐（门户/第三方平台通用格式）。
  reporter: [
    ["list"],
    [
      "./api-tests/summary-reporter.ts",
      { outDir: "../e2e-report-output", groupPrefix: "e2e:" },
    ],
    ["junit", { outputFile: "e2e-report-output/junit.xml" }],
  ],
  use: {
    baseURL: "http://localhost:3101",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // dev 模式首次编译页面较慢
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/test-server.mjs .env.e2e-test 3101",
    url: "http://localhost:3101",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
