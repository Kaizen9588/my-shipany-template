import { respData, respErr } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { getSupabaseClient } from "@/models/db";
import { getIsoTimestr } from "@/lib/time";

/**
 * PUT /api/user/profile —— 更新个人资料（6.11）
 * 请求：{ nickname?, locale? }
 */
export async function PUT(req: Request) {
  try {
    const user_uuid = await getUserUuid();
    if (!user_uuid) {
      return respErr("no auth", 401);
    }

    const { nickname, locale } = await req.json();

    const fields: Record<string, string> = {};
    if (nickname !== undefined) {
      fields.nickname = String(nickname).trim().slice(0, 100);
    }
    if (locale !== undefined) {
      if (!["en", "zh"].includes(locale)) {
        return respErr("invalid locale");
      }
      fields.locale = locale;
    }

    if (Object.keys(fields).length === 0) {
      return respErr("nothing to update");
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("users")
      .update({ ...fields, updated_at: getIsoTimestr() })
      .eq("uuid", user_uuid);
    if (error) {
      throw error;
    }

    return respData({ updated: true, ...fields });
  } catch (e: any) {
    console.error("[user/profile] failed:", e);
    return respErr("update profile failed");
  }
}
