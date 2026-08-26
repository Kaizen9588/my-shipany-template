# 鉴权流程文档

## 1. 技术选型

| 项 | 选型 | 版本 |
|----|------|------|
| 鉴权框架 | NextAuth.js (Auth.js v5) | 5.0.0-beta.25 |
| Session 策略 | JWT | - |
| Token 存储 | HTTP-only Cookie | - |
| OAuth Provider | Google / GitHub / Google One-Tap | - |

## 2. 配置文件

### 2.1 核心配置：`auth/config.ts`

```
auth/
├── config.ts    # NextAuth 配置（providers, callbacks, pages）
├── index.ts     # 导出 handlers, signIn, signOut, auth
└── session.tsx  # 客户端 SessionProvider 封装
```

### 2.2 Provider 动态注册

Provider 通过环境变量动态启用，未配置的 Provider 不会出现在登录页：

```typescript
// auth/config.ts 核心逻辑

// 1. Google One-Tap（使用 Credentials Provider 自定义实现）
if (NEXT_PUBLIC_AUTH_GOOGLE_ONE_TAP_ENABLED === "true" && AUTH_GOOGLE_ID) {
  providers.push(CredentialsProvider({
    id: "google-one-tap",
    credentials: { credential: { type: "text" } },
    async authorize(credentials) {
      // 验证 Google ID Token
      const response = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + token);
      const payload = await response.json();
      // 返回 user 对象
    }
  }));
}

// 2. Google OAuth
if (NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === "true" && AUTH_GOOGLE_ID && AUTH_GOOGLE_SECRET) {
  providers.push(GoogleProvider({ clientId, clientSecret }));
}

// 3. GitHub OAuth
if (NEXT_PUBLIC_AUTH_GITHUB_ENABLED === "true" && AUTH_GITHUB_ID && AUTH_GITHUB_SECRET) {
  providers.push(GitHubProvider({ clientId, clientSecret }));
}
```

### 2.3 登录页配置

```typescript
pages: {
  signIn: "/auth/signin",  // 自定义登录页路径
}
```

## 3. 完整登录流程

### 3.1 Google OAuth 登录

```
用户                    浏览器                 NextAuth              Google           Supabase
 │                       │                      │                     │                  │
 │ 1.点击"Sign in with   │                      │                     │                  │
 │   Google"             │                      │                     │                  │
 │──────────────────────>│                      │                     │                  │
 │                       │ 2.signIn("google")   │                     │                  │
 │                       │─────────────────────>│                     │                  │
 │                       │                      │ 3.重定向到 Google    │                  │
 │                       │ 4.302 Redirect       │                     │                  │
 │                       │<─────────────────────│                     │                  │
 │                       │ 5.跳转 Google 授权页 │                     │                  │
 │                       │─────────────────────────────────────────────>│                  │
 │ 6.选择账号/授权       │                      │                     │                  │
 │                       │ 7.callback 带	code  │                     │                  │
 │                       │<─────────────────────────────────────────────│                  │
 │                       │ 8.GET /api/auth/callback/google?code=...    │                  │
 │                       │─────────────────────>│                     │                  │
 │                       │                      │ 9.用 code 换 token  │                  │
 │                       │                      │────────────────────>│                  │
 │                       │                      │ 10.access_token     │                  │
 │                       │                      │<────────────────────│                  │
 │                       │                      │                     │                  │
 │                       │                      │ 11.jwt callback     │                  │
 │                       │                      │   user.email 有值   │                  │
 │                       │                      │   account 有值     │                  │
 │                       │                      │                     │                  │
 │                       │                      │ 12.saveUser(dbUser) │                  │
 │                       │                      │───────────────────────────────────────>│
 │                       │                      │                     │ 13.findUserByEmail│
 │                       │                      │                     │   不存在则 INSERT│
 │                       │                      │                     │   + increaseCredits│
 │                       │                      │ 14.savedUser        │                  │
 │                       │                      │<────────────────────────────────────────│
 │                       │                      │                     │                  │
 │                       │                      │ 15.token.user = {   │                  │
 │                       │                      │      uuid, email,   │                  │
 │                       │                      │      nickname,      │                  │
 │                       │                      │      avatar_url,    │                  │
 │                       │                      │      created_at }   │                  │
 │                       │                      │                     │                  │
 │                       │ 16.set-cookie        │                     │                  │
 │                       │   next-auth.session- │                     │                  │
 │                       │   token=JWT          │                     │                  │
 │                       │<─────────────────────│                     │                  │
 │                       │                      │                     │                  │
 │ 17.页面跳转/刷新       │                      │                     │                  │
 │                       │ 18.useSession()      │                     │                  │
 │                       │   读取 cookie        │                     │                  │
 │                       │   获取 user 信息     │                     │                  │
```

### 3.2 Google One-Tap 登录

> ✅ **P-1.11 已修复**：改用 `google-auth-library` 的 `verifyIdToken({ idToken, audience: googleClientId })`，
> 内部校验 aud（必须等于本应用 Client ID）/iss/exp 与签名。原 `tokeninfo` 端点实现不校验 aud，
> 攻击者可用任意应用的合法 Google token 伪造任意 email 登录，且该端点已被 Google deprecated。

```
浏览器                    Google One-Tap SDK        NextAuth              Google API
 │                       │                         │                     │
 │ 1.页面加载             │                         │                     │
 │ useOneTapLogin() 触发  │                         │                     │
 │──────────────────────>│                         │                     │
 │                       │ 2.显示 One-Tap 弹窗     │                     │
 │ 3.用户点击账号         │                         │                     │
 │                       │ 4.credential (ID Token)│                     │
 │                       │<────────────────────────│                     │
 │                       │                         │                     │
 │ 5.signIn("google-one-tap", { credential })     │                     │
 │───────────────────────────────────────────────>│                     │
 │                       │                         │ 6.CredentialsProvider│
 │                       │                         │   authorize()       │
 │                       │                         │   ✅ verifyIdToken  │
 │                       │                         │   （校验 aud/iss/   │
 │                       │                         │    exp/签名，P-1.11）│
 │                       │                         │────────────────────>│
 │                       │                         │   payload (email,   │
 │                       │                         │    sub, name, pic)  │
 │                       │                         │<────────────────────│
 │                       │                         │                     │
 │                       │                         │ 7.后续同 OAuth 流程  │
 │                       │                         │   jwt callback ->   │
 │                       │                         │   saveUser()        │
```

### 3.3 GitHub OAuth 登录

流程与 Google OAuth 一致，Provider 改为 GitHub，环境变量为 `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`。

## 4. JWT Callback 详解

```typescript
// auth/config.ts

async jwt({ token, user, account }) {
  // 仅在首次登录时执行（user 和 account 有值）
  if (user && user.email && account) {
    const dbUser: User = {
      uuid: getUuid(),           // 生成 UUID v4
      email: user.email,
      nickname: user.name || "",
      avatar_url: user.image || "",
      signin_type: account.type,        // "oauth"
      signin_provider: account.provider, // "google" / "github"
      signin_openid: account.providerAccountId,
      created_at: getIsoTimestr(),
      signin_ip: await getClientIp(),
    };

    // saveUser 内部逻辑:
    // 1. findUserByEmail - 查是否已存在
    // 2. 不存在 -> insertUser + increaseCredits(10积分, 1年有效)
    // 3. 已存在 -> 复用原 uuid 和 created_at
    const savedUser = await saveUser(dbUser);

    // 将数据库用户信息写入 JWT token
    token.user = {
      uuid: savedUser.uuid,
      email: savedUser.email,
      nickname: savedUser.nickname,
      avatar_url: savedUser.avatar_url,
      created_at: savedUser.created_at,
    };
  }
  return token;
}
```

**关键点**：
- JWT token 中存储了 `uuid`，后续所有请求通过 `session.user.uuid` 获取用户标识
- `saveUser` 是幂等的：已存在用户不会重复创建或重复赠送积分
- 新用户赠送 10 积分（`CreditsAmount.NewUserGet`），1 年后过期

## 5. Session Callback

```typescript
async session({ session, token, user }) {
  // 将 JWT token 中的 user 信息注入 session
  if (token && token.user) {
    session.user = token.user;
  }
  return session;
}
```

**Session 类型扩展** (`types/next-auth.d.ts`)：

```typescript
declare module "next-auth" {
  interface JWT {
    user?: {
      uuid?: string;
      nickname?: string;
      avatar_url?: string;
      created_at?: string;
    };
  }

  interface Session {
    user: {
      uuid?: string;
      nickname?: string;
      avatar_url?: string;
      created_at?: string;
    } & DefaultSession["user"];
  }
}
```

## 6. 前端鉴权

### 6.1 客户端鉴权

```typescript
// contexts/app.tsx
const { data: session } = useSession();

useEffect(() => {
  if (session && session.user) {
    fetchUserInfo();  // 调用 /api/get-user-info 获取完整用户信息
  }
}, [session]);
```

### 6.2 服务端鉴权（页面级）

**用户控制台** (`app/[locale]/(default)/(console)/layout.tsx`)：

```typescript
const userInfo = await getUserInfo();
if (!userInfo) {
  redirect("/auth/signin");
}
```

**管理后台** (`app/[locale]/(admin)/layout.tsx`)：

```typescript
const userInfo = await getUserInfo();
if (!userInfo || !userInfo.email) {
  redirect("/auth/signin");
}

const adminEmails = process.env.ADMIN_EMAILS?.split(",");
if (!adminEmails?.includes(userInfo?.email)) {
  return <Empty message="No access" />;
}
```

### 6.3 API 鉴权

```typescript
// services/user.ts
export async function getUserUuid() {
  // 方式 1: API Key
  const token = await getBearerToken();
  if (token && token.startsWith("sk-")) {
    return await getUserUuidByApiKey(token) || "";
  }

  // 方式 2: NextAuth Session
  const session = await auth();
  return session?.user?.uuid || "";
}
```

## 7. 鉴权安全问题

| # | 问题 | 严重程度 | 状态 | 说明 |
|---|------|----------|------|------|
| 1 | ~~One-Tap 不校验 aud~~ | ~~致命~~ | ✅ 已修复 | P-1.11：verifyIdToken 校验 aud/iss/exp |
| 2 | ~~findUserByEmail 无 provider 维度~~ | ~~高~~ | ✅ 已修复 | P-1.11：findUserByEmail(email, provider) |
| 3 | ~~并发注册无幂等~~ | ~~高~~ | ✅ 已修复 | P-1.11：insertUser 捕获唯一约束冲突后重查 |
| 4 | ~~/api/update-invite 无认证~~ | ~~高~~ | ✅ 已修复 | P-1.4：user_uuid 从 session 获取 |
| 5 | ~~无 RBAC 角色系统~~ | ~~中~~ | ✅ 已修复 | operator / admin / super_admin 三级；getAdminUser 拦截 banned |
| 6 | **验证码消费逻辑疑似在真实环境失败（P0）** | **阻断** | ⚠️ No-Go | `models/verification.ts` 使用 `.update().select("id")` 后检查 `count`，但未传 `count: "exact"`，Supabase/PostgREST 在此模式下 `count` 通常为 null。测试中人为 mock `count: 1`，不能证明真实行为。结果：邮箱登录/重置验证码可能永远消费失败。应检查 `data?.length` 或显式请求精确 count，并加真实 Postgres 集成测试。 |
| 7 | **OAuth 同邮箱不合并（Account Linking）** | 高（P1） | ⚠️ 待设计 | 多 provider 登录同一邮箱会创建多个独立用户，积分/订单/订阅拆散。需定义：verified email 合并策略、provider subject 唯一键、合并审批、冲突处理。不能仅凭客户端 email 合并。 |
| 8 | **删除/封禁后会话与 API Key 不即时失效** | 高（P1） | ⚠️ 待加固 | 用户被删除或封禁后，已签发的 JWT session 和 API Key 仍可使用，直到过期。应：封禁/删除时在服务端每次请求重新校验用户状态；API Key 状态实时查库或缓存短 TTL；提供主动撤销 session/API key 接口。 |
| 9 | **`getUserUuid` 异常时 fail-open 风险** | 高（P1） | ⚠️ 待加固 | 数据库查询异常、用户状态未知或 session 字段缺失时，任何收费/后台/敏感读操作应 fail-closed（返回 401/5xx），不能把"查不到用户"当成匿名用户继续执行高价值路径。 |
| 10 | API Key 无速率限制 | 中 | 待落地 | sk- 密钥可被暴力使用 |
| 11 | ADMIN_EMAILS 为明文环境变量 | 低 | 已知边界 | 管理员邮箱列表明文存储 |
| 12 | 无 Session 过期配置 | 低 | 已知边界 | 使用 NextAuth 默认 30 天 |
| 13 | 无刷新 Token 机制 | 低 | 已知边界 | JWT 过期后需重新登录 |
| 14 | next-auth beta 版本 | 中 | 已知风险 | 5.0.0-beta.25 可能有 breaking change |
| 15 | **默认超级管理员弱口令（P0-3）** | **阻断** | **No-Go** | 迁移 0012 无条件创建 `admin@shipany.local / 123456 / super_admin`，「首次强制改密」只是登录后跳转，账号在迁移执行完即可用公开凭据登录，谁先登谁改密。修法：条件建号 + 随机密码 + pending_activation + 生产不建号（详见 boundary-spec §九 N-7） |
| 16 | **账号风险状态机缺失（第九轮）** | 高 | 待设计 | 只有通用封禁（banned），没有资金风控的 `restricted` / 欠款 / 冻结消费概念；退款滥用、拒付、债务未清偿三类场景无处落地。需在用户状态机上增加 `restricted`（清偿前禁止消费与再次下单）、欠款记录与人工审批流（详见 docs/05 §7.3） |

---

## 8. 账号删除与 GDPR

> ⚠️ **文档与实现不一致（已知）**：
> - `docs/11-telemetry-analytics.md` 一处声称 GDPR 删除联动已完成，一处列为 v3；
> - 代码中 `deleteUser` 的 PostHog 删除联动**未实现**；
> - 当前删除为软删除 + 匿名化 email，但保留 `password_hash`、`signin_openid`、`signin_ip`。

**当前实现**：`app/api/user/delete-account` 路由执行软删除，匿名化邮箱。

**待补齐（严格 GDPR 口径）**：
1. PostHog `deleteUser` / `$delete` 事件联动
2. `password_hash`、`signin_openid`、`signin_ip` 擦除或置空
3. 订单/发票数据按法定期限保留（不能删），与行为数据区分
4. 数据导出功能（用户可下载全部个人数据）
5. 删除确认邮件 + 冷静期（可选）
