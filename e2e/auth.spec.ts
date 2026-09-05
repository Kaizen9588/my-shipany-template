import { test, expect, Page } from "@playwright/test";
import { dismissCookieBanner } from "./fixtures";

/**
 * 全链路：注册 → 登录 → 登出
 *
 * 依赖两个开发期设计（生产环境本文件不可用，门禁只跑 dev/独立测试库）：
 * 1. 未配置 RESEND_API_KEY 时 /api/send-verification 直接在响应里返回验证码
 * 2. 注册即送 10 积分（CreditsAmount.NewUserGet），登录后 /my-credits 可见
 *
 * 环境隔离约定：用例邮箱用时间戳命名，天然不重复、不受每邮箱冷却影响；
 * 但 send-verification 有每 IP 30 次/分钟限流（内存实现），反复重跑需重启 dev server。
 */

const password = "E2ePassw0rd123";
const email = `e2e-${Date.now()}@test.local`;

/** 登录后 header 里的用户头像（alt 为昵称 = 邮箱前缀，无 data-slot 可依赖） */
const avatar = (page: Page) => page.locator(`img[alt^="e2e-"]`);

/** 打开登录弹窗（landing header 的 Sign In 按钮） */
async function openSignModal(page: Page) {
  await page.goto("/");
  await dismissCookieBanner(page);
  await page.getByRole("button", { name: "Sign In" }).first().click();
  // 弹窗里的邮箱输入框（id=email，来自 EmailSignForm）
  await expect(page.locator("#email")).toBeVisible();
}

/** 弹窗内的提交按钮（Sign in 提交是 w-full，模式切换 tab 是 flex-1） */
function submitButton(page: Page, name: string | RegExp) {
  return page.locator("button.w-full", { hasText: name });
}

/** 用密码完成登录，断言弹窗关闭 + 头像出现 */
async function signInWithPassword(page: Page) {
  await openSignModal(page);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await submitButton(page, "Sign in").click();
  await expect(page.locator("#email")).toBeHidden({ timeout: 30_000 });
  await expect(avatar(page)).toBeVisible({ timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test("signup: send code -> verify -> auto sign-in, new user gets 10 credits", async ({
  page,
}) => {
  await openSignModal(page);

  // 切到注册模式
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.locator("#email").fill(email);
  await page.getByRole("button", { name: "Send Verification Code" }).click();

  // dev 模式验证码直接在接口响应里拿
  const codeResp = await page.waitForResponse(
    (resp) =>
      resp.url().includes("/api/send-verification") && resp.status() === 200
  );
  const { code: respCode, data } = await codeResp.json();
  expect(respCode).toBe(0);
  const verifyCode = data?.code as string;
  expect(verifyCode).toMatch(/^\d{6}$/);

  // 进入第二步：填验证码 + 密码
  await expect(page.locator("#code")).toBeVisible({ timeout: 15_000 });
  await page.locator("#code").fill(verifyCode);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /Verify & Create Account/ }).click();

  // verify-code 成功 → signIn → setShowSignModal(false) + router.push("/")，弹窗应消失
  await expect(page.locator("#email")).toBeHidden({ timeout: 30_000 });
  await expect(avatar(page)).toBeVisible({ timeout: 30_000 });
});

test("signout via avatar menu", async ({ page }) => {
  await signInWithPassword(page);

  // 登出：点头像 → Sign Out
  await avatar(page).click();
  await page.getByText("Sign Out").click();

  // 登出后 header 回到 Sign In 按钮
  await expect(
    page.getByRole("button", { name: "Sign In" }).first()
  ).toBeVisible({ timeout: 30_000 });
});

test("signed-in user sees My Credits with 10 credits", async ({ page }) => {
  await signInWithPassword(page);

  await page.goto("/my-credits");
  // 页面标题 + 新用户赠送积分（CreditsAmount.NewUserGet = 10）
  await expect(
    page.getByRole("heading", { name: "My Credits" })
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/left credits:\s*10/)).toBeVisible();
});
