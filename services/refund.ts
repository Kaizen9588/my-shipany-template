import { getSupabaseClient } from "@/models/db";
import { getIsoTimestr } from "@/lib/time";
import { fireAndForgetAudit } from "@/lib/audit";

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
}: {
  order_no: string;
  amount?: number;
  admin_uuid?: string;
}): Promise<{ deducted_credits: number }> {
  const refund_note = `refunded at ${getIsoTimestr()}${
    amount ? ` amount=${amount}` : ""
  }`;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("process_order_refund", {
    p_order_no: order_no,
    p_refund_note: refund_note,
  });
  if (error) {
    throw error;
  }

  const deducted = typeof data === "number" ? data : 0;

  if (admin_uuid) {
    fireAndForgetAudit({
      admin_uuid,
      action: "admin.order.refund",
      target_type: "order",
      target_uuid: order_no,
      detail: JSON.stringify({ amount, deducted }),
    });
  }

  return { deducted_credits: deducted };
}
