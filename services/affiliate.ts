import { findAffiliateByOrderNo, insertAffiliate } from "@/models/affiliate";
import { getAffiliateRewardCredits } from "@/models/credit";
import { createNotification } from "@/models/notification";

import { AffiliateRewardAmount } from "./constant";
import { AffiliateRewardPercent } from "./constant";
import { AffiliateStatus } from "./constant";
import { Order } from "@/types/order";
import { findUserByUuid } from "@/models/user";
import { getIsoTimestr } from "@/lib/time";
import { fireAndForgetEmail } from "@/lib/email";
import { getSupabaseClient } from "@/models/db";

/**
 * 记录联盟奖励（支付成功路径 P-1.3 起由存储过程 handle_order_payment 处理，
 * 本函数保留作为 JS 侧工具 / 未来补偿任务使用）
 */
export async function updateAffiliateForOrder(order: Order) {
  try {
    const user = await findUserByUuid(order.user_uuid);
    if (user && user.uuid && user.invited_by && user.invited_by !== user.uuid) {
      const affiliate = await findAffiliateByOrderNo(order.order_no);
      if (affiliate) {
        return;
      }

      // P-1.8 问题 4：奖励按比例计算并封顶，而非固定 $50
      // reward_amount = min(order.amount * reward_percent / 100, max_reward)
      const reward_amount = Math.min(
        Math.floor((order.amount * AffiliateRewardPercent.Paid) / 100),
        AffiliateRewardAmount.Paid
      );

      await insertAffiliate({
        user_uuid: user.uuid,
        invited_by: user.invited_by,
        created_at: getIsoTimestr(),
        status: AffiliateStatus.Completed,
        paid_order_no: order.order_no,
        paid_amount: order.amount,
        reward_percent: AffiliateRewardPercent.Paid,
        reward_amount,
      });
    }
  } catch (e) {
    console.log("update affiliate for order failed: ", e);
    throw e;
  }
}

/**
 * 联盟奖励到账通知（迁移 0036：方案 A 奖励自动转积分，docs/05 §3.4）
 *
 * 发放本体在 private.handle_order_payment 存储过程内（与佣金记录同事务原子），
 * 应用层无法直接感知「本次支付是否真的发放了奖励」——以存在性判断代替：
 * 该订单有 completed 佣金 + 邀请人名下有该订单的 affiliate_reward 积分流水，
 * 即视为已发放，通知只补发一次；佣金不存在或已 reversed（冲销）则不发。
 * fire-and-forget：失败不影响支付主流程。
 */
export async function notifyAffiliateReward(order_no: string): Promise<void> {
  try {
    const affiliate = await findAffiliateByOrderNo(order_no);
    if (!affiliate || affiliate.status !== AffiliateStatus.Completed) {
      return;
    }

    const inviter = await findUserByUuid(affiliate.invited_by);
    if (!inviter?.email) {
      return;
    }

    // 佣金存在≠积分已发（历史佣金行没有对应积分）；以该订单的奖励流水为准
    const supabase = getSupabaseClient();
    const { data: rewardRow } = await supabase
      .from("credits")
      .select("credits")
      .eq("user_uuid", affiliate.invited_by)
      .eq("trans_type", "affiliate_reward")
      .eq("order_no", order_no)
      .limit(1)
      .maybeSingle();
    if (!rewardRow || (rewardRow.credits ?? 0) <= 0) {
      return;
    }

    const total = await getAffiliateRewardCredits(affiliate.invited_by);

    void createNotification({
      user_uuid: affiliate.invited_by,
      type: "affiliate",
      title: "Referral reward received",
      content: `Your invite reward: ${rewardRow.credits} credits added to your account.`,
    });

    fireAndForgetEmail({
      to: inviter.email,
      template: "affiliate_reward",
      variables: {
        credits: rewardRow.credits,
        total_credits: total,
      },
      category: "transactional",
    });
  } catch (e) {
    console.error("[affiliate] reward notify failed:", e);
  }
}
