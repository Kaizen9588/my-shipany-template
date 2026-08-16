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

| # | 问题 | 严重程度 | 说明 |
|---|------|----------|------|
| 1 | ~~One-Tap 不校验 aud~~ | ~~致命~~ | ✅ P-1.11 已修复：verifyIdToken 校验 aud/iss/exp |
| 2 | ~~findUserByEmail 无 provider 维度~~ | ~~高~~ | ✅ P-1.11 已修复：findUserByEmail(email, provider)，saveUser 传 signin_provider |
| 3 | ~~并发注册无幂等~~ | ~~高~~ | ✅ P-1.11 已修复：insertUser 捕获唯一约束冲突后重查复用 |
| 4 | ~~/api/update-invite 无认证~~ | ~~高~~ | ✅ P-1.4 已修复：user_uuid 从 session 获取 |
| 5 | ~~无 RBAC 角色系统~~ | ~~中~~ | ✅ RBAC 已落地且分级（2.7 修复）：operator（看板/查询）/ admin（退款/调积分/封禁）/ super_admin（角色授予，唯一可授予 super_admin）；getAdminUser 拦截 banned 账号；ADMIN_EMAILS 白名单等价 super_admin |
| 6 | API Key 无速率限制 | 中 | sk- 密钥可被暴力使用（6.18 待落地） |
| 7 | ADMIN_EMAILS 为明文环境变量 | 低 | 管理员邮箱列表明文存储 |
| 8 | 无 Session 过期配置 | 低 | 使用 NextAuth 默认 30 天 |
| 9 | 无刷新 Token 机制 | 低 | JWT 过期后需重新登录 |
| 10 | next-auth beta 版本 | 中 | 5.0.0-beta.25 可能有 breaking change |
