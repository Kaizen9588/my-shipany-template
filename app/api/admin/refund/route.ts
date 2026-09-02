import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { findOrderByOrderNo } from "@/models/order";
import { getPaymentProvider } from "@/lib/payment";
import { fireAndForgetAudit } from "@/lib/audit";
import { parseReason } from "@/lib/admin-reason";
import { submitApproval } from "@/lib/admin-approval";

/**
 * POST /api/admin/refund —— 订单退款（6.8，6.21 完善；N-6：强制理由 + 审批队列）
 *
 * N-6 双人复核：不再直接执行，全部转审批单（/api/admin/approvals op=decide
 * 批准即执行）。例外（照旧直接响应，不进队列）：
 * - 渠道无商户退款 API：只返回手动退款指引，无资金动作
 *
 * 两种语义按订单状态区分（执行时同规，见 lib/admin-approval dispatch refund）：
 * - status='paid'：发起退款。按 payment_provider 分发：
 *   · Stripe：调渠道退款 API 全自动（适配器 refund）→ processRefund 扣积分闭合终态
 *   · Creem / Waffo(Pancake)：无商户退款 API → 返回 Dashboard 手动退款指引
 *     （退款成功 webhook 只登记 refund_requested，见下）
 * - status='refund_requested'：webhook 已登记退款事实（渠道已退钱），批准后只做
 *   **本地闭合**——直接 processRefund 扣积分 + 终态化，绝不调 provider.refund
 *   （再调一次渠道退款 API = 双重退款）。P0-1 中间态的闭合入口。
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("admin"); // 2.7：退款是资金操作，需 admin 级
    const { order_no, amount, reason } = await req.json();

    if (!order_no) {
      return respErr("invalid params");
    }
    // N-6：退款是资金操作，必须带理由（进审计，事后可追责）
    const parsed = parseReason(reason);
    if (!parsed.ok) {
      return respErr(`refund reason required: ${parsed.error}`);
    }

    const order = await findOrderByOrderNo(order_no);
    if (!order) {
      return respErr("order not found");
    }

    // webhook 已登记的退款请求：转审批单，批准后只本地闭合（扣积分 + 终态），不再触达渠道
    if (order.status === "refund_requested") {
      const { approval, single_admin } = await submitApproval({
        action: "refund",
        requester: admin,
        reason: parsed.reason,
        target_uuid: order_no,
        payload: { order_no, amount: amount ?? null, close_only: true },
      });
      return respData({
        approval_required: true,
        approval_id: approval.id,
        status: approval.status,
        single_admin,
      });
    }

    if (order.status !== "paid") {
      return respErr("order is not refundable: " + order.status);
    }

    const providerId = order.payment_provider || "stripe";
    const provider = getPaymentProvider(providerId);
    if (!provider) {
      return respErr(`unknown payment provider: ${providerId}`);
    }

    // Creem / Waffo(Pancake) 无商户退款 API：返回手动退款指引（无资金动作，豁免审批）
    if (!provider.capabilities.refund_api || !provider.refund) {
      fireAndForgetAudit({
        admin_uuid: admin.uuid || "",
        action: "admin.order.refund_manual",
        target_type: "order",
        target_uuid: order_no,
        detail: `${providerId}: manual refund via dashboard required; reason: ${parsed.reason}`,
      });
      return respData({
        refunded: false,
        manual: true,
        message: `该渠道（${providerId}）无商户退款 API，请在渠道 Dashboard 手动退款，系统将通过退款成功 webhook 登记退款请求（refund_requested），再在后台闭合`,
      });
    }

    // Stripe：转审批单，批准后调用渠道退款 API，然后本地扣积分 + 标记 refunded
    const { approval, single_admin } = await submitApproval({
      action: "refund",
      requester: admin,
      reason: parsed.reason,
      target_uuid: order_no,
      payload: { order_no, amount: amount ?? null, close_only: false },
    });

    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.order.refund_requested",
      target_type: "order",
      target_uuid: order_no,
      detail: JSON.stringify({
        provider: providerId,
        amount: amount ?? null,
        approval_id: approval.id,
        approval_status: approval.status,
        single_admin,
        reason: parsed.reason,
      }),
    });

    return respData({
      approval_required: true,
      approval_id: approval.id,
      status: approval.status,
      single_admin,
    });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/refund] failed:", e);
    return respErr("refund failed: " + e.message);
  }
}
