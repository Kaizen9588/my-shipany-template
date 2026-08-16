import { respData, respErr } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { countUnreadNotifications, getNotifications } from "@/models/notification";

/**
 * GET /api/notifications —— 站内通知列表（6.14，v1 轮询拉取）
 */
export async function GET(req: Request) {
  try {
    const user_uuid = await getUserUuid();
    if (!user_uuid) {
      return respErr("no auth", 401);
    }

    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;

    const [notifications, unread] = await Promise.all([
      getNotifications(user_uuid, page),
      countUnreadNotifications(user_uuid),
    ]);

    return respData({ notifications, unread });
  } catch (e) {
    console.error("[notifications] failed:", e);
    return respErr("get notifications failed");
  }
}
