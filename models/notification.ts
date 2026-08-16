import { getSupabaseClient } from "@/models/db";
import { getUuid } from "@/lib/hash";

/**
 * 站内通知模型（6.14）
 * 支付成功 / 积分变动 / 系统公告；轮询 + SSE 拉取。
 */

export interface Notification {
  uuid: string;
  user_uuid: string;
  type: string; // payment / credit / system
  title: string;
  content?: string;
  is_read: boolean;
  created_at: string;
}

export async function createNotification({
  user_uuid,
  type,
  title,
  content = "",
}: {
  user_uuid: string;
  type: string;
  title: string;
  content?: string;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("notifications").insert({
    uuid: getUuid(),
    user_uuid,
    type,
    title,
    content,
    is_read: false,
  });
  if (error) {
    console.error("[notification] create failed:", error.message);
  }
}

export async function getNotifications(
  user_uuid: string,
  page: number = 1,
  limit: number = 30
): Promise<Notification[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_uuid", user_uuid)
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) {
    return [];
  }
  return data as Notification[];
}

export async function countUnreadNotifications(
  user_uuid: string
): Promise<number> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_uuid", user_uuid)
    .eq("is_read", false);
  if (error) {
    return 0;
  }
  return count || 0;
}

/** 标记已读（单个或全部） */
export async function markNotificationsRead(
  user_uuid: string,
  uuid?: string
): Promise<void> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_uuid", user_uuid)
    .eq("is_read", false);
  if (uuid) {
    query = query.eq("uuid", uuid);
  }
  await query;
}
