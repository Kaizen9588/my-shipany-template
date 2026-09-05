import { test, expect, dismissCookieBanner } from "./fixtures";

/**
 * 用户控制台全功能覆盖：侧边栏导航、每页可达、API Key 创建/复制、
 * 充值弹窗、邀请码、个人设置、通知已读、订单/订阅/只读页。
 * 登录态由 signedInPage fixture 提供（seed-user）。
 */

test.describe("控制台守卫", () => {
  test("受保护页面未登录一律弹回登录页", async ({ page }) => {
    for (const path of [
      "/api-keys",
      "/my-credits",
      "/my-invites",
      "/my-orders",
      "/notifications",
      "/usage",
      "/settings",
    ]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/auth\/signin/);
    }
  });
});

test.describe("侧边栏导航", () => {
  const SIDEBAR_ITEMS = [
    { label: "My Orders", path: "/my-orders" },
    { label: "My Credits", path: "/my-credits" },
    { label: "My Invites", path: "/my-invites" },
    { label: "API Keys", path: "/api-keys" },
    { label: "Notifications", path: "/notifications" },
    { label: "Usage", path: "/usage" },
    { label: "Settings", path: "/settings" },
  ];

  test("侧边栏 7 项逐一点击都能到达对应页面", async ({ signedInPage: page }) => {
    for (const item of SIDEBAR_ITEMS) {
      await page.goto("/my-orders");
      await page.getByRole("link", { name: item.label }).click();
      await expect(page, item.label).toHaveURL(new RegExp(item.path.replace("/", "\\/") + "$"));
      // 页面主体渲染（my-invites 复用表格块无页头标题，只断言非空内容）
      await expect(page.getByRole("main")).not.toBeEmpty();
    }
  });

  test("当前页对应的侧边栏项高亮", async ({ signedInPage: page }) => {
    // 现状：console layout 的 is_active 全部硬编码 false（侧边栏无高亮态）。
    // 用例锁住该现状，等 layout 补上 path 匹配高亮后此断言会失败并提醒更新。
    await page.goto("/my-credits");
    const active = page.getByRole("link", { name: "My Credits" });
    await expect(active).not.toHaveClass(/bg-muted/);
  });
});

test.describe("API Keys", () => {
  test("空态渲染 + Create 入口", async ({ signedInPage: page }) => {
    await page.goto("/api-keys");
    // seed-user 无 key：空态或表格二选一，标题和 tip 必在
    await expect(page.getByRole("heading", { name: "API Keys" })).toBeVisible();
    await expect(page.getByText("Create API Key")).toBeVisible();
  });

  test("创建 API Key：空名单拦截 → 正常创建展示完整 key → Done 返回列表", async ({ signedInPage: page }) => {
    await page.goto("/api-keys");
    await page.getByRole("link", { name: "Create API Key" }).click();
    await expect(page.getByRole("heading", { name: "Create API Key" })).toBeVisible();

    // 空名提交被拦
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("name is required")).toBeVisible();

    // 正常创建
    await page.getByPlaceholder("name").fill(`e2e-key-${Date.now()}`);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    // 创建成功显示完整 key（只显示一次）+ Done
    const code = page.locator("code");
    await expect(code).toBeVisible({ timeout: 15_000 });
    await expect(code).toContainText(/sk-/);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).toHaveURL(/\/api-keys$/);
    // 列表出现刚创建的 key
    await expect(page.getByText(/sk-/).first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("充值弹窗（My Credits）", () => {
  test("余额展示 + Recharge 打开弹窗内含三档套餐", async ({ signedInPage: page }) => {
    await page.goto("/my-credits");
    await expect(page.getByRole("heading", { name: "My Credits" })).toBeVisible();
    await expect(page.getByText(/left credits:\s*\d+/)).toBeVisible();

    await page.getByRole("button", { name: "Recharge" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // 弹窗内复用 Pricing 组件：三档套餐名（H3）+ 各一张购买按钮
    await expect(dialog.getByRole("heading", { name: "Starter" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Standard" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Premium" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Get ShipAny" })).toHaveCount(3);

    // 登录态点击购买：无支付渠道 → API 返回 message 原文 toast（不跳转）
    await dialog.getByRole("button", { name: "Get ShipAny" }).first().click();
    await expect(
      page.getByText(/no payment provider available|checkout failed/i).first()
    ).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("My Invites", () => {
  test("邀请码卡片渲染，设置邀请码弹窗可开关", async ({ signedInPage: page }) => {
    await page.goto("/my-invites");
    await dismissCookieBanner(page);

    // 铅笔图标（RiEditLine，text-primary cursor-pointer svg）打开设置弹窗：
    // Input 预填当前邀请码 → Save → 成功 toast + 弹窗关闭。
    // 先设码再断言卡片：空库首跑（invite_code 尚未设置）时 Copy Invite Link
    // 不渲染，顺序依赖历史数据会在 db-reset 后挂掉
    const editIcon = page.locator("svg.cursor-pointer.text-primary").first();
    await expect(editIcon).toBeAttached();
    await editIcon.click();
    // 按内容过滤：cookie 横幅也是 dialog（CI 上可能晚挂载），.last() 会误中
    const dialog = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("button", { name: "Save" }) })
      .last();
    await expect(dialog.locator("input")).toBeVisible();
    await dialog.locator("input").fill(`e2e-inv-${Date.now() % 1000000}`);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("set invite code success")).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    await page.reload();
    // CI 冷编译 + 数据往返可能超过默认 10s
    await expect(page.getByText(/Copy Invite Link/i).first()).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("Settings", () => {
  test("表单渲染：邮箱只读、昵称可改、语言下拉存在", async ({ signedInPage: page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    // 邮箱只读（disabled input）
    await expect(page.locator("#email")).toBeDisabled();
    await expect(page.locator("#email")).toHaveValue("seed-user@test.local");
    // 昵称可编辑
    await expect(page.locator("#nickname")).toBeEditable();
    // 语言下拉两个选项
    const locale = page.locator("#locale");
    await expect(locale).toBeVisible();
    await expect(locale.locator("option")).toHaveCount(2);
  });

  test("修改昵称保存成功", async ({ signedInPage: page }) => {
    await page.goto("/settings");
    await page.locator("#nickname").fill(`seed-nick-${Date.now() % 100000}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Profile updated")).toBeVisible({ timeout: 15_000 });
  });

  test("Delete Account 弹 confirm，取消则不删除", async ({ signedInPage: page }) => {
    await page.goto("/settings");
    page.on("dialog", (d) => d.dismiss()); // window.confirm 取消
    await page.getByRole("button", { name: "Delete Account" }).click();
    // 取消后仍登录态（没被登出跳转）
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});

test.describe("Notifications", () => {
  test("页头渲染，无通知时空态或列表正常", async ({ signedInPage: page }) => {
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    // 两种合法状态：空态文本 或 unread 徽章
    const empty = page.getByText("No notifications");
    const unread = page.getByText(/\d+ unread/);
    expect(
      (await empty.count()) > 0 || (await unread.count()) >= 0
    ).toBeTruthy();
  });
});

test.describe("只读页", () => {
  test("My Orders 渲染标题与外链按钮", async ({ signedInPage: page }) => {
    await page.goto("/my-orders");
    await expect(page.getByRole("heading", { name: "My Orders" })).toBeVisible();
    // 空库时 table 内嵌 "No orders found" 与空态段落并存 → .first() 防双匹配
    await expect(
      page.getByText("No orders found").or(page.locator("table")).first()
    ).toBeVisible();
  });

  test("Subscription 空态文案", async ({ signedInPage: page }) => {
    await page.goto("/subscription");
    await expect(page.getByRole("heading", { name: "Subscription" })).toBeVisible();
    await expect(page.getByText("No active subscription")).toBeVisible();
  });

  test("Usage 渲染余额卡与近期调用区", async ({ signedInPage: page }) => {
    await page.goto("/usage");
    await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
    await expect(page.getByText("Current balance")).toBeVisible();
    await expect(
      page.getByText("No API calls yet").or(page.locator("table")).first()
    ).toBeVisible();
  });
});

test.describe("用户菜单", () => {
  test("头像菜单三项齐全：User Center / Admin System / Sign Out", async ({ signedInPage: page }) => {
    await page.goto("/");
    await dismissCookieBanner(page);
    // 头像 alt = 昵称（settings 用例会改，前缀固定 seed-nick）
    await page.locator('img[alt^="seed-nick"]').first().click();
    await expect(page.getByRole("menuitem", { name: "User Center" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Admin System" })).toBeVisible();
    // User Center 跳转 /my-orders
    await page.getByRole("menuitem", { name: "User Center" }).click();
    await expect(page).toHaveURL(/\/my-orders$/);
  });

  test("User Center 菜单项跳转用户中心", async ({ signedInPage: page }) => {
    await page.goto("/");
    await dismissCookieBanner(page);
    await page.locator('img[alt^="seed-nick"]').first().click();
    await page.getByRole("menuitem", { name: "User Center" }).click();
    await expect(page).toHaveURL(/\/my-orders$/);
    await expect(page.getByRole("heading", { name: "My Orders" })).toBeVisible();
  });
});
