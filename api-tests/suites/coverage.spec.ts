/**
 * 覆盖防倒退守卫：app/api 下每个 route.ts 的「方法+路径」必须出现在登记表里。
 *
 * 作用：新增接口不写 API 测试 → 本文件直接红，CI 挡下。
 * 更新方式：跑 `pnpm api-test:routes` 生成最新清单，把缺失项补进 suites 后登记。
 *
 * 登记表是权威清单：删除接口时同步移除条目；改名视为删+增。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

const ROOT = join(__dirname, "..", "..", "app", "api");

/** 递归收集所有 route.ts → "METHOD /api/..." 条目（方法从源码提取） */
function collectRoutes(): string[] {
  const entries: string[] = [];

  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (name === "route.ts") {
        const rel = p.slice(ROOT.length).replace(/\/route\.ts$/, "");
        const apiPath = `/api${rel.replace(/\[\.\.\.([^\]]+)\]/, "*$1")}`;
        const src = readFileSync(p, "utf8");
        // Next.js route 导出：export async function GET/POST/...（或 export const { GET, POST } = handlers）
        const methods = [
          ...src.matchAll(
            /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g
          ),
        ].map((m) => m[1]);
        const constExports = [
          ...src.matchAll(
            /export\s+const\s*\{([^}]*)\}\s*=\s*handlers\s*;?/g
          ),
        ];
        for (const c of constExports) {
          for (const m of c[1].matchAll(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
            if (!methods.includes(m[1])) methods.push(m[1]);
          }
        }
        if (methods.length === 0) {
          entries.push(`?? ${apiPath}`); // 无法解析方法 → 强制人工确认
        }
        for (const m of methods) entries.push(`${m} ${apiPath}`);
      }
    }
  }
  walk(ROOT);
  return entries.sort();
}

/** 已覆盖登记表：每行 "METHOD /api/path"（相对 app/api 解析的路径） */
const COVERED: string[] = [
  // ---- public（suites/public.spec.ts）----
  "GET /api/health",
  "POST /api/ping",
  "GET /api/search",
  "POST /api/get-user-info",
  "GET /api/metrics",
  "GET /api/metrics/events",
  "POST /api/send-verification",
  "POST /api/verify-code",
  "GET /api/payment-methods",
  // ---- auth（suites/auth.spec.ts）----
  "GET /api/auth/*nextauth",
  "POST /api/auth/*nextauth",
  // ---- user（suites/user.spec.ts）----
  "PUT /api/user/profile",
  "POST /api/user/change-password",
  "POST /api/user/delete-account",
  "POST /api/user/avatar",
  "GET /api/notifications",
  "POST /api/notifications/read",
  "POST /api/update-invite",
  "POST /api/update-invite-code",
  // ---- v1（suites/v1.spec.ts）----
  "POST /api/v1/ai/demo",
  "POST /api/v1/ai/generate",
  "GET /api/v1/ai/generate",
  // ---- admin（suites/admin.spec.ts）----
  "GET /api/admin/stats",
  "GET /api/admin/approvals",
  "POST /api/admin/approvals",
  "PUT /api/admin/user",
  "POST /api/admin/user/credits",
  "POST /api/admin/refund",
  "POST /api/admin/debt-settle",
  "GET /api/admin/notify-settings",
  "PUT /api/admin/notify-settings",
  "POST /api/admin/notify-settings",
  "GET /api/admin/op-events",
  "GET /api/admin/payment-products",
  "PUT /api/admin/payment-products",
  "GET /api/admin/payment-settings",
  "PUT /api/admin/payment-settings",
  // ---- payment（suites/payment.spec.ts）----
  "POST /api/checkout",
  "POST /api/stripe-notify",
  "POST /api/creem-notify",
  "POST /api/waffo-notify",
  // ---- cron（suites/cron.spec.ts）----
  "GET /api/cron/daily",
];

test("API 覆盖防倒退：app/api 全部路由已登记", () => {
  const actual = collectRoutes();
  const coveredSet = new Set(COVERED);
  const missing = actual.filter((r) => !coveredSet.has(r));
  const stale = COVERED.filter((c) => !actual.includes(c));

  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(
      `以下路由未登记 API 测试（新增接口必须补 suites/ 并登记到 coverage.spec.ts）:\n  ` +
        missing.join("\n  ")
    );
  }
  if (stale.length > 0) {
    problems.push(
      `登记表中存在已不存在的路由（接口已删/改名，请同步清理）:\n  ` +
        stale.join("\n  ")
    );
  }
  expect(problems, problems.join("\n\n")).toEqual([]);
});
