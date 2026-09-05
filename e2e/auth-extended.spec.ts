import { test, expect, dismissCookieBanner } from "./fixtures";

/**
 * 登录弹窗扩展分支 + 独立 signin 页：表单校验、错误提示、弹窗开关。
 * 注册成功全链路在 auth.spec.ts，这里补齐失败/校验分支。
 * 注意 send-verification 每 IP 30 次/分钟限流（内存实现）：本文件只发 1 次。
 */

const modal = (page: import("@playwright/test").Page) => page.getByRole("dialog");

async function openSignModal(page: import("@playwright/test").Page) {
  await page.goto("/");
  await dismissCookieBanner(page);
  await page.getByRole("button", { name: "Sign In" }).first().click();
  await expect(page.locator("#email")).toBeVisible();
}

test.describe("登录弹窗：开关行为", () => {
  test("ESC 关闭登录弹窗", async ({ page }) => {
    await openSignModal(page);
    await page.keyboard.press("Escape");
    await expect(page.locator("#email")).toBeHidden();
  });

  test("Sign in / Sign up 模式切换保持邮箱值", async ({ page }) => {
    await openSignModal(page);
    await page.locator("#email").fill("mode-switch@test.local");
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    // 注册模式第一步：出现发码按钮
    await expect(page.getByRole("button", { name: "Send Verification Code" })).toBeVisible();
    await expect(page.locator("#email")).toHaveValue("mode-switch@test.local");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#email")).toHaveValue("mode-switch@test.local");
  });
});

test.describe("登录弹窗：校验与失败分支", () => {
  test("邮箱为空点登录提示 email and password are required", async ({ page }) => {
    await openSignModal(page);
    await page.locator("button.w-full", { hasText: "Sign in" }).click();
    await expect(page.getByText("email and password are required")).toBeVisible();
  });

  test("错误密码登录提示 invalid email or password", async ({ page }) => {
    await openSignModal(page);
    await page.locator("#email").fill("seed-user@test.local");
    await page.locator("#password").fill("WrongPassword999");
    await page.locator("button.w-full", { hasText: "Sign in" }).click();
    await expect(page.getByText("invalid email or password")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("注册模式邮箱非法提示 invalid email（不发验证码）", async ({ page }) => {
    await openSignModal(page);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await page.locator("#email").fill("not-an-email");
    await page.getByRole("button", { name: "Send Verification Code" }).click();
    await expect(page.getByText("invalid email")).toBeVisible();
  });

  test("注册模式合法邮箱发码成功进入第二步", async ({ page }) => {
    await openSignModal(page);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await page.locator("#email").fill(`e2e-extended-${Date.now()}@test.local`);
    await page.getByRole("button", { name: "Send Verification Code" }).click();
    await expect(page.getByText("Verification code sent")).toBeVisible({
      timeout: 15_000,
    });
    // 第二步：验证码 + 密码输入框出现
    await expect(page.locator("#code")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#password")).toBeVisible();
    // 第二步校验：弱密码提示（code 随便填 6 位，密码不合规）
    await page.locator("#code").fill("000000");
    await page.locator("#password").fill("short");
    await page.getByRole("button", { name: /Verify & Create Account/ }).click();
    await expect(
      page.getByText("password must be at least 8 chars with letters and numbers")
    ).toBeVisible();
  });
});

test.describe("独立 signin 页", () => {
  test("signin 页渲染完整登录卡片，站点名来自项目配置", async ({ page }) => {
    await page.goto("/auth/signin");
    // CardTitle 是 div 而非语义 heading，按文本断言
    await expect(page.getByText("Sign In", { exact: true })).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    // OAuth 未配置时不出现 Google/GitHub 按钮
    await expect(page.getByRole("button", { name: /Google/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /GitHub/i })).toHaveCount(0);
    // 页脚法务链接
    await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy Policy" }).first()).toBeVisible();
  });

  test("signin 页登录成功跳首页并显示头像", async ({ page }) => {
    await page.goto("/auth/signin");
    await page.locator("#email").fill("seed-user@test.local");
    await page.locator("#password").fill("SeedUser123456");
    await page.locator("button.w-full", { hasText: "Sign in" }).click();
    // 头像 alt = 当前昵称（settings 用例会改昵称，前缀固定 seed-nick）
    await expect(page.locator('img[alt^="seed-nick"]').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("已登录访问 signin 页被弹回（无死循环出口）", async ({ page }) => {
    const { loginViaApi } = await import("./fixtures");
    await loginViaApi(page, "seed-user@test.local", "SeedUser123456");
    await page.goto("/auth/signin");
    // 服务端 redirect：session 存在时不应再看到登录表单
    await expect(page.locator("#email")).toBeHidden({ timeout: 15_000 });
  });
});
