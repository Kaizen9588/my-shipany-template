import { test as base, expect, Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E 公共设施：种子账号、登录态复用、通用交互助手。
 *
 * 账号来源与 API 测试同源（api-tests/db-lifecycle.ts + 迁移 0027/0012）：
 * - seed-user@test.local / SeedUser123456：普通用户（db-lifecycle 种入，active）
 * - bootstrap 管理员（.env.api-test 的 ADMIN_BOOTSTRAP_*，migrate 时创建，
 *   pending_activation + must_change_password）：
 *   首次登录会跳 /change-password，改密成功后才 active。
 *   fixtures 里自动完成激活（幂等：激活后 currentPassword 变了，
 *   重跑时登录用旧密码会失败 → 此时换「旧密码+New」重试一次）。
 * 注意：.env.e2e-test 不配 ADMIN_BOOTSTRAP_*，测试 server 起来不会重复创建该账号。
 */

function loadEnvFile(f: string): void {
  const p = resolve(process.cwd(), f);
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile(".env.api-test"); // 只为补 ADMIN_BOOTSTRAP_* 凭据；.env.e2e-test 由 webServer 加载

/** 种子账号（与 api-tests/db-lifecycle.ts / .env.api-test 同源） */
export const SEED = {
  userEmail: "seed-user@test.local",
  userPassword: "SeedUser123456",
  adminEmail: process.env.ADMIN_BOOTSTRAP_EMAIL || "api-admin@test.local",
  adminBasePassword: process.env.ADMIN_BOOTSTRAP_PASSWORD || "ApiTestAdmin123",
} as const;

const ADMIN_ACTIVATED_PASSWORD = SEED.adminBasePassword + "New";
const ADMIN_STATE_FILE = "e2e/.admin-state.json";

/**
 * API 层登录（CSRF → credentials callback）。
 * cookie 由 request fixture 的 cookie 罐持有，页面导航即带登录态。
 */
async function apiLogin(
  request: Page["context"] extends never ? never : any,
  email: string,
  password: string
): Promise<void> {
  const csrfRes = await request.get("/api/auth/csrf");
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const res = await request.post("/api/auth/callback/credentials", {
    form: { csrfToken, email, password, callbackUrl: "http://localhost:3101/" },
    maxRedirects: 0,
  });
  const location = res.headers()["location"] || "";
  if (location.includes("error=")) {
    throw new Error(`login failed for ${email}: ${location}`);
  }
}

/**
 * 激活 bootstrap 管理员（幂等）：
 * - 未激活态：登录（临时密码）→ 改密为 ADMIN_ACTIVATED_PASSWORD → must_change_password 清除
 * - 已激活态：临时密码登录失败 → 改用激活后的密码直接登录
 * 激活写库后跨用例/跨跑次持久（本地库），所以第二类是常态路径。
 * （api-test:db-reset 会重置回临时密码 + 未激活态，两个分支都会被真实覆盖。）
 */
async function ensureAdminSignedIn(page: Page): Promise<void> {
  const request = page.context().request;
  // 试激活后的密码（常态：之前跑过已激活）
  try {
    await apiLogin(request, SEED.adminEmail, ADMIN_ACTIVATED_PASSWORD);
    return;
  } catch {
    // 未激活 → 用临时密码登录并改密
  }
  await apiLogin(request, SEED.adminEmail, SEED.adminBasePassword);
  const res = await request.post("/api/user/change-password", {
    data: {
      currentPassword: SEED.adminBasePassword,
      newPassword: ADMIN_ACTIVATED_PASSWORD,
    },
  });
  const body = (await res.json().catch(() => ({}))) as {
    code?: number;
    message?: string;
  };
  if (body.code !== 0) {
    throw new Error(`admin activation failed: ${JSON.stringify(body)}`);
  }
}

/** 登录指定账号（写 context cookie 罐），供需要自定义账号的用例使用 */
export async function loginViaApi(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await apiLogin(page.context().request, email, password);
}

/** 关闭 cookie 同意横幅（每测试全新 context 必现；CI 水合慢时横幅晚于页面就绪挂载，
 * 必须等它出现再关，否则 no-op 后横幅稍后弹出会干扰后续 dialog 定位） */
export async function dismissCookieBanner(page: Page): Promise<void> {
  const banner = page.getByRole("dialog", { name: "We value your privacy" });
  await banner.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  if (await banner.count()) {
    await banner.getByRole("button", { name: "Accept All" }).click();
    await expect(banner).toBeHidden();
  }
}

type TestFixtures = {
  /** 已登录普通用户页面（seed-user；免每条用例重复登录） */
  signedInPage: Page;
  /** 已登录管理员页面（bootstrap 管理员，自动激活） */
  adminPage: Page;
};

export const test = base.extend<TestFixtures>({
  signedInPage: async ({ page }, use) => {
    await apiLogin(page.context().request, SEED.userEmail, SEED.userPassword);
    await use(page);
  },
  adminPage: async ({ page }, use) => {
    await ensureAdminSignedIn(page);
    await use(page);
  },
});

export { expect };
