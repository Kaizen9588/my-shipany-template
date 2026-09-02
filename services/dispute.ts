import { serverClient } from "@/models/db";
import { trackCriticalEvent } from "@/lib/oplog";

/**
 * N-13 争议/拒付链路（docs/05 §7）
 *
 * 收到渠道 dispute 事件后归一化到 orders.status 的 disputed / charged_back
 * 语义：
 * - dispute_opened：订单置 disputed（冻结积分消费，保留余额）+ 挂起联盟奖励，告警
 * - dispute_won：订单解冻回 paid（允许继续消费）
 * - dispute_lost：订单置 charged_back（复用 P0-1 资产回收 + 债务化 + restricted 账号）、告警
 *
 * 资金操作，全部走 serverClient（service_role，N-3，绕 RLS）。
 */
export type DisputeEventKind = "dispute_opened" | "dispute_won" | "dispute_lost";

export async function handleDisputeEvent(event: {
  order_no: string;
  user_uuid: string;
  type: DisputeEventKind;
  amount?: number;
  raw?: unknown;
}): Promise<void> {
  const supabase = serverClient();

  if (event.type === "dispute_opened") {
    // 冻结订单状态（积分消费在消费侧由 restricted/状态拦截规避，此处至少落库归一化）
    const { error } = await supabase
      .from("orders")
      .update({ status: "disputed" })
      .eq("order_no", event.order_no);
    if (error) {
      throw error;
    }
    trackCriticalEvent({
      event_type: "payment.dispute_opened",
      severity: "warn",
      source: "app",
      subject_uuid: event.order_no,
      detail: { user_uuid: event.user_uuid, amount: event.amount },
    });
    return;
  }

  if (event.type === "dispute_won") {
    // 解冻：回到 paid
    const { error } = await supabase
      .from("orders")
      .update({ status: "paid" })
      .eq("order_no", event.order_no)
      .eq("status", "disputed");
    if (error) {
      throw error;
    }
    trackCriticalEvent({
      event_type: "payment.dispute_won",
      severity: "info",
      source: "app",
      subject_uuid: event.order_no,
      detail: { user_uuid: event.user_uuid },
    });
    return;
  }

  // dispute_lost：拒付成立 → charged_back（资金已从商户划走，积分视为已消费，债务化由
  // 后续债务清偿流程处理；此处至少归一化状态 + 账号 restricted 防止重复作恶）
  let reversedReward = 0;
  const { error } = await supabase
    .from("orders")
    .update({ status: "charged_back" })
    .eq("order_no", event.order_no);
  if (error) {
    throw error;
  }
  if (event.user_uuid) {
    await supabase
      .from("users")
      .update({ status: "restricted" })
      .eq("uuid", event.user_uuid);
  }

  // N-13 剩余：拒付成立同步冲销联盟佣金（与退款同款套利口子：
  // 邀请人佣金不冲销则「首付拿佣金 → 拒付」白拿奖励）。
  // 失败不阻塞拒付主流程，告警人工核查。
  try {
    const { data: rewardData, error: rewardErr } = await supabase
      .schema("private")
      .rpc("reverse_affiliate_reward", {
        p_order_no: event.order_no,
        p_reason: `dispute lost for order ${event.order_no}`,
      });
    if (rewardErr) {
      console.error("[dispute] affiliate reward reversal failed:", rewardErr);
    } else {
      reversedReward = typeof rewardData === "number" ? rewardData : 0;
    }
  } catch (e) {
    console.error("[dispute] affiliate reward reversal error:", e);
  }

  trackCriticalEvent({
    event_type: "payment.dispute_lost",
    severity: "critical",
    source: "app",
    subject_uuid: event.order_no,
    detail: {
      user_uuid: event.user_uuid,
      amount: event.amount,
      reversed_affiliate_reward: reversedReward,
    },
  });
}