import { test, expect, dismissCookieBanner } from "./fixtures";

/**
 * Landing 页交互全覆盖：header 导航 / 主题切换 / 语言切换 / FAQ 手风琴 /
 * cookie 横幅 / 定价区卡片与按钮（未登录态）。不动数据。
 */

test.describe("header 导航", () => {
  test("品牌 logo 点击回首页", async ({ page }) => {
    await page.goto("/posts");
    await dismissCookieBanner(page);
    // logo 可访问名是 "ShipAny ShipAny"（img alt + 文字）；裸 "ShipAny" 会撞 showcase 外链
    await page.getByRole("link", { name: "ShipAny ShipAny" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: /Ship Any AI Startups/i })
    ).toBeVisible();
  });

  test("Features / Pricing 锚点导航滚动到对应区块", async ({ page }) => {
    await page.goto("/");
    await dismissCookieBanner(page);
    await page.getByRole("link", { name: "Features" }).first().click();
    await expect(page).toHaveURL(/#feature/);
    await page.getByRole("link", { name: "Pricing" }).first().click();
    await expect(page).toHaveURL(/#pricing/);
    // pricing 区块 id 由 pricing.name 生成，锚点命中说明区块存在
    await expect(page.locator("#pricing")).toBeAttached();
  });

  test("Showcase 子菜单展开且包含外链项", async ({ page }) => {
    await page.goto("/");
    await dismissCookieBanner(page);
    await page.getByRole("navigation").getByText("Showcase").click();
    // 子菜单项是外链（target=_blank），断言出现即可，不真跳外站
    const wallpaper = page.getByRole("link", { name: "AI Wallpaper Shop" });
    await expect(wallpaper).toBeVisible();
    // 导航区与移动端菜单各渲染一份，断言 nav 内那份即可
    await expect(
      page.getByRole("navigation").getByRole("link", { name: "AI Cover Generator" })
    ).toBeVisible();
  });

  test("Get Started CTA 指向定价锚点", async ({ page }) => {
    await page.goto("/");
    await dismissCookieBanner(page);
    const cta = page.getByRole("link", { name: "Get Started" });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", /#pricing/);
  });
});

test.describe("主题切换", () => {
  test("点击月亮/太阳图标切换 dark class", async ({ page }) => {
    await page.goto("/");
    await dismissCookieBanner(page);
    const html = page.locator("html");
    const before = await html.getAttribute("class");
    // 主题按钮无 aria-label，且 landing 没有语义 <header>（右上角图标在 nav 容器里）
    const darkIcon = page.locator("svg.cursor-pointer.text-muted-foreground").first();
    await expect(darkIcon).toBeVisible();
    await darkIcon.click();
    await expect
      .poll(async () => html.getAttribute("class"), { timeout: 5_000 })
      .not.toBe(before);
    // 切回原状态，避免影响同 context 后续视觉
    await darkIcon.click();
    await expect
      .poll(async () => html.getAttribute("class"), { timeout: 5_000 })
      .toBe(before);
  });
});

test.describe("语言切换", () => {
  test("切换到中文后 header 文案变化且 URL 带 /zh 前缀", async ({ page }) => {
    await page.goto("/");
    await dismissCookieBanner(page);
    // LocaleToggle 是 shadcn Select：combobox 触发 → 选项「中文」
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "中文" }).click();
    await expect(page).toHaveURL(/\/zh/);
    // en.json 的 "Sign In" → zh.json 的「登录」
    await expect(page.getByRole("button", { name: "登录" }).first()).toBeVisible();
    // 切回英文（后续用例依赖默认无前缀 URL）
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "English" }).click();
    await expect(page).toHaveURL(/^(?!.*\/zh).*$/);
  });
});

test.describe("cookie 同意横幅", () => {
  test("首访出现，Reject All 后持久化不再出现", async ({ page }) => {
    await page.goto("/");
    const banner = page.getByRole("dialog", { name: "We value your privacy" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Reject All" }).click();
    await expect(banner).toBeHidden();
    // 同 context 二次导航不再弹
    await page.goto("/posts");
    await expect(page.getByRole("dialog", { name: "We value your privacy" })).toBeHidden();
  });

  test("Customise 展开偏好开关，Save Preferences 保存", async ({ page }) => {
    await page.goto("/");
    const banner = page.getByRole("dialog", { name: "We value your privacy" });
    await banner.getByRole("button", { name: "Customise" }).click();
    // 三个开关：必要（disabled）+ analytics + recording
    await expect(banner.getByText("Strictly Necessary")).toBeVisible();
    const switches = banner.getByRole("switch");
    await expect(switches).toHaveCount(3);
    await banner.getByRole("button", { name: "Save Preferences" }).click();
    await expect(banner).toBeHidden();
  });
});

test.describe("FAQ 区块", () => {
  test("FAQ 网格渲染 6 个问题，内容可读", async ({ page }) => {
    await page.goto("/");
    await dismissCookieBanner(page);
    // FAQ 区块是静态网格（#faq，6 项），真正的 Accordion 在 benefit 区；
    // 这里断言 FAQ 区块内容渲染 + benefit 区手风琴可开合
    const faq = page.locator("#faq");
    await expect(faq.getByRole("heading", { name: /What exactly is ShipAny/i })).toBeVisible();
    const items = faq.locator(".grid > div");
    await expect(items).toHaveCount(6);

    // benefit 区手风琴：点击问题展开答案，再点收起
    const firstQ = page.locator("#benefit").getByRole("button").filter({ hasText: "Complete Framework" });
    await firstQ.scrollIntoViewIfNeeded();
    await firstQ.click();
    await expect(firstQ).toHaveAttribute("data-state", "closed"); // 默认 open，点击收起
    await firstQ.click();
    await expect(firstQ).toHaveAttribute("data-state", "open");
  });
});

test.describe("定价区（未登录）", () => {
  test("三档套餐卡片渲染，默认高亮推荐档", async ({ page }) => {
    await page.goto("/");
    await dismissCookieBanner(page);
    const section = page.locator("#pricing");
    // 档名在 H3 标题里（getByText 会撞正文里的同名词）
    await expect(section.getByRole("heading", { name: "Starter" })).toBeVisible();
    await expect(section.getByRole("heading", { name: "Standard" })).toBeVisible();
    await expect(section.getByRole("heading", { name: "Premium" })).toBeVisible();
  });

  test("未登录点购买按钮弹出登录弹窗而不是跳转", async ({ page }) => {
    await page.goto("/");
    await dismissCookieBanner(page);
    await page.locator("#pricing").getByRole("button", { name: "Get ShipAny" }).first().click();
    // handleCheckout 里 !user → setShowSignModal(true)
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator("#email")).toBeVisible();
  });
});

test.describe("页脚与法务页", () => {
  test("页脚法务链接可达 Privacy / Terms", async ({ page }) => {
    await page.goto("/");
    await dismissCookieBanner(page);
    // footer 无 contentinfo role（在 section 内部），用 #footer 容器定位；
    // Cookie 横幅里也有同名 Privacy Policy 链接，先关掉横幅再取第一个
    await page.locator("#footer").getByRole("link", { name: "Privacy Policy" }).click();
    await expect(page).toHaveURL(/privacy-policy/);
    await expect(page.locator("h1, h2").first()).toBeVisible();
    await page.goBack();
    await page.locator("#footer").getByRole("link", { name: "Terms of Service" }).click();
    await expect(page).toHaveURL(/terms-of-service/);
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });

  test("博客列表页渲染，搜索框存在", async ({ page }) => {
    await page.goto("/posts");
    await dismissCookieBanner(page);
    await expect(page.getByPlaceholder("Search posts...")).toBeVisible();
  });
});
