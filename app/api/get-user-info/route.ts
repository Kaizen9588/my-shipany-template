import { respData, respErr, respJson } from "@/lib/resp";

import { findUserByUuid } from "@/models/user";
import { getUserUuid, toSafeUser } from "@/services/user";

export async function POST(req: Request) {
  try {
    const user_uuid = await getUserUuid();
    if (!user_uuid) {
      return respJson(-2, "no auth");
    }

    const user = await findUserByUuid(user_uuid);
    if (!user) {
      return respErr("user not exist");
    }

    // 2.8：白名单出口，password_hash/role/signin_ip 等不再离开服务端
    return respData(toSafeUser(user));
  } catch (e) {
    console.log("get user info failed: ", e);
    return respErr("get user info failed");
  }
}
