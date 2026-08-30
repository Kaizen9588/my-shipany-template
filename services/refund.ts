import { serverClient } from "@/models/db";
import { findOrderByOrderNo } from "@/models/order";
import { getIsoTimestr } from "@/lib/time";
import { trackCriticalEvent } from "@/lib/oplog";

/**
 * webhook 退款登记（P0-1 剩余，docs/05 §4.3）：
 * 渠道退款 webhook 一到只「登记退款事实」（refunds 退款单 + 订单置 refund_requested
 * 中间态 + 债务化准入），不再直接终态化、不直接回收积分；资金回收与终态
 * （refunded / refund_blocked）由后台人工/回收流程闭合。
 *
 * admin 退款路径（/api/admin/refund）继续走 processRefund 直接回收 + 终态：
 * 管理员已明确决策这笔退款；且 Stripe 直退后渠道不可能再推 refund webhook 重复登记。
 *
 * 资金操作，走 service_role（serverClient），绕过 RLS（N-3）。
 */
export async function registerRefundRequest({
  order_no,
  user_uuid,
  provider,
  provider_refund_id = "",
  amount,
  currency = "USD",
  reason = "",
  initiated_by = "customer",
}: {
  order_no: string;
  user_uuid: string;
  provider: string;
  provider_refund_id?: string;
  amount?: number;
  currency?: string;
  reason?: string;
  initiated_by?: "admin" | "system" | "customer";
}): Promise<{ refund_no: string }> {
  const supabase = serverClient();
  const { data, error } = await supabase.rpc("register_order_refund_request", {
    p_order_no: order_no,
    p_user_uuid: user_uuid,
    p_provider: provider,
    p_provider_refund_id: provider_refund_id,
    p_amount_cents: typeof amount === "number" ? amount : 0,
    p_currency: currency,
    p_reason: reason,
    p_initiated_by: initiated_by,
  });
  if (error) {
    throw error;
  }
  const refund_no = typeof data === "string" ? data : "";

  trackCriticalEvent({
    event_type: "payment.refund_requested",
    severity: "warn",
    source: "webhook",
    subject_uuid: order_no,
    detail: {
      provider,
      provider_refund_id,
      amount,
      refund_no,
      initiated_by,
      next: "admin/recovery flow must close the terminal state",
    },
  });

  return { refund_no };
}

/**
 * 退款扣回积分 + 订单标记 refunded（6.21，webhook 与后台退款共用）
 *
 * R3 原子化（迁移 0011）：「状态检查 + 扣积分 + 标记 refunded」由存储过程
 * process_order_refund 在一个事务中完成（订单行 FOR UPDATE），
 * admin 退款 API 与渠道退款 webhook 并发调用时只会扣一次积分；
 * 已 refunded 的订单幂等返回 0。
 *
 * 退款口径（6.1）：退款扣回全部剩余积分，近似口径 min(该订单积分, 当前余额)
 * （docs/12 §三.2：不做精确按订单追踪积分来源）
 */
export async function processRefund({
  order_no,
  amount,
  admin_uuid = "",
  reason = "",
}: {
  order_no: string;
  amount?: number;
  admin_uuid?: string;
  /** N-6：admin 闭合/发起退款的操作理由，入审计与债务 reason（webhook 登记路径不传） */
  reason?: string;
}): Promise<{ deducted_credits: number }> {
  const refund_note = `refunded at ${getIsoTimestr()}${
    amount ? ` amount=${amount}` : ""
  }`;

  // 退款是资金操作，走 service_role（serverClient），绕过 RLS（N-3）
  const supabase = serverClient();
  const { data, error } = await supabase.rpc("process_order_refund", {
    p_order_no: order_no,
    p_refund_note: refund_note,
  });
  if (error) {
    throw error;
  }

  const deducted = typeof data === "number" ? data : 0;

  // P0-1 债务化：若扣回量小于订单发放积分，说明存在「已消费而无法回收」的部分，
  // 登记 credit_debts 欠款 + 订单置 refund_blocked + 账号 restricted，杜绝白嫖。
  // 这里是登记路径（0022）之外的唯一债务化入口：按实际扣回量判定缺口，
  // webhook 登记时不预记欠款（尚未尝试回收，无法判定）。
  let debt = 0;
  try {
    const order = await findOrderByOrderNo(order_no);
    if (
      order &&
      typeof order.credits === "number" &&
      deducted < order.credits
    ) {
      const { data: debtData, error: debtErr } = await supabase.rpc(
        "debt_regulate_order_refund",
        {
          p_order_no: order_no,
          p_user_uuid: order.user_uuid,
          p_order_credits: order.credits,
          p_refunded_credits: deducted,
          p_reason:
            reason ||
            `refund ${order_no} deducted ${deducted} of ${order.credits} credits`,
        }
      );
      if (debtErr) {
        console.error("[refund] debt regulate failed:", debtErr);
      } else {
        debt = typeof debtData === "number" ? debtData : 0;
      }
    }
  } catch (e) {
    console.error("[refund] debt regulate error:", e);
  }

  // 退款是资金流出：落库 + 服务端埋点 + 飞书/企微告警（warn 级默认会推送）
  trackCriticalEvent({
    event_type: "payment.refund_processed",
    severity: "warn",
    source: "app",
    subject_uuid: order_no,
    detail: {
      amount,
      deducted_credits: deducted,
      debt_credits: debt,
      admin_uuid,
      reason,
    },
  });

  // 审计只在 admin 路由层落一条（带 reason）；这里不重复写 admin.order.refund，
  // 否则同一操作出现两条记录、其中一条缺 reason，削弱 N-6 审计一致性。
  return { deducted_credits: deducted };
}
