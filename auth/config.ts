import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { NextAuthConfig } from "next-auth";
import { OAuth2Client } from "google-auth-library";
import { Provider } from "next-auth/providers/index";
import { User } from "@/types/user";
import { getClientIp } from "@/lib/ip";
import { getIsoTimestr } from "@/lib/time";
import { getUuid } from "@/lib/hash";
import { saveUser } from "@/services/user";
import { findUserByEmail, findUserByUuid } from "@/models/user";
import {
  clearLoginFailure,
  isLoginLocked,
  recordLoginFailure,
} from "@/lib/login-guard";
import { verifyPassword } from "@/lib/password";
import { logger } from "@/lib/logger";

/** 日志脱敏：只保留首字符，避免明文邮箱进日志（复审 2） */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) {
    return "***";
  }
  return `${email[0]}***@${email.slice(at + 1)}`;
}

/** jwt 回调中暂存的用户字段（避免 NextAuth v5 JWT 类型增强不稳定） */
type SessionJwtUser = {
  uuid?: string;
  email?: string;
  nickname?: string;
  avatar_url?: string;
  created_at?: string;
  mustChangePassword?: boolean;
  role?: string;
  status?: string;
};

let providers: Provider[] = [];

// Google One Tap Auth
if (
  process.env.NEXT_PUBLIC_AUTH_GOOGLE_ONE_TAP_ENABLED === "true" &&
  process.env.NEXT_PUBLIC_AUTH_GOOGLE_ID
) {
  providers.push(
    CredentialsProvider({
      id: "google-one-tap",
      name: "google-one-tap",

      credentials: {
        credential: { type: "text" },
      },

      async authorize(credentials, req) {
        const googleClientId = process.env.NEXT_PUBLIC_AUTH_GOOGLE_ID;
        if (!googleClientId) {
          console.log("invalid google auth config");
          return null;
        }

        const token = String(credentials?.credential || "");
        if (!token) {
          return null;
        }

        // P-1.11：改用 google-auth-library verifyIdToken，
        // 内部校验 aud（必须等于本应用 Client ID）、iss、exp 与签名。
        // 原实现不校验 aud，攻击者用任意应用的合法 Google token 即可伪造登录；
        // 且 tokeninfo 端点已被 Google deprecated。
        try {
          const client = new OAuth2Client(googleClientId);
          const ticket = await client.verifyIdToken({
            idToken: token,
            audience: googleClientId,
          });
          const payload = ticket.getPayload();
          if (!payload) {
            console.log("invalid payload from token");
            return null;
          }

          const {
            email,
            sub,
            given_name,
            family_name,
            email_verified,
            picture: image,
          } = payload;
          if (!email) {
            console.log("invalid email in payload");
            return null;
          }

          const user = {
            id: sub,
            name: [given_name, family_name].join(" "),
            email,
            image,
            emailVerified: email_verified ? new Date() : null,
          };

          return user;
        } catch (e) {
          console.log("Failed to verify token: ", e);
          return null;
        }
      },
    })
  );
}

// Google Auth
if (
  process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === "true" &&
  process.env.AUTH_GOOGLE_ID &&
  process.env.AUTH_GOOGLE_SECRET
) {
  providers.push(
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    })
  );
}

// Email & Password Auth（6.4）
// 密码哈希存数据库（users.password_hash），绝不入 JWT；
// 登录失败限制（同邮箱 5 次锁定 15 分钟 / 同 IP 10 次封禁 1 小时）见 lib/login-guard.ts
providers.push(
  CredentialsProvider({
    id: "credentials",
    name: "Email & Password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = String(credentials?.email || "")
        .trim()
        .toLowerCase();
      const password = String(credentials?.password || "");
      const ip = await getClientIp();

      if (!email || !password) {
        return null;
      }

      const lock = isLoginLocked(email, ip);
      if (lock.locked) {
        logger.warn("[credentials] login locked:", maskEmail(email));
        return null;
      }

      const user = await findUserByEmail(email, "credentials");
      if (!user?.password_hash) {
        recordLoginFailure(email, ip);
        return null;
      }
      // 已封禁/已删除账号禁止密码登录
      if (user.status === "banned" || user.status === "deleted") {
        logger.warn("[credentials] login blocked:", maskEmail(email), user.status);
        return null;
      }

      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        recordLoginFailure(email, ip);
        return null;
      }

      clearLoginFailure(email, ip);

      return {
        id: user.uuid || user.id?.toString() || email,
        email: user.email,
        name: user.nickname,
        image: user.avatar_url,
      };
    },
  })
);

// Github Auth
if (
  process.env.NEXT_PUBLIC_AUTH_GITHUB_ENABLED === "true" &&
  process.env.AUTH_GITHUB_ID &&
  process.env.AUTH_GITHUB_SECRET
) {
  providers.push(
    GitHubProvider({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    })
  );
}

export const providerMap = providers
  .map((provider) => {
    if (typeof provider === "function") {
      const providerData = provider();
      return { id: providerData.id, name: providerData.name };
    } else {
      return { id: provider.id, name: provider.name };
    }
  })
  .filter((provider) => provider.id !== "google-one-tap");

export const authOptions: NextAuthConfig = {
  providers,
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async signIn({ user, account, profile, email, credentials }) {
      const isAllowedToSignIn = true;
      if (isAllowedToSignIn) {
        return true;
      } else {
        // Return false to display a default error message
        return false;
        // Or you can return a URL to redirect to:
        // return '/unauthorized'
      }
    },
    async redirect({ url, baseUrl }) {
      // Allows relative callback URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Allows callback URLs on the same origin
      else if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
    async session({ session, token }) {
      const jwtUser = (token as { user?: SessionJwtUser }).user;
      if (jwtUser) {
        session.user = { ...session.user, ...jwtUser };
      }
      return session;
    },
    async jwt({ token, user, account }) {
      // Persist the OAuth access_token and or the user id to the token right after signin
      try {
        if (user && user.email && account) {
          const dbUser: User = {
            uuid: getUuid(),
            email: user.email,
            nickname: user.name || "",
            avatar_url: user.image || "",
            signin_type: account.type,
            signin_provider: account.provider,
            signin_openid: account.providerAccountId,
            created_at: getIsoTimestr(),
            signin_ip: await getClientIp(),
          };

          try {
            const savedUser = await saveUser(dbUser);
            // 从数据库读取完整资料（含 role/status/must_change_password），
            // 确保默认管理员首次登录能命中强制改密流程。
            const persisted = await findUserByUuid(savedUser.uuid || "");
            const jwtUser = token as { user?: SessionJwtUser };
            jwtUser.user = {
              uuid: savedUser.uuid,
              email: savedUser.email,
              nickname: savedUser.nickname,
              avatar_url: savedUser.avatar_url,
              created_at: savedUser.created_at,
              mustChangePassword: !!persisted?.must_change_password,
              role: persisted?.role,
              status: persisted?.status,
            };
          } catch (e) {
            console.error("save user failed:", e);
          }
        } else if ((token as { user?: SessionJwtUser }).user?.uuid) {
          // 每次会话校验时刷新关键属性（封禁 / 角色 / 强制改密即时生效）
          const jwtUser = token as { user?: SessionJwtUser };
          const persisted = await findUserByUuid(jwtUser.user?.uuid || "");
          if (persisted) {
            jwtUser.user = {
              ...(jwtUser.user || {}),
              role: persisted.role,
              status: persisted.status,
              mustChangePassword: !!persisted.must_change_password,
            };
          }
        }
        return token;
      } catch (e) {
        console.error("jwt callback error:", e);
        return token;
      }
    },
  },
};
