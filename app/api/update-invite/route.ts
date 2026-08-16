import {
  AffiliateRewardAmount,
  AffiliateRewardPercent,
  AffiliateStatus,
} from "@/services/constant";
import {
  findUserByInviteCode,
  findUserByUuid,
  updateUserInvitedBy,
} from "@/models/user";
import { respData, respErr } from "@/lib/resp";
import { auth } from "@/auth";
import { toSafeUser } from "@/services/user";

import { getIsoTimestr } from "@/lib/time";
import { insertAffiliate } from "@/models/affiliate";

export async function POST(req: Request) {
  try {
    // P-1.4：user_uuid 一律从 NextAuth session 获取，不再信任请求体，
    // 防止任何人伪造他人 user_uuid 绑定邀请关系
    const { invite_code } = await req.json();
    if (!invite_code) {
      return respErr("invalid params");
    }

    const session = await auth();
    const user_uuid = session?.user?.uuid;
    if (!user_uuid) {
      return respErr("no auth, please sign-in");
    }

    // check invite user
    const inviteUser = await findUserByInviteCode(invite_code);
    if (!inviteUser) {
      return respErr("invite user not found");
    }

    // check current user
    const user = await findUserByUuid(user_uuid);
    if (!user) {
      return respErr("user not found");
    }

    if (user.uuid === inviteUser.uuid || user.email === inviteUser.email) {
      return respErr("can't invite yourself");
    }

    if (user.invited_by) {
      return respErr("user already has invite user");
    }

    user.invited_by = inviteUser.uuid;

    // update invite user uuid
    await updateUserInvitedBy(user_uuid, inviteUser.uuid);

    await insertAffiliate({
      user_uuid: user_uuid,
      invited_by: inviteUser.uuid,
      created_at: getIsoTimestr(),
      status: AffiliateStatus.Pending,
      paid_order_no: "",
      paid_amount: 0,
      reward_percent: AffiliateRewardPercent.Invited,
      reward_amount: AffiliateRewardAmount.Invited,
    });

    // 2.8：白名单出口，不再整行返回
    return respData(toSafeUser(user));
  } catch (e) {
    console.error("update invited by failed: ", e);
    return respErr("update invited by failed");
  }
}
