# 组件文档

> 本文档描述**现状组件**，规划中的新组件见 §10。
> 计数基准（第十轮对齐）：`ui/` 29 个、`blocks/` 22 个——本文件是组件计数的唯一清点处；docs/README 与 docs/01 原引用的「28 / 14」旧数已同步修正。

## 1. 组件体系总览

```
components/
├── ui/               # shadcn/ui 基础组件 (29 个)
├── blocks/           # Landing Page 区块组件 (22 个区块)
├── console/          # 用户控制台组件
├── dashboard/        # 后台管理组件
├── sign/             # 登录/注册组件
├── analytics/        # 分析追踪组件
├── cookie-consent/   # Cookie 同意横幅（GDPR，✅ 已落地）
├── feedback/         # 反馈/客服（Crisp，✅ 已落地）
├── theme/            # 主题切换
├── locale/           # 语言切换
├── invite/           # 邀请组件
├── icon/             # 图标组件
└── markdown/         # Markdown 渲染
```

## 2. shadcn/ui 基础组件 (`components/ui/`)

基于 Radix UI 原语 + Tailwind CSS 的组件库，通过 `components.json` 配置。

| 组件 | 文件 | 用途 |
|------|------|------|
| Accordion | `accordion.tsx` | FAQ 折叠面板 |
| Alert | `alert.tsx` | 提示框 |
| Avatar | `avatar.tsx` | 用户头像 |
| Badge | `badge.tsx` | 标签/徽章 |
| Breadcrumb | `breadcrumb.tsx` | 面包屑导航 |
| Button | `button.tsx` | 按钮（支持 variant/size） |
| Card | `card.tsx` | 卡片容器 |
| Carousel | `carousel.tsx` | 轮播（Embla） |
| Collapsible | `collapsible.tsx` | 折叠面板 |
| Dialog | `dialog.tsx` | 模态对话框 |
| Drawer | `drawer.tsx` | 抽屉（Vaul） |
| DropdownMenu | `dropdown-menu.tsx` | 下拉菜单 |
| Form | `form.tsx` | 表单（react-hook-form 集成） |
| Icon | `icon.tsx` | 图标渲染（react-icons） |
| Input | `input.tsx` | 输入框 |
| Label | `label.tsx` | 标签 |
| NavigationMenu | `navigation-menu.tsx` | 导航菜单 |
| RadioGroup | `radio-group.tsx` | 单选组 |
| Select | `select.tsx` | 下拉选择 |
| Separator | `separator.tsx` | 分隔线 |
| Sheet | `sheet.tsx` | 侧边滑出面板 |
| Sidebar | `sidebar.tsx` | 侧边栏（复杂布局） |
| Skeleton | `skeleton.tsx` | 骨架屏 |
| Sonner | `sonner.tsx` | Toast 通知 |
| Switch | `switch.tsx` | 开关 |
| Table | `table.tsx` | 表格 |
| Tabs | `tabs.tsx` | 标签页 |
| Textarea | `textarea.tsx` | 文本域 |
| Tooltip | `tooltip.tsx` | 工具提示 |

### Button 组件变体

```typescript
type ButtonVariant =
  | "secondary" | "link" | "default"
  | "destructive" | "outline" | "ghost";

type ButtonSize = "sm" | "md" | "lg";
```

## 3. Landing Page 区块组件 (`components/blocks/`)

所有区块通过 i18n JSON 配置驱动，组件本身不含业务逻辑。

| 区块 | 文件 | 配置类型 | 说明 |
|------|------|----------|------|
| Header | `header/index.tsx` | `Header` | 导航栏（品牌、菜单、登录、语言、主题） |
| Hero | `hero/index.tsx` | `Hero` | 英雄区（标题、描述、CTA、背景） |
| Hero BG | `hero/bg.tsx` | - | Hero 背景动画 |
| Happy Users | `hero/happy-users.tsx` | - | Hero 用户头像展示 |
| Branding | `branding/index.tsx` | - | 品牌展示 |
| Feature | `feature/index.tsx` | - | 功能特性（样式 1） |
| Feature1 | `feature1/index.tsx` | - | 功能特性（样式 2） |
| Feature2 | `feature2/index.tsx` | - | 功能特性（样式 3） |
| Feature3 | `feature3/index.tsx` | - | 功能特性（样式 4） |
| Showcase | `showcase/index.tsx` | - | 案例展示 |
| Stats | `stats/index.tsx` | - | 数据统计 |
| Pricing | `pricing/index.tsx` | `Pricing` | 定价方案（含 Stripe checkout 跳转） |
| Testimonial | `testimonial/index.tsx` | - | 用户评价 |
| FAQ | `faq/index.tsx` | - | 常见问题 |
| CTA | `cta/index.tsx` | - | 行动号召 |
| Footer | `footer/index.tsx` | - | 页脚 |
| Blog | `blog/index.tsx` | - | 博客列表 |
| Blog Detail | `blog-detail/index.tsx` | - | 博客详情 |
| Crumb | `crumb/index.tsx` | - | 面包屑 |
| Toolbar | `toolbar/index.tsx` | - | 工具栏 |
| Form | `form/index.tsx` | - | 通用表单 |
| Empty | `empty/index.tsx` | - | 空状态 |
| Table | `table/index.tsx` | - | 通用表格 |
| Markdown Editor | `editor/markdown.tsx` | - | Markdown 编辑器 |

### 区块配置类型

```typescript
// types/blocks/base.d.ts
interface Button {
  title?: string;
  icon?: string;          // react-icons 名称
  url?: string;
  target?: string;
  type?: "button" | "link";
  variant?: ButtonVariant;
  size?: ButtonSize;
}

interface Brand {
  title?: string;
  logo?: Image;
  url?: string;
}

interface NavItem {
  title?: string;
  icon?: string;
  url?: string;
  is_expand?: boolean;    // 是否可展开子菜单
  children?: NavItem[];
}

interface Header {
  brand?: Brand;
  nav?: Nav;
  buttons?: Button[];
  show_sign?: boolean;    // 显示登录按钮
  show_locale?: boolean;  // 显示语言切换
  show_theme?: boolean;   // 显示主题切换
}

interface Hero {
  announcement?: Announcement;
  title?: string;
  highlight_text?: string;
  description?: string;
  buttons?: Button[];
  image?: Image;
  show_happy_users?: boolean;
  show_badge?: boolean;
}
```

## 4. 用户控制台组件 (`components/console/`)

| 组件 | 文件 | 用途 |
|------|------|------|
| ConsoleLayout | `layout.tsx` | 控制台整体布局（侧边栏 + 内容区） |
| SidebarNav | `sidebar/nav.tsx` | 控制台侧边栏导航 |
| FormSlot | `slots/form/index.tsx` | 表单插槽（配置驱动） |
| TableSlot | `slots/table/index.tsx` | 表格插槽（配置驱动） |

### 控制台侧边栏导航项

```
当前导航项（`app/[locale]/(default)/(console)/layout.tsx` 配置）:
├── My Orders      /my-orders
├── My Credits     /my-credits
├── My Invites     /my-invites
├── API Keys       /api-keys
├── Notifications  /notifications
├── Usage          /usage
└── Settings       /settings
```

## 5. 后台管理组件 (`components/dashboard/`)

| 组件 | 文件 | 用途 |
|------|------|------|
| DashboardLayout | `layout.tsx` | 管理后台整体布局 |
| Header | `header/index.tsx` | 顶部栏 |
| Sidebar | `sidebar/index.tsx` | 侧边栏容器 |
| SidebarHeader | `sidebar/header.tsx` | 侧边栏头部（品牌） |
| SidebarNav | `sidebar/nav.tsx` | 侧边栏导航 |
| SidebarUser | `sidebar/user.tsx` | 侧边栏用户信息 |
| SidebarFooter | `sidebar/footer.tsx` | 侧边栏底部 |
| FormSlot | `slots/form/index.tsx` | 表单插槽 |
| TableSlot | `slots/table/index.tsx` | 表格插槽 |

### 管理后台侧边栏导航项

```
当前导航项（`app/[locale]/(admin)/layout.tsx` 配置）:
├── 控制台          /admin
├── 用户管理        /admin/users
├── 订单
│   └── 已支付订单  /admin/paid-orders
├── 积分管理        /admin/credits（含 /admin/credits/adjust 调整页）
├── 操作审计        /admin/audit-logs
├── 支付渠道        /admin/payment
├── 定价映射        /admin/pricing
├── 告警通知        /admin/notify
├── 运营日志        /admin/logs
└── 文章管理        /admin/posts（含 add / edit 页）
```

## 6. Slot 插槽模式

控制台和后台管理共用 Slot 模式，通过配置驱动渲染：

### 6.1 Table Slot

```typescript
// types/slots/table.d.ts
interface TableSlot extends Slot {
  columns: TableColumn[];
  empty_message?: string;
}

// types/blocks/table.d.ts
interface TableColumn {
  name?: string;         // 数据字段名
  title?: string;        // 列标题
  type?: string;         // 列类型
  className?: string;
  callback?: (item: any) => ReactNode;  // 自定义渲染函数
}
```

**使用示例**（`admin/users/page.tsx`）：

```tsx
const columns: TableColumn[] = [
  { name: "uuid", title: "UUID" },
  { name: "email", title: "Email" },
  {
    name: "avatar_url",
    title: "Avatar",
    callback: (row) => <img src={row.avatar_url} className="w-10 h-10 rounded-full" />
  },
  {
    name: "created_at",
    title: "Created At",
    callback: (row) => moment(row.created_at).format("YYYY-MM-DD HH:mm:ss")
  },
];

<TableSlot title="All Users" columns={columns} data={users} />
```

### 6.2 Form Slot

```typescript
// types/slots/form.d.ts
interface FormSlot extends Slot {
  fields: FormField[];
  submit: FormSubmit;
}

// types/blocks/form.d.ts
interface FormField {
  name?: string;
  title?: string;
  type?: "text" | "textarea" | "number" | "email" | "password"
       | "select" | "url" | "editor" | "code_editor"
       | "richtext_editor" | "markdown_editor";
  placeholder?: string;
  options?: { title: string; value: string }[];
  value?: string;
  tip?: string;
  validation?: {
    required?: boolean;
    min?: number;
    max?: number;
    message?: string;
    email?: boolean;
  };
}

interface FormSubmit {
  button?: Button;
  handler?: (data: FormData, passby?: any) =>
    Promise<{ status: "success" | "error"; message: string; redirect_url?: string } | void>;
}
```

## 7. 登录组件 (`components/sign/`)

| 组件 | 文件 | 用途 |
|------|------|------|
| SignIn | `sign_in.tsx` | 登录入口（显示登录按钮或用户信息） |
| SignForm | `form.tsx` | 登录表单（Provider 列表） |
| SignModal | `modal.tsx` | 登录弹窗 |
| SignToggle | `toggle.tsx` | 登录/用户切换 |
| User | `user.tsx` | 已登录用户头像/菜单 |

**Provider 列表动态生成**：

```typescript
// auth/config.ts
export const providerMap = providers
  .map((provider) => ({ id: provider.id, name: provider.name }))
  .filter((provider) => provider.id !== "google-one-tap");
// 排除 google-one-tap，不在登录页显示按钮
```

## 8. 其他组件

| 组件 | 文件 | 用途 |
|------|------|------|
| GoogleAnalytics | `analytics/google-analytics.tsx` | GA 追踪（consent 门控） |
| PostHog | `analytics/posthog.tsx` | PostHog 分析 + 会话录制（consent 门控 + 输入遮盖，见 docs/11） |
| OpenPanel | `analytics/open-panel.tsx` | OpenPanel 追踪（✅ consent 门控已补；⚠️ 待 PostHog 接入评估后移除，见 docs/11） |
| AnalyticsIndex | `analytics/index.tsx` | 分析组件统一入口 |
| CookieConsent | `cookie-consent/index.tsx` | Cookie 同意横幅（GDPR，同意后派发 `cookie-consent-accepted` 事件） |
| CrispFeedback | `feedback/crisp.tsx` | 反馈/客服按钮（Crisp） |
| ThemeToggle | `theme/toggle.tsx` | 亮/暗色切换 |
| LocaleToggle | `locale/toggle.tsx` | 语言切换 |
| InviteModal | `invite/modal.tsx` | 邀请弹窗 |
| InviteIndex | `invite/index.tsx` | 邀请入口 |
| IconComponent | `icon/index.tsx` | 通用图标渲染 |
| MarkdownRender | `markdown/index.tsx` | Markdown 渲染 |

## 9. Context 与 Hooks

### 9.1 AppContext (`contexts/app.tsx`)

全局应用上下文，提供：

```typescript
interface ContextValue {
  theme: string;
  setTheme: (theme: string) => void;
  showSignModal: boolean;
  setShowSignModal: (show: boolean) => void;
  user: User | null;
  setUser: (user: User | null) => void;
}
```

**核心行为**：
- 监听 NextAuth session 变化，session 有值时自动调用 `/api/get-user-info`
- 登录后自动检查 localStorage 中的邀请码，2 小时内自动绑定邀请关系（⚠️ 2 小时限制当前仅前端检查，可绕过，P-1.4 下放服务端）
- Google One-Tap 启用时自动触发 `useOneTapLogin`

### 9.2 Hooks

| Hook | 文件 | 用途 |
|------|------|------|
| `useOneTapLogin` | `hooks/useOneTapLogin.tsx` | Google One-Tap 登录触发 |
| `useMediaQuery` | `hooks/useMediaQuery.tsx` | 响应式断点检测 |
| `useMobile` | `hooks/use-mobile.tsx` | 移动端检测 |

---

## 10. 规划中的组件（待实现）

| 组件 | 归属 | 关联设计 |
|------|------|----------|
| AI 试用弹窗 | `components/trial/`（「用完提示登录」弹窗） | 6.0.1 / 14 §2.4 |

> 已落地移出本表：~~设备指纹加载~~（指纹方案已废弃，收敛为纯 IP，见 docs/14 修订）、
> Cookie 同意横幅（`components/cookie-consent/`）、通知中心（`(console)/notifications/page.tsx`）、
> 反馈/客服按钮（`components/feedback/crisp.tsx`）、支付方式选择（pricing 区块已支持多渠道 checkout）。
