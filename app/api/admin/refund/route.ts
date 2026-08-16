import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { findOrderByOrderNo } from "@/models/order";
import { getPaymentProvider } from "@/lib/payment";
import { processRefund } from "@/services/refund";
import { fireAndForgetAudit } from "@/lib/audit";

/**
 * POST /api/admin/refund —— 订单退款（6.8，6.21 完善）
 *
 * 按 payment_provider 分发：
 * - Stripe/Waffo：调渠道退款 API 全自动（适配器 refund）→ processRefund 扣积分
 * - Creem：无退款 API → 返回 Dashboard 手动退款指引（refund.created webhook 同步扣积分）
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("admin"); // 2.7：退款是资金操作，需 admin 级
    const { order_no, amount } = await req.json();

    if (!order_no) {
      return respErr("invalid params");
    }

    const order = await findOrderByOrderNo(order_no);
    if (!order) {
      return respErr("order not found");
    }
    if (order.status !== "paid") {
      return respErr("order is not paid");
    }

    const providerId = order.payment_provider || "stripe";
    const provider = getPaymentProvider(providerId);
    if (!provider) {
      return respErr(`unknown payment provider: ${providerId}`);
    }

    // Creem 无退款 API：返回手动退款指引
    if (!provider.capabilities.refund_api || !provider.refund) {
      fireAndForgetAudit({
        admin_uuid: admin.uuid || "",
        action: "admin.order.refund_manual",
        target_type: "order",
        target_uuid: order_no,
        detail: "creem: manual refund via dashboard required",
      });
      return respData({
        refunded: false,
        manual: true,
        message:
          "该渠道（Creem）无退款 API，请在 Creem Dashboard 手动退款，系统将通过 refund.created webhook 同步扣回积分",
      });
    }

    // Stripe/Waffo：调用渠道退款 API，然后本地扣积分 + 标记 refunded
    await provider.refund({ order_no, amount });
    const { deducted_credits } = await processRefund({
      order_no,
      amount,
      admin_uuid: admin.uuid || "",
    });

    return respData({ refunded: true, deducted_credits });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/refund] failed:", e);
    return respErr("refund failed: " + e.message);
  }
}
