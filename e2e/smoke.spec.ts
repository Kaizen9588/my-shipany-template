import { test, expect, Page } from "@playwright/test";

/**
 * Smoke：不动数据，只验证部署面活着。
 * 任一条挂了说明站点基本不可用，门禁直接拦。
 */

test("health check returns ok", async ({ request }) => {
  const resp = await request.get("/api/health");
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.ok).toBe(true);
  expect(body.services.supabase).toBe("up");
});

test("landing page renders", async ({ page }) => {
  await page.goto("/");
  // header 至少有品牌链接 + 登录入口（landing 配置 show_sign: true）
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
});

test("pricing page renders", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.locator("h1, h2").first()).toBeVisible();
});

test("console requires sign-in (redirects to auth)", async ({ page }) => {
  // 未登录访问受保护路由应被守卫弹回登录页
  await page.goto("/my-credits");
  await expect(page).toHaveURL(/auth\/signin/);
});

test("admin requires sign-in (redirects to auth)", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/auth\/signin/);
});
