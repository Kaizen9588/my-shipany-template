import { getSupabaseClient } from "@/models/db";

/**
 * 匿名试用额度模型（docs/14）
 * anonymous_usage 按 (anonymous_key, usage_date) 记录每日用量，
 * 额度窗口只关心近期记录，历史行无业务价值，需定期清理防膨胀（docs/14 §2.6）。
 */

/** 清理 days 天前的匿名用量记录，返回删除行数（失败不抛出，返回 0） */
export async function cleanupAnonymousUsage(days = 30): Promise<number> {
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10); // usage_date 为 DATE 类型
  const { data, error } = await supabase
    .from("anonymous_usage")
    .delete()
    .lt("usage_date", cutoff)
    .select("id");

  if (error) {
    console.error("[anonymous-usage] cleanup failed:", error.message);
    return 0;
  }
  return (data || []).length;
}
