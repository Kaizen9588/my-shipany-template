import { findAffiliateByOrderNo, insertAffiliate } from "@/models/affiliate";

import { AffiliateRewardAmount } from "./constant";
import { AffiliateRewardPercent } from "./constant";
import { AffiliateStatus } from "./constant";
import { Order } from "@/types/order";
import { findUserByUuid } from "@/models/user";
import { getIsoTimestr } from "@/lib/time";

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
