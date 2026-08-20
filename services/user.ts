import { CreditsAmount, CreditsTransType } from "./credit";
import { findUserByEmail, findUserByUuid, insertUser } from "@/models/user";

import { User } from "@/types/user";
import { auth } from "@/auth";
import { fireAndForgetEmail } from "@/lib/email";
import { getOneYearLaterTimestr } from "@/lib/time";
import { getUserUuidByApiKey } from "@/models/apikey";
import { headers } from "next/headers";
import { increaseCredits } from "./credit";

export async function saveUser(user: User) {
  try {
    const provider = user.signin_provider || "";
    const existUser = await findUserByEmail(user.email, provider);
    if (!existUser) {
      try {
        await insertUser(user);
      } catch (e: any) {
        // P-1.11 问题 4：并发注册（两 tab 同时首次登录）→ 唯一约束冲突
        // 捕获后重查，已存在则复用，避免 session 无 uuid
        const isUniqueViolation =
          e && (e.code === "23505" || String(e.message || "").includes("duplicate key"));
        if (isUniqueViolation) {
          const racedUser = await findUserByEmail(user.email, provider);
          if (racedUser) {
            user.id = racedUser.id;
            user.uuid = racedUser.uuid;
            user.created_at = racedUser.created_at;
            return user;
          }
        }
        throw e;
      }

      // increase credits for new user, expire in one year
      await increaseCredits({
        user_uuid: user.uuid || "",
        trans_type: CreditsTransType.NewUser,
        credits: CreditsAmount.NewUserGet,
        expired_at: getOneYearLaterTimestr(),
      });

      // 6.2：新用户欢迎邮件（fire-and-forget，不阻塞登录流程）
      if (user.email) {
        fireAndForgetEmail({
          to: user.email,
          template: "welcome",
          variables: {
            nickname: user.nickname || "",
            credits: CreditsAmount.NewUserGet,
          },
          category: "transactional",
        });
      }
    } else {
      user.id = existUser.id;
      user.uuid = existUser.uuid;
      user.created_at = existUser.created_at;
    }

    return user;
  } catch (e) {
    console.log("save user failed: ", e);
    throw e;
  }
}

export async function getUserUuid() {
  let user_uuid = "";

  const token = await getBearerToken();

  if (token) {
    // api key
    if (token.startsWith("sk-")) {
      const user_uuid = await getUserUuidByApiKey(token);
      if (!user_uuid) {
        return "";
      }
      // M2（对抗性测试）：API Key 路径校验账号状态 —— banned/deleted 用户的
      // key 立即失效，不能继续消耗积分/调用 API
      const user = await findUserByUuid(user_uuid);
      if (user && user.status && user.status !== "active") {
        return "";
      }
      return user_uuid;
    }
  }

  const session = await auth();
  if (session && session.user && session.user.uuid) {
    // M2：session 路径 —— jwt 回调每次校验都从数据库刷新 status，
    // banned/deleted 用户会话立即失效（此前仅 admin 面板拦截，普通 API 不拦）
    if (session.user.status && session.user.status !== "active") {
      return "";
    }
    user_uuid = session.user.uuid;
  }

  return user_uuid;
}

export async function getBearerToken() {
  const h = await headers();
  const auth = h.get("Authorization");
  if (!auth) {
    return "";
  }

  return auth.replace("Bearer ", "");
}

export async function getUserEmail() {
  let user_email = "";

  const session = await auth();
  if (session && session.user && session.user.email) {
    user_email = session.user.email;
  }

  return user_email;
}

export async function getUserInfo() {
  let user_uuid = await getUserUuid();

  if (!user_uuid) {
    return;
  }

  const user = await findUserByUuid(user_uuid);

  return user;
}

/**
 * 用户数据安全出口（2.8）：API 响应只允许白名单字段。
 * 此前 get-user-info / update-invite 整行返回（select(*)），password_hash /
 * role / signin_ip / signin_openid 泄漏给客户端（持有 sk- API key 同样可达）。
 * 新增出口一律走此函数；需要敏感字段的内部逻辑直接用 models 层。
 */
export function toSafeUser(user: User): Omit<
  User,
  "password_hash" | "password_updated_at" | "signin_ip" | "signin_openid" | "status"
> {
  const {
    password_hash: _ph,
    password_updated_at: _pu,
    signin_ip: _si,
    signin_openid: _so,
    status: _st,
    ...safe
  } = user;
  return safe;
}
