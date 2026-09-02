import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { fireAndForgetAudit } from "@/lib/audit";
import {
  getPaymentProducts,
  getPaymentSettings,
} from "@/models/payment";
import { getProviderHealthSnapshot } from "@/lib/payment/health";
import { aggregatePaymentEvents } from "@/lib/oplog";
import { parseReason } from "@/lib/admin-reason";
import { validatePricingFields } from "@/lib/pricing-guard";
import { submitApproval } from "@/lib/admin-approval";

/**
 * GET/PUT /api/admin/payment-settings
 * 后台支付渠道管理（6.1 + docs/16 §4.2b）：
 * - 渠道启用开关 / priority（热切换，无需重部署）
 * - payment_products 定价映射（金额/积分/有效期/渠道产品 ID）
 */
export async function GET() {
  try {
    const admin = await requireAdmin();
    const [settings, products, stats24h] = await Promise.all([
      getPaymentSettings(),
      getPaymentProducts(),
      aggregatePaymentEvents(24),
    ]);
    void admin;
    return respData({
      settings,
      products,
      health: getProviderHealthSnapshot(),
      stats24h,
    });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/payment-settings] GET failed:", e);
    return respErr("get payment settings failed");
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin("admin");
    const body = await req.json();
    const { settings = [], products = [], reason } = body || {};

    // N-6：渠道启停/优先级与定价映射都是资金路径配置，必须带理由
    const parsed = parseReason(reason);
    if (!parsed.ok) {
      return respErr(`payment settings reason required: ${parsed.error}`);
    }

    // 渠道设置与定价映射：提交前先做形状校验与定价不变量校验
    // （与 /api/admin/payment-products 完全同规则 —— 这里是同一真相源的
    // 第二个写入入口，缺反套利校验就是旁路（1 分卖 100 万积分），审查修复：
    // 双入口共用 lib/pricing-guard；先 floor 再校验防 0.5 绕过）。
    // N-6 审批门：校验通过的 payload 快照落审批单，批准后由 lib/admin-approval
    // 重新校验并执行（渠道启停/优先级与定价都是资金路径配置，双人复核）
    for (const prod of products) {
      const amount = typeof prod.amount === "number" ? Math.floor(prod.amount) : undefined;
      const credits = typeof prod.credits === "number" ? Math.floor(prod.credits) : undefined;
      const validMonths =
        typeof prod.valid_months === "number" ? Math.floor(prod.valid_months) : undefined;
      if (amount !== undefined || credits !== undefined || validMonths !== undefined) {
        const err = validatePricingFields({
          amount,
          credits,
          valid_months: validMonths,
        });
        if (err) return respErr(err);
      }
    }

    const { approval, single_admin } = await submitApproval({
      action: "payment_settings",
      requester: admin,
      reason: parsed.reason,
      target_uuid: "",
      payload: { settings, products },
    });

    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.payment_settings.update_requested",
      target_type: "config",
      target_uuid: "",
      detail: JSON.stringify({
        settingsCount: settings.length,
        productIds: products.map((p: any) => p?.product_id),
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
    console.error("[admin/payment-settings] PUT failed:", e);
    return respErr("update payment settings failed");
  }
}
