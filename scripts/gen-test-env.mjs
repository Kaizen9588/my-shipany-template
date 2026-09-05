/**
 * CI 测试环境生成：scripts/gen-test-env.mjs [api|e2e|all]
 *
 * 本地开发用手工维护的 .env.api-test / .env.e2e-test（gitignore，严禁提交）。
 * CI 里没有这两个文件——本地 Supabase 栈（supabase start）的 anon/service key
 * 是公开固定值，用 `supabase status -o env` 运行时取回并映射成应用 env；
 * 其余测试凭据（AUTH_SECRET/webhook 验签/CRON 等）按次随机生成——
 * 测试自己签自己验，随机值即可；管理员种子用代码内置默认值保持一致。
 *
 * 不落任何真实密钥；生成物只在 CI job 生命周期内存活。
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2] || "all";

function statusMap() {
  const out = execSync("npx --yes supabase@2.116.0 status -o env", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const map = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) {
      map[m[1]] = m[2];
    }
  }
  if (!map.API_URL || !map.ANON_KEY || !map.SERVICE_ROLE_KEY || !map.DB_URL) {
    throw new Error("supabase status missing required keys");
  }
  return {
    SUPABASE_URL: map.API_URL,
    SUPABASE_ANON_KEY: map.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: map.SERVICE_ROLE_KEY,
    DATABASE_URL: map.DB_URL,
  };
}

function hex(n) {
  return randomBytes(n).toString("hex");
}

const shared = {
  NODE_ENV: "development",
  AUTH_TRUST_HOST: "true",
  ANONYMOUS_DAILY_LIMIT: "3",
  DEMO_FAILURE_DAILY_LIMIT: "10",
  DEMO_RATELIMIT_PER_MIN: "30",
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
  // 支付/邮件/存储全部留空 ⇒ checkout 走 no payment provider 分支、
  // 验证码走响应体降级通道（E2E 注册链路依赖）
};

const apiTest = {
  NEXT_PUBLIC_PROJECT_NAME: "api-test",
  NEXT_PUBLIC_WEB_URL: "http://localhost:3100",
  NEXT_PUBLIC_LOCALE_DETECTION: "en",
  ADMIN_BOOTSTRAP_EMAIL: "api-admin@test.local",
  ADMIN_BOOTSTRAP_PASSWORD: "ApiTestAdmin123",
  // webhook/密钥测试夹具值：api-tests/suites 里预计算签名硬编码了这些常量，
  // 必须与 .env.api-test 的本地 dummy 值一致（非真实凭据）
  STRIPE_WEBHOOK_SECRET: "whsec_api_test_only",
  STRIPE_PRIVATE_KEY: "sk_test_dummy_local_only",
  CREEM_WEBHOOK_SECRET: "creem_api_test_secret",
  METRICS_ACCESS_SECRET: "metrics_api_test_secret",
  CRON_SECRET: "cron_api_test_secret",
  AUTH_SECRET: hex(32),
};

const e2eTest = {
  NEXT_PUBLIC_PROJECT_NAME: "e2e-test",
  NEXT_PUBLIC_WEB_URL: "http://localhost:3101",
  NEXT_PUBLIC_LOCALE_DETECTION: "false",
  AUTH_SECRET: hex(32),
  CRON_SECRET: "cron_api_test_secret",
  METRICS_ACCESS_SECRET: "metrics_api_test_secret",
  // bootstrap 管理员种子：e2e fixtures 默认值与 pnpm migrate 的
  // bootstrap-admin 建号共用（e2e 无 globalSetup，靠 migrate 建号）
  ADMIN_BOOTSTRAP_EMAIL: "api-admin@test.local",
  ADMIN_BOOTSTRAP_PASSWORD: "ApiTestAdmin123",
};

function render(vars) {
  return Object.entries(vars)
    .map(([k, v]) => `${k} = "${v}"`)
    .join("\n");
}

function writeEnv(file, vars, header) {
  const supa = statusMap();
  writeFileSync(file, `# CI generated (scripts/gen-test-env.mjs) — ${header}\n\n${render({ ...vars, ...supa })}\n`);
  console.log(`[gen-test-env] wrote ${file}`);
}

const jobs = [];
if (target === "all" || target === "api") {
  jobs.push([
    ".env.api-test",
    { ...shared, ...apiTest },
    "API 测试（端口 3100，连本地 Supabase 栈）",
  ]);
}
if (target === "all" || target === "e2e") {
  jobs.push([
    ".env.e2e-test",
    { ...shared, ...e2eTest },
    "E2E 测试（端口 3101，连同一个本地 Supabase 栈）",
  ]);
}

// 本地已有手工维护文件时不覆盖（只在 CI 缺文件时生成）
for (const [file, vars, header] of jobs) {
  if (existsSync(file) && process.env.CI !== "true") {
    console.log(`[gen-test-env] ${file} already exists locally, skip (CI only)`);
    continue;
  }
  writeEnv(file, vars, header);
}

// CI：把 supabase 连接变量追加到 $GITHUB_ENV，供后续步骤（如 e2e job 的
// pnpm migrate——e2e 无 globalSetup，必须在 webServer 起来前建表）直接使用
if (process.env.GITHUB_ENV) {
  const supa = statusMap();
  const block = Object.entries(supa)
    .map(([k, v]) => `${k}<<GEN_TEST_ENV_EOF\n${v}\nGEN_TEST_ENV_EOF`)
    .join("\n");
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_ENV, `\n${block}\n`);
  console.log("[gen-test-env] exported supabase vars to $GITHUB_ENV");
}
