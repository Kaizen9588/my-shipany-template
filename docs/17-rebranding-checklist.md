# 品牌替换清单（Rebranding Checklist）

> **用途**：本仓库当前是模板项目，原模板（ShipAny）作者的品牌、外链、示例内容全部保留未动。
> 将来要复制出独立项目做自有品牌网站时，按本清单**逐项替换**即可把原作者痕迹清干净。
>
> - 扫描基准：master 分支 commit `b4d0d5b`（2026-09-02 全量扫描）。
> - 行号会随代码演进漂移，文档以**搜索锚点（可 grep 的关键词）**为主、行号为辅。
> - 替换完成后必须执行 §八 的验收步骤（搜索清零 + tsc + 测试 + 浏览器目检）。

---

## 〇、替换前先定占位符

下文统一用这些占位符表示你的新值，动手前先填好：

| 占位符 | 含义 | 示例 |
|---|---|---|
| `{BRAND}` | 产品名（中文/英文按页面定） | MySaaS |
| `{SITE_URL}` | 正式域名（含协议） | https://example.com |
| `{DOCS_URL}` | 你的文档站地址（没有就删该项） | https://example.com/docs |
| `{SUPPORT_EMAIL}` | 支持邮箱 | support@example.com |
| `{GITHUB_URL}` / `{X_URL}` / `{DISCORD_URL}` | 你的社交链接（没有就删该项） | — |

---

## 一、许可证说明（已确认，可直接移除）

仓库根目录的 [`LICENSE`](../LICENSE) 是《ShipAny AI SaaS Boilerplate License Agreement》（商业模板许可），其中第 2 条写有 "Remove ShipAny attribution and copyright notices" 属限制行为。

**授权状态：已确认。** 2026-09-02 项目所有者确认本模板的使用已获 ShipAny 授权，因此本清单中所有原作者署名、品牌、外链、版权声明（含 LICENSE 文件本身）在独立项目中**都可以移除或替换**，无需保留出处：

- 独立项目中可直接删除/替换根目录 `LICENSE` 文件，换成自己的许可或留空。
- `README.md` 中对 ShipAny 的说明与致谢也可一并删除（见 §五.3）。
- 页面、元数据、代码中的全部品牌元素按本清单逐项移除即可，无保留义务。

---

## 二、页面文案 JSON（占全部残留的 ~80%）

品牌文字与外链几乎全部集中在 4 个 JSON 文件里，**zh/en 必须成对同步改**：

- `i18n/pages/landing/zh.json`（主页各区块，56 处 ShipAny）
- `i18n/pages/landing/en.json`（同结构英文版，56 处）
- `i18n/messages/zh.json`（控制台/通用文案，8 处）
- `i18n/messages/en.json`（同结构英文版）

### 2.1 `landing/*.json` 按区块（section）替换

按 JSON 顶层 key 分组。每行格式：`key → 当前值 → 动作`。

| Section | key 路径 | 当前值 / 内容 | 动作 |
|---|---|---|---|
| template | 顶层 `template` | `"my-shipany-template"` | 改为你的仓库名/项目名 |
| header | `header.brand.title` / `brand.logo.alt` | `"ShipAny"` | `{BRAND}` |
| header | `header.buttons[0]` | 「获取 ShipAny」→ `https://shipany.ai` | **整项删除**，或改为指向 `/#pricing` |
| header | `header.nav.items` 中「案例展示」的 `children` | 2 个子菜单 → `https://aiwallpaper.shop`、`https://aicover.design`（作者自家产品） | **删除 children**（保留空目录或改链到你的页面） |
| hero | `hero.description` | 开头 "ShipAny 是一个用于构建 AI SaaS 创业项目的 NextJS 模板。…" | 改写为你的产品描述 |
| hero | `hero.buttons[1]` | 「加入 Discord」→ `https://discord.gg/HQNnrzjZQS` | **删除**，或改 `{DISCORD_URL}` |
| branding | `branding.title` | 含 "ShipAny" | 改 `{BRAND}` |
| introduce | `introduce.title` | "ShipAny 建立在巨人的肩膀上" | 改写 |
| introduce | 子项内多处 ShipAny 描述 | — | 改写 |
| benefit | `benefit.title` | "什么是 ShipAny" | 改写 |
| usage | `usage.title` | "为什么选择 ShipAny" | 改写 |
| usage | `usage.items[].title/description` | "获取 ShipAny"、"阅读文档并克隆 ShipAny 代码…" 等 | 改写 |
| feature | `feature.title` | "ShipAny 核心功能" | 改写 |
| **showcase** | `showcase.title` | "使用 ShipAny 构建的 AI SaaS 创业项目" | 改写，或**整块删除**（连同 `app/[locale]/(default)/page.tsx` 里的 `{page.showcase && <Showcase …>}` 一行） |
| **showcase** | `showcase.items[]`（9 项） | ThinkAny/HeyBeauty/AI Wallpaper/AI Cover/GPTs Works/Melodisco/Pagen/SoraFM/PodLM，每个带外链 | **全部删除**，或换成你的案例（换掉 `url`） |
| stats | 标题含 ShipAny | — | 改写 |
| pricing | `pricing.description` | "获取 ShipAny 的所有功能…" | 改写 |
| pricing | `pricing.items[*].product_name` | "ShipAny 模板入门版/标准版/高级版" | `{BRAND}` 套餐名，**注意与 §三.1 / §五.2 数据库表同步** |
| testimonial | `testimonial.title/description` | "用户喜爱 ShipAny" 等 | 改写 |
| testimonial | `testimonial.items[].description`（4 条） | 全是吹 ShipAny 的虚构评价 | 改写为你的产品评价，或整块删除 |
| faq | `faq.title/description` + 6 个问答 | "关于 ShipAny 的常见问题"；描述里让用户 "通过 Discord…联系我们" | 改写；Discord 字样改为你的渠道 |
| cta | `cta.description` | "从这里开始，使用 ShipAny 启动。" | 改写 |
| cta | `cta.buttons` | 「获取 ShipAny」→ shipany.ai；「阅读文档」→ docs.shipany.ai | 删除或改 `{SITE_URL}` / `{DOCS_URL}` |
| footer | `footer.brand.title/description` | "ShipAny" + 模板介绍 | 改 `{BRAND}` + 你的介绍 |
| footer | `footer.nav` 「资源」组 | docs.shipany.ai、shipany.ai/components、shipany.ai/templates | 删除该组，或换你的链接 |
| footer | `footer.nav` 「友情链接」组 | thinkany.ai、heybeauty.ai、pagen.so（作者自家产品） | **删除整组**，或换你真正的友链 |
| footer | `footer.social` | X→x.com/shipanyai、Github→github.com/shipanyai、Discord→discord.gg/HQNnrzjZQS | 换你的社交链接，没有就删 |
| footer | `footer.copyright` | "© 2025 • ShipAny 保留所有权利。"（en 同） | `© {年份} • {BRAND}` |

### 2.2 `messages/*.json` 按 key 替换

| key 路径 | zh 当前值 | 动作 |
|---|---|---|
| `metadata.title` | "几小时内构建任何 AI SaaS 创业项目 \| ShipAny" | `{BRAND}` 标题（SEO 核心项） |
| `metadata.description` | "ShipAny 是一个用于构建 AI SaaS 创业项目的 NextJS 模板…" | 改写（SEO 核心项） |
| `metadata.keywords` | "ShipAny, AI SaaS 模板, NextJS 模板" | 换成你的关键词（SEO 核心项） |
| `my_orders.description` | "在 ShipAny 上购买的订单。" | 改 `{BRAND}` |
| `my_orders.join_discord` | "加入 Discord" | 删除文案（配合 §三.2 删按钮），或改别的 |
| `my_orders.read_docs` | "阅读文档" | 同上（配合 §三.2） |
| `blog.description` | "关于 ShipAny 的新闻、资源和更新" | 改写 |
| `my_invites.invite_tip` | "每邀请 1 位朋友购买 ShipAny，奖励 $50。" | 改 `{BRAND}`（注意 `$50` 佣金数字也按你的政策改） |
| `my_invites.no_orders` | "你需要先购买过 ShipAny 才能邀请朋友" | 改 `{BRAND}` |

---

## 三、组件/页面里硬编码（JSON 之外）

### 3.1 页脚 "build with" 署名链接

- 文件：`components/blocks/footer/index.tsx`
- 搜索锚点：`build with my-shipany-template`
- 现状：版权行后**硬编码**了 `<a href="https://shipany.ai">build with my-shipany-template</a>`，环境变量 `NEXT_PUBLIC_SHOW_POWERED_BY=false` 可隐藏（`.env` 里设为 `"false"`），但文案本身仍在组件里。
- 动作：删掉这个 `<a>` 块（连 `process.env…` 三元一起），或改成你自己的文案/链接。

### 3.2 用户中心两个页面的文档/Discord 按钮

- 文件：`app/[locale]/(default)/(console)/my-orders/page.tsx`
  - 搜索锚点：`docs.shipany.ai`、`discord.gg/HQNnrzjZQS`
  - 现状：表格工具栏两个按钮「阅读文档」「加入 Discord」外链到作者文档和 Discord。
  - 动作：删这两个 toolbar 项（对应文案 `my_orders.read_docs` / `my_orders.join_discord` 一并清理）。
- 文件：`app/[locale]/(default)/(console)/my-invites/page.tsx`
  - 搜索锚点：`discord.gg/HQNnrzjZQS`（1 处横幅链接）、`docs.shipany.ai`、`discord.gg/HQNnrzjZQS`（toolbar 2 处）
  - 现状：空状态横幅「加入 Discord」+ 工具栏同上。
  - 动作：删横幅 `Link` 块与 toolbar 项。

### 3.3 管理后台侧栏

- 文件：`app/[locale]/(admin)/layout.tsx`
- 搜索锚点：`title: "ShipAny"`（brand.title 与 logo.alt 两处）
- 动作：改 `{BRAND}`。
- 另有一项 `url: "https://github.com/Kaizen9588/my-shipany-template"`——这是**你自己的仓库**，独立项目里改成新仓库地址或删除。

### 3.4 后台发文章的示例 slug

- 文件：`app/[locale]/(admin)/admin/posts/add/page.tsx`、`app/[locale]/(admin)/admin/posts/[uuid]/edit/page.tsx`
- 搜索锚点：`what-is-shipany`
- 现状：slug 输入框 placeholder 与 tip 示例。
- 动作：换成中性示例（如 `my-first-post`）。纯提示文案，不影响功能。

### 3.5 邮件发件人兜底名

- 文件：`lib/email/providers/resend.ts`
- 搜索锚点：`ShipAny <onboarding@resend.dev>`
- 现状：`EMAIL_FROM` 未配置时的兜底发件人。
- 动作：生产环境本就该在 `.env` 配 `EMAIL_FROM`；同时把兜底字符串改为 `{BRAND}`。

### 3.6 邮件模板项目名兜底

- 文件：`emails/layout.tsx`
- 搜索锚点：`"ShipAny"`
- 现状：`NEXT_PUBLIC_PROJECT_NAME` 未配置时的兜底项目名。
- 动作：改 `{BRAND}`，并在 `.env` 配 `NEXT_PUBLIC_PROJECT_NAME={BRAND}`。

---

## 四、定价数据（会随支付落库/进账单，重点）

定价是**双真相源 + 数据库覆盖**，三处都要对齐，否则用户下单/账单里看到旧品牌名：

1. **`data/pricing.ts`（服务端常量）**
   - 搜索锚点：`ShipAny Boilerplate`
   - 3 个套餐的 `product_name`：`ShipAny Boilerplate Starter / Standard / Premium` → 改 `{BRAND} Starter` 等。
2. **`i18n/pages/landing/{zh,en}.json` 的 `pricing.items[*].product_name`**（见 §2.1 pricing 行）。
3. **数据库 `payment_products` 表**：`models/payment.ts` 的 `getCheckoutProduct` **优先读表**，表里有记录时 `product_name` 以表为准（金额/积分/有效期也以表为准）。后台「定价管理」页可改。**独立项目部署后，进后台把 3 个产品的名称改成 `{BRAND}` 系列**（若沿用模板库数据）。
4. Stripe/Creem 后台的产品名：如果渠道后台建品时用了旧名，账单展示名以渠道后台为准，需在渠道侧同步改名。

---

## 五、环境变量与站点资源

### 5.1 `.env.example` / 各环境 `.env`

| 变量 | 现状 | 动作 |
|---|---|---|
| `NEXT_PUBLIC_PROJECT_NAME` | `"my-shipany-template"` | 改 `{BRAND}`（邮件模板、存储 key 前缀等都用它兜底） |
| `NEXT_PUBLIC_SHOW_POWERED_BY` | 未列出（组件默认显示） | 设 `"false"` 可隐藏页脚署名（若已按 §3.1 删组件则不需要） |
| `NEXT_PUBLIC_SITE_URL` 等 | — | 部署独立项目时全部换成新域名（详见 `docs/08-config-env.md`） |

### 5.2 站点 logo / favicon

- 文件：`public/logo.png`（440×438）、`public/favicon.ico`
- 现状：ShipAny 官方 logo 图形（页面 header/footer/侧栏/头像 fallback 都引用 `/logo.png`）。
- 动作：换成 `{BRAND}` 的 logo（同名覆盖或全局搜 `logo.png` 更新引用；`i18n/pages/landing/*.json` 里 header.brand.logo.src、footer.brand.logo.src 等 2 处/语言文件）。

### 5.3 其他配置文件元数据

| 文件 | 锚点 | 动作 |
|---|---|---|
| `package.json` | `"homepage": "https://shipany.ai"` | 改 `{SITE_URL}` |
| `package.json` | `"name": "my-shipany-template"` | 改新项目名 |
| `README.md` | "基于 [ShipAny](https://shipany.ai) 开源版打造"、"基于 **ShipAny AI SaaS Boilerplate License Agreement**"、文末致谢 | 独立项目里直接删除或改写（授权已确认，见 §一） |
| `LICENSE` | 《ShipAny AI SaaS Boilerplate License Agreement》全文 | 独立项目里可直接删除，换成自己的许可或留空（见 §一） |

---

## 六、确认过**没有**残留的位置（扫描过、放心）

以下位置做过全量扫描，不存在原作者品牌/外链，无需处理：

- `db/schema.ts`、`data/migrations/*.sql`（仅 `admin@shipany.local` 默认管理员邮箱——这是本地开发的种子账号，**建议独立项目也顺手换成自己的管理员邮箱**，见迁移 `0027_restore_default_admin.sql`）
- `app/sitemap.ts`、`public/robots.txt`（无外域）
- `components/` 全目录（除 §3.1 footer 一处外无其他）
- 反馈挂件 makethisbetter：此前已完整移除，无残留（含 `/tmp` 克隆，不在仓库内）
- 页面代码中无暗桩/混淆外链，全部外链都集中在 §二 的 JSON 里

---

## 七、快速重扫命令（行号漂移时用这些）

```bash
# 全站品牌词扫描（应随替换进度递减至仅剩 LICENSE/README/本文档）
grep -rni "shipany\|thinkany\|heybeauty\|pagen\.so\|aiwallpaper\|aicover\|gpts\.works\|melodis\|podlm\|sorafm" \
  --include="*.ts" --include="*.tsx" --include="*.json" --include="*.mjs" \
  app/ components/ data/ i18n/ lib/ emails/ models/ package.json | grep -v node_modules

# 外链域名扫描（discord/x.com/作者官网）
grep -rn "discord.gg\|x.com/shipanyai\|github.com/shipanyai\|docs.shipany" \
  --include="*.ts" --include="*.tsx" --include="*.json" \
  app/ components/ i18n/ | grep -v node_modules
```

---

## 八、替换后验收清单

1. §七 两条 grep 结果为 0（本文档自身与已替换干净的 LICENSE/README 除外；按 §一 LICENSE 也可直接删除）。
2. `npx tsc --noEmit` 通过（与 CI 同款命令）。
3. `pnpm test` 全绿。
4. `pnpm build` 通过。
5. 浏览器目检（zh + en 两语言）：
   - 主页：header 无「获取 ShipAny」、hero 无 Discord 按钮、页脚无友情链接/资源外链、版权行是 `{BRAND}`；
   - 用户中心：我的订单/我的邀请页无文档/Discord 按钮；
   - 管理后台：侧栏品牌是 `{BRAND}`；
   - 定价卡与真实下单：支付页/账单显示 `{BRAND}` 套餐名；
   - 收到的邮件（注册验证/订单通知）：发件人与模板显示 `{BRAND}`。
6. 若删除了 showcase/testimonial 整块，确认 `app/[locale]/(default)/page.tsx` 对应渲染行已同步移除、页面布局正常。
