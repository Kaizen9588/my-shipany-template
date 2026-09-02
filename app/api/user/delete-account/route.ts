import { respData, respErr } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { serverClient } from "@/models/db";
import { getIsoTimestr } from "@/lib/time";
import { deleteTelemetryUser } from "@/lib/telemetry/server";

/**
 * POST /api/user/delete-account —— 删除账号（6.17 GDPR）
 *
 * 删除策略（docs/04 §8，2026-09-01 扩展）：
 * - 软删除 users 记录（status='deleted'）
 * - 清除个人信息：nickname/avatar_url 置空，email 改为 deleted+{uuid}@deleted.com
 *   （避免违反 UNIQUE(email, provider) 约束）；password_hash/signin_openid/signin_ip 置空
 * - 撤销全部 API Key
 * - 运营/审计日志匿名化（迁移 0035 private.anonymize_user_personal_data）：
 *   op_events.subject_uuid、audit_logs 的 uuid 字段改占位符、ip 置空、
 *   detail 内直接标识符移除；事件本身保留供财务/安全审计追溯
 * - PostHog $delete_person 事件联动（服务端删除 person profile）
 * - 保留 orders/credits 记录（财务合规，税务要求保留 7 年）
 */
export async function POST() {
  try {
    const user_uuid = await getUserUuid();
    if (!user_uuid) {
      return respErr("no auth", 401);
    }

    const supabase = serverClient();
    const { data: user } = await supabase
      .from("users")
      .select("uuid")
      .eq("uuid", user_uuid)
      .single();
    if (!user) {
      return respErr("user not found");
    }

    const deletedEmail = `deleted+${user_uuid}@deleted.com`;

    const { error } = await supabase
      .from("users")
      .update({
        status: "deleted",
        email: deletedEmail,
        nickname: "",
        avatar_url: "",
        // GDPR：清除登录凭据，避免账号删除后仍可登录/凭据残留
        password_hash: null,
        password_updated_at: null,
        signin_openid: "",
        signin_ip: "",
        updated_at: getIsoTimestr(),
      })
      .eq("uuid", user_uuid);
    if (error) {
      throw error;
    }

    // 撤销该用户所有 API Key，避免账号删除后仍可凭历史 sk- 调用 API
    await supabase
      .from("apikeys")
      .update({ status: "deleted" })
      .eq("user_uuid", user_uuid);

    // 运营/审计日志匿名化（subject_uuid/ip/detail）；资金 RPC 同 schema，service_role 可执行。
    // 吞错：匿名化失败不阻塞删除主流程，可由人工对账补齐（占位符规则可幂等重放）。
    try {
      const { error: anonError } = await supabase
        .schema("private")
        .rpc("anonymize_user_personal_data", { p_user_uuid: user_uuid });
      if (anonError) {
        console.error("[user/delete-account] log anonymization failed:", anonError.message);
      }
    } catch (anonE) {
      console.error("[user/delete-account] log anonymization failed:", anonE);
    }

    // PostHog 联动：服务端发送 $delete_person（吞错，未配置时静默跳过）
    deleteTelemetryUser(user_uuid);

    // 通知客户端登出
    return respData({ deleted: true });
  } catch (e: any) {
    console.error("[user/delete-account] failed:", e);
    return respErr("delete account failed");
  }
}
