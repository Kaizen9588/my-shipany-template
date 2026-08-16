import {
  CreditsAmount,
  CreditsTransType,
  InsufficientCreditsError,
  decreaseCredits,
} from "@/services/credit";
import { respData, respErr } from "@/lib/resp";

import { getUserUuid } from "@/services/user";

export async function POST(req: Request) {
  try {
    const { message } = await req.json();
    if (!message) {
      return respErr("invalid params");
    }

    const user_uuid = await getUserUuid();
    if (!user_uuid) {
      return respErr("no auth");
    }

    // decrease credits for ping
    await decreaseCredits({
      user_uuid,
      trans_type: CreditsTransType.Ping,
      credits: CreditsAmount.PingCost,
    });

    return respData({
      pong: `received message: ${message}`,
    });
  } catch (e) {
    // P-1.2：积分不足时返回明确错误信息
    if (e instanceof InsufficientCreditsError) {
      return respErr(`insufficient credits: ${e.balance}`);
    }

    console.log("test failed:", e);
    return respErr("test failed");
  }
}
