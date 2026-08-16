"use server";

import { ApikeyStatus, insertApikey } from "@/models/apikey";
import { Apikey } from "@/types/apikey";
import { getIsoTimestr } from "@/lib/time";
import { getNonceStr, hashString } from "@/lib/hash";
import { getUserUuid } from "@/services/user";
import { TelemetryEvents, trackServer } from "@/lib/telemetry/server";

/**
 * 创建 API Key（P-1.5）
 * - 数据库只存 SHA-256 哈希，不存明文
 * - 明文 key 仅此一次返回给调用方展示，之后无法再获取
 */
export async function createApiKeyAction(title: string): Promise<string> {
  const user_uuid = await getUserUuid();
  if (!user_uuid) {
    throw new Error("no auth");
  }

  const trimmedTitle = (title || "").trim();
  if (!trimmedTitle) {
    throw new Error("invalid params");
  }

  const key = `sk-${getNonceStr(32)}`;

  const apikey: Apikey = {
    user_uuid,
    api_key: hashString(key),
    key_prefix: key.slice(0, 8),
    title: trimmedTitle,
    created_at: getIsoTimestr(),
    status: ApikeyStatus.Created,
  };

  await insertApikey(apikey);

  // 6.5：服务端埋点（事务后调用，吞错不阻塞）
  trackServer({
    name: TelemetryEvents.ApiKeyCreated,
    distinctId: user_uuid,
  });

  return key;
}
