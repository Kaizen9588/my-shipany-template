import { respData, respErr } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { markNotificationsRead } from "@/models/notification";

/**
 * POST /api/notifications/read —— 标记已读（6.14）
 * 请求：{ uuid? }（不传 = 全部已读）
 */
export async function POST(req: Request) {
  try {
    const user_uuid = await getUserUuid();
    if (!user_uuid) {
      return respErr("no auth", 401);
    }

    const { uuid } = await req.json();
    await markNotificationsRead(user_uuid, uuid);

    return respData({ ok: true });
  } catch (e) {
    console.error("[notifications/read] failed:", e);
    return respErr("mark read failed");
  }
}
