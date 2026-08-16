import { respData, respErr } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { getSupabaseClient } from "@/models/db";
import { getIsoTimestr } from "@/lib/time";

/**
 * POST /api/user/delete-account —— 删除账号（6.17 GDPR）
 *
 * 删除策略（docs/6.17）：
 * - 软删除 users 记录（status='deleted'）
 * - 清除个人信息：nickname/avatar_url 置空，email 改为 deleted+{uuid}@deleted.com
 *   （避免违反 UNIQUE(email, provider) 约束）
 * - 保留 orders/credits 记录（财务合规，税务要求保留 7 年）
 */
export async function POST() {
  try {
    const user_uuid = await getUserUuid();
    if (!user_uuid) {
      return respErr("no auth", 401);
    }

    const supabase = getSupabaseClient();
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
        updated_at: getIsoTimestr(),
      })
      .eq("uuid", user_uuid);
    if (error) {
      throw error;
    }

    // 通知客户端登出
    return respData({ deleted: true });
  } catch (e: any) {
    console.error("[user/delete-account] failed:", e);
    return respErr("delete account failed");
  }
}
